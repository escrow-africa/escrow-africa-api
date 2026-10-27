import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FlutterwaveService } from '../flutterwave/flutterwave.service';
import { TransactionService } from '../transaction/transaction.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WalletService {
	private readonly logger = new Logger(WalletService.name);
	constructor(
		private readonly prisma: PrismaService,
		private readonly provider: FlutterwaveService,
		private readonly transactionService: TransactionService,
	) {}

	async topUp(userId: string, amount: number, method: 'bank' | 'ussd' | 'card', opts: any = {}) {
		if (amount <= 0) throw new BadRequestException('Amount must be positive');

		// get user customer info
		const user = await this.prisma.user.findUnique({ where: { id: userId } });
		const customer = user ? { name: user.fullName, email: user.email } : { name: userId, email: `${userId}@example.com` };

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });

		// initialize transaction with provider
		const init = await this.provider.initializeTransaction(userId, amount, customer);

		const transactionReference = init.providerResponse.responseBody.transactionReference;
		// paymentReference is the reference *we* generated and sent to the provider (userId-uuid).
		// The webhook echoes this back, not the provider's own transactionReference, so this is what
		// we must store as providerReference for processProviderPayment() to find this record.
		const paymentReference = init.paymentReference;

		// persist pending transaction (acts as payment record)
		// transactionReference (the provider's own id) is kept in metadata: authorizeCardOtp() only
		// receives that value back from the frontend, not our paymentReference, so it needs a way
		// to find this record too.
		await this.prisma.transaction.create({
			data: {
				userId,
				type: 'DEPOSIT',
				title: `Top-up initiated`,
				amount: amount as any,
				status: 'PENDING',
				metadata: { method, transactionReference },
				provider: 'FLUTTERWAVE',
				providerReference: paymentReference,
			},
		});

		// Branch by method
		switch (method) {
			case 'bank':
			case 'ussd': {
				const bankCode = wallet?.bankCode;
				const resp = await this.provider.initBankPayment(transactionReference, bankCode, amount, customer);
				// attach provider data to transaction
				const existingTxn = await this.prisma.transaction.findFirst({ where: { providerReference: paymentReference } });
				if (existingTxn) {
					await this.prisma.transaction.update({ where: { id: existingTxn.id }, data: { metadata: { ...resp.raw, method, transactionReference } } });
				}
				return { transactionReference, ...resp };
			}
			case 'card': {
				const card = opts.card;
				const deviceInformation = opts.deviceInformation;
				if (!card) throw new BadRequestException('card details required for card payments');
				const resp = await this.provider.chargeCard(transactionReference, card, deviceInformation, amount, customer);
				const existingTxn2 = await this.prisma.transaction.findFirst({ where: { providerReference: paymentReference } });
				if (existingTxn2) {
					await this.prisma.transaction.update({ where: { id: existingTxn2.id }, data: { metadata: { ...resp.raw, method, transactionReference, tokenId: resp.tokenId } } });
				}
				return { transactionReference, ...resp };
			}
			default:
				throw new BadRequestException('Unsupported payment method');
		}
	}

	async authorizeCardOtp(transactionReference: string | undefined, tokenId: string, token: string) {
		// transactionReference here is the provider's own reference (what topUp() returned to the
		// frontend), not our paymentReference/providerReference, so it's stashed in metadata.
		if (!tokenId || !token) throw new BadRequestException('tokenId and token are required');

		const txRef = transactionReference;
		let txn = null;
		if (txRef) {
			txn = await this.prisma.transaction.findFirst({
				where: { OR: [{ providerReference: txRef }, { metadata: { path: ['transactionReference'], equals: txRef } }] },
			});
			if (!txn) throw new NotFoundException('Transaction not found for transactionReference');
		}

		const resp = await this.provider.authorizeCardOtp(tokenId, token, txRef);
		// persist provider response
		if (txRef && txn) {
			await this.prisma.transaction.update({ where: { id: txn.id }, data: { metadata: { ...((txn?.metadata as any) || {}), ...(resp.raw || {}) } } });
		}

		// if provider indicates success, credit wallet
		const providerRef = resp.providerReference || txRef;
		if (resp.status && String(resp.status).toUpperCase().includes('SUCCESS')) {
			// find transaction to get userId and amount
			const p = txRef ? txn : await this.prisma.transaction.findFirst({ where: { providerReference: providerRef } });
			if (p) {
				// Pass p.providerReference (our paymentReference), not providerRef (Monnify's own
				// reference) - processProviderPayment() matches on providerReference and would
				// otherwise create an orphaned duplicate instead of updating this record.
				await this.processProviderPayment(p.providerReference || providerRef, p.userId, Number(p.amount));
			}
		}

		return { providerRef, status: resp.status, raw: resp.raw };
	}

	// Resubmits a card charge with the PIN nested in the authorization object, for cards whose
	// evaluated auth mode came back "pin" rather than "otp" or "redirect". Flutterwave ties this
	// to the same tx_ref as the original attempt.
	async retryCardWithPin(userId: string, transactionReference: string, pin: string, card: { number: string; expiryMonth: string; expiryYear: string; cvv?: string }) {
		const txn = await this.prisma.transaction.findFirst({
			where: { OR: [{ providerReference: transactionReference }, { metadata: { path: ['transactionReference'], equals: transactionReference } }] },
		});
		if (!txn || txn.userId !== userId) throw new NotFoundException('Transaction not found for transactionReference');

		const user = await this.prisma.user.findUnique({ where: { id: userId } });
		const customer = user ? { name: user.fullName, email: user.email } : undefined;
		const amount = Number(txn.amount);

		const resp = await this.provider.chargeCard(transactionReference, { ...card, pin }, undefined, amount, customer);

		await this.prisma.transaction.update({ where: { id: txn.id }, data: { metadata: { ...((txn.metadata as any) || {}), ...(resp.raw || {}) } } });

		if (resp.status && String(resp.status).toUpperCase().includes('SUCCESS')) {
			await this.processProviderPayment(txn.providerReference!, userId, amount);
		}

		return { transactionReference, ...resp };
	}

	async getBanks() {
		return this.provider.getBanks();
	}

		async createWalletForUser(userId: string, skipProvider = false, bvn?: string) {
			const existing = await this.prisma.wallet.findUnique({ where: { userId } });
			if (existing) return existing;

			// If caller requests to skip provider (development/testing), create local wallet first and try provider non-blocking
			if (skipProvider) {
				const wallet = await this.prisma.wallet.create({ data: { userId } });
				try {
					// fetch user info to enrich provider payload
					const user = await this.prisma.user.findUnique({ where: { id: userId } });
					const customer = user ? { name: user.fullName, email: user.email, phone: user.phone, bvn: bvn || user.bvn || undefined } : undefined;
					const ra = await this.provider.createVirtualAccount(userId, customer);
					if (ra && ra.accountNumber) {
						await this.prisma.wallet.update({
							where: { id: wallet.id },
							data: {
								accountNumber: ra.accountNumber,
								accountName: ra.accountName,
								bankName: ra.bankName,
								bankCode: ra.bankCode,
								providerAccountReference: ra.accountReference,
							},
						});
					}
				} catch (e) {
					this.logger.warn('Failed to create Flutterwave virtual account for user (skipProvider mode)', userId, e);
				}
				return wallet;
			}

			// Strict path: require provider virtual account first, then persist local wallet with provider details
			this.logger.debug('Creating provider virtual account before local wallet for', userId);
			// fetch user info and include customer name/email/bvn in provider request
			const user = await this.prisma.user.findUnique({ where: { id: userId } });
			const customer = user ? { name: user.fullName, email: user.email, phone: user.phone, bvn: bvn || user.bvn || undefined } : undefined;
			const ra = await this.provider.createVirtualAccount(userId, customer);
			if (!ra || !ra.accountNumber) {
				this.logger.error('Flutterwave did not return accountNumber', ra);
				throw new Error('Failed to create provider virtual account');
			}

			const wallet = await this.prisma.wallet.create({
				data: {
					userId,
					accountNumber: ra.accountNumber,
					accountName: ra.accountName,
					bankName: ra.bankName,
					bankCode: ra.bankCode,
					providerAccountReference: ra.accountReference,
				},
			});

			return wallet;
	}

	async getBalance(userId: string) {
		let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
		if (!wallet) {
			this.logger.warn('Wallet missing on balance fetch - creating on demand', userId);
			wallet = await this.createWalletForUser(userId, true);
		}
		return wallet.balance;
	}

	async getWalletDetails(userId: string, page = 1, limit = 20) {
		let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
		if (!wallet) {
			// Self-healing: registration creates the wallet via a non-blocking, best-effort call -
			// if that failed (provider hiccup, etc.) the user would otherwise be stuck with a
			// permanent 404 here. Retrying on-demand, in skipProvider mode, means they always get
			// at least a local wallet immediately, with the provider account attached if it succeeds.
			this.logger.warn('Wallet missing on details fetch - creating on demand', userId);
			wallet = await this.createWalletForUser(userId, true);
		}

		const { data, page: p, limit: l, total } = await this.transactionService.fetchTransactions(userId, page, limit);

		return { wallet, payments: data, page: p, limit: l, total };
	}

	async credit(userId: string, amount: number, opts: { title?: string; type?: 'DEPOSIT' | 'WITHDRAWAL' | 'PAYOUT'; metadata?: any } = {}) {
		if (amount <= 0) {
			throw new BadRequestException('Amount must be positive');
		}
		const wallet = await this.createWalletForUser(userId);
		const updated = await this.prisma.wallet.update({
			where: { id: wallet.id },
			data: { balance: { increment: amount } as any },
		});

		// create transaction record for credit
		try {
			await this.prisma.transaction.create({
				data: {
					userId,
					type: opts.type || 'DEPOSIT',
					title: opts.title || `Deposit to wallet`,
					amount: amount as any,
					status: 'COMPLETED',
					metadata: opts.metadata || {},
				},
			});
		} catch (e) {
			this.logger.warn('Failed to create transaction record for credit', e);
		}

		return updated;
	}

	async debit(userId: string, amount: number, opts: { title?: string; type?: 'DEPOSIT' | 'WITHDRAWAL' | 'PAYOUT'; metadata?: any } = {}) {
		if (amount <= 0) {
			throw new BadRequestException('Amount must be positive');
		}
		const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
		if (!wallet) {
			throw new NotFoundException('Wallet not found');
		}
		if (Number(wallet.balance) < amount) {
			throw new BadRequestException('Insufficient funds');
		}

		const updated = await this.prisma.wallet.update({
			where: { id: wallet.id },
			data: { balance: { decrement: amount } as any },
		});

		// create transaction record for debit/payout
		try {
			await this.prisma.transaction.create({
				data: {
					userId,
					type: opts.type || 'WITHDRAWAL',
					title: opts.title || `Withdrawal from wallet`,
					amount: amount as any,
					status: 'COMPLETED',
					metadata: opts.metadata || {},
				},
			});
		} catch (e) {
			this.logger.warn('Failed to create transaction record for debit', e);
		}

		return updated;
	}

	// Real disbursement to an external bank account - debits the wallet immediately (so the
	// balance reflects the withdrawal right away) and reverses that debit if the transfer can't
	// even be initiated. Final confirmation (SUCCESSFUL/FAILED) arrives later via webhook and is
	// handled by processWithdrawalUpdate() below, which reverses the debit again on a late FAILED.
	async withdraw(userId: string, amount: number, payoutAccountId: string) {
		if (amount <= 0) throw new BadRequestException('Amount must be positive');

		const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
		if (!wallet) throw new NotFoundException('Wallet not found');
		if (Number(wallet.balance) < amount) throw new BadRequestException('Insufficient funds');

		const payoutAccount = await this.prisma.payoutAccount.findUnique({ where: { id: payoutAccountId } });
		if (!payoutAccount || payoutAccount.userId !== userId) {
			throw new NotFoundException('Payout account not found');
		}

		// Flutterwave caps reference at 64 chars - userId plus a full uuid would exceed that, so
		// the reference is opaque (just unique); the Transaction row already carries userId.
		const reference = `wd-${uuidv4()}`;

		const [, transaction] = await this.prisma.$transaction([
			this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } as any } }),
			this.prisma.transaction.create({
				data: {
					userId,
					type: 'WITHDRAWAL',
					title: `Withdrawal to ${payoutAccount.bankName}`,
					amount: amount as any,
					status: 'PENDING',
					provider: 'FLUTTERWAVE',
					providerReference: reference,
					metadata: {
						payoutAccountId,
						bankName: payoutAccount.bankName,
						accountNumber: payoutAccount.accountNumber,
						accountName: payoutAccount.accountName,
					},
				},
			}),
		]);

		try {
			const resp = await this.provider.initiateTransfer(reference, amount, {
				bankCode: payoutAccount.bankCode,
				accountNumber: payoutAccount.accountNumber,
				accountName: payoutAccount.accountName,
			});

			await this.prisma.transaction.update({
				where: { id: transaction.id },
				data: { metadata: { ...(transaction.metadata as any), transferId: resp.transferId, providerStatus: resp.status } },
			});

			return { reference, status: 'PENDING', message: 'Withdrawal initiated', transferId: resp.transferId };
		} catch (e) {
			// The transfer call itself failed (not just "pending") - reverse the debit immediately
			// rather than leaving the user's money stuck waiting for a webhook that'll never arrive.
			await this.prisma.$transaction([
				this.prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } as any } }),
				this.prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'FAILED' } }),
			]);
			this.logger.error('Withdrawal transfer initiation failed, reversed debit', userId, e);
			throw new BadRequestException('Unable to process withdrawal right now. Your balance has not been affected.');
		}
	}

	// Called from the Flutterwave webhook once a transfer's final status is known.
	async processWithdrawalUpdate(providerReference: string, status: string) {
		const txn = await this.prisma.transaction.findFirst({ where: { providerReference } });
		if (!txn || txn.status !== 'PENDING') return; // already handled, or not ours

		if (status === 'SUCCESSFUL') {
			await this.prisma.transaction.update({ where: { id: txn.id }, data: { status: 'COMPLETED' } });
		} else if (status === 'FAILED') {
			// Reverse the debit taken at initiation so the user's money actually comes back.
			await this.prisma.$transaction([
				this.prisma.wallet.update({ where: { userId: txn.userId }, data: { balance: { increment: Number(txn.amount) } as any } }),
				this.prisma.transaction.update({ where: { id: txn.id }, data: { status: 'FAILED' } }),
			]);
		}
	}

	async deposit(userId: string, amount: number) {
		// keep method name for compatibility but delegate to the payment provider
		// fetch user info to provide accurate customer name/email to provider
		const user = await this.prisma.user.findUnique({ where: { id: userId } });
		const customer = user ? { name: user.fullName, email: user.email } : { name: userId, email: `${userId}@example.com` };
		const init = await this.provider.initializeTransaction(userId, amount, customer);

		// record a pending transaction in DB to allow idempotent webhook handling
		await this.prisma.transaction.create({
			data: {
				userId,
				type: 'DEPOSIT',
				title: `Deposit initiated`,
				amount: amount as any,
				status: 'PENDING',
				provider: 'FLUTTERWAVE',
				providerReference: init.paymentReference,
			},
		});

		return init;
	}

	async findByProviderReference(providerReference: string) {
		return this.prisma.transaction.findFirst({ where: { providerReference } });
	}

	async processProviderPayment(providerReference: string, userId: string, amount: number, provider = 'FLUTTERWAVE') {
		if (!providerReference) throw new BadRequestException('Missing provider reference');
		// Check if payment already exists
		const existing = await this.prisma.transaction.findFirst({ where: { providerReference } });
		if (existing && existing.status === 'COMPLETED') {
			this.logger.debug('Transaction already processed', providerReference);
			return existing;
		}

		// Credit the wallet BEFORE marking the transaction COMPLETED. If credit() throws, the
		// transaction stays PENDING (or absent) so a retried webhook can safely try again instead
		// of being skipped as "already processed" while the wallet was never actually credited.
		await this.credit(userId, amount, { title: `Deposit via ${provider}`, type: 'DEPOSIT', metadata: { providerReference } });

		// create or update transaction record
		const transaction = existing
			? await this.prisma.transaction.update({ where: { id: existing.id }, data: { status: 'COMPLETED', amount: amount as any } })
			: await this.prisma.transaction.create({
					data: {
						userId,
						type: 'DEPOSIT',
						title: `Deposit via ${provider}`,
						amount: amount as any,
						status: 'COMPLETED',
						provider,
						providerReference,
					},
				});

		return transaction;
	}

	async fetchTransactions(userId: string, page = 1, limit = 20, type?: string) {
		return this.transactionService.fetchTransactions(userId, page, limit, type);
	}

	async listPayoutAccounts(userId: string) {
		return this.prisma.payoutAccount.findMany({
			where: { userId },
			orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
		});
	}

	async addPayoutAccount(userId: string, data: { bankName: string; bankCode: string; accountNumber: string; accountName: string }) {
		const existingCount = await this.prisma.payoutAccount.count({ where: { userId } });

		return this.prisma.payoutAccount.create({
			data: {
				userId,
				bankName: data.bankName,
				bankCode: data.bankCode,
				accountNumber: data.accountNumber,
				accountName: data.accountName,
				// first account a user adds becomes their default automatically
				isDefault: existingCount === 0,
			},
		});
	}

	async deletePayoutAccount(userId: string, accountId: string) {
		const account = await this.prisma.payoutAccount.findUnique({ where: { id: accountId } });
		if (!account || account.userId !== userId) {
			throw new NotFoundException('Payout account not found');
		}

		await this.prisma.payoutAccount.delete({ where: { id: accountId } });

		// promote the most recently added remaining account so a default always exists once
		// at least one payout account is left
		if (account.isDefault) {
			const next = await this.prisma.payoutAccount.findFirst({
				where: { userId },
				orderBy: { createdAt: 'desc' },
			});
			if (next) {
				await this.prisma.payoutAccount.update({ where: { id: next.id }, data: { isDefault: true } });
			}
		}

		return { message: 'Payout account removed' };
	}

	async setDefaultPayoutAccount(userId: string, accountId: string) {
		const account = await this.prisma.payoutAccount.findUnique({ where: { id: accountId } });
		if (!account || account.userId !== userId) {
			throw new NotFoundException('Payout account not found');
		}

		await this.prisma.$transaction([
			this.prisma.payoutAccount.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
			this.prisma.payoutAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
		]);

		return this.prisma.payoutAccount.findUnique({ where: { id: accountId } });
	}
}

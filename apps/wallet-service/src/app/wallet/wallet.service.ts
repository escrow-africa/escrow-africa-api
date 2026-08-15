import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonnifyService } from '../monnify/monnify.service';
import { TransactionService } from '../transaction/transaction.service';

@Injectable()
export class WalletService {
	private readonly logger = new Logger(WalletService.name);
	constructor(
		private readonly prisma: PrismaService,
		private readonly monnify: MonnifyService,
		private readonly transactionService: TransactionService,
	) {}

	async topUp(userId: string, amount: number, method: 'bank' | 'ussd' | 'card', opts: any = {}) {
		if (amount <= 0) throw new BadRequestException('Amount must be positive');

		// get user customer info
		const user = await this.prisma.user.findUnique({ where: { id: userId } });
		const customer = user ? { name: user.fullName, email: user.email } : { name: userId, email: `${userId}@example.com` };

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });

		// initialize transaction with provider
		const init = await this.monnify.initializeTransaction(userId, amount, customer);

		const transactionReference = init.providerResponse.responseBody.transactionReference;
		// paymentReference is the reference *we* generated and sent to Monnify (userId-uuid).
		// The webhook echoes this back, not Monnify's own transactionReference, so this is what
		// we must store as providerReference for processProviderPayment() to find this record.
		const paymentReference = init.paymentReference;

		// persist pending transaction (acts as payment record)
		// transactionReference (Monnify's own id) is kept in metadata: authorizeCardOtp() only
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
				provider: 'MONNIFY',
				providerReference: paymentReference,
			},
		});

		// Branch by method
		switch (method) {
			case 'bank':
			case 'ussd': {
				const bankCode = wallet?.bankCode;
				if (!bankCode) throw new BadRequestException('bankCode is required for bank/ussd payments');
				const resp = await this.monnify.initBankPayment(transactionReference, bankCode);
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
				const resp = await this.monnify.chargeCard(transactionReference, card, deviceInformation);
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
		// transactionReference here is Monnify's own reference (what topUp() returned to the
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

		const resp = await this.monnify.authorizeCardOtp(tokenId, token, txRef);
		// persist provider response
		if (txRef && txn) {
			await this.prisma.transaction.update({ where: { id: txn.id }, data: { metadata: { ...(txn?.metadata || {}), ...(resp.raw || {}) } } });
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

	async getBanks() {
		return this.monnify.getBanks();
	}

		async createWalletForUser(userId: string, skipProvider = false) {
			const existing = await this.prisma.wallet.findUnique({ where: { userId } });
			if (existing) return existing;

			// If caller requests to skip provider (development/testing), create local wallet first and try provider non-blocking
			if (skipProvider) {
				const wallet = await this.prisma.wallet.create({ data: { userId } });
				try {
					// fetch user info to enrich provider payload
					const user = await this.prisma.user.findUnique({ where: { id: userId } });
					const customer = user ? { name: user.fullName, email: user.email } : undefined;
					const ra = await this.monnify.createReservedAccount(userId, customer);
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
					this.logger.warn('Failed to create Monnify reserved account for user (skipProvider mode)', userId, e);
				}
				return wallet;
			}

			// Strict path: require provider reserved account first, then persist local wallet with provider details
			this.logger.debug('Creating provider reserved account before local wallet for', userId);
			// fetch user info and include customer name/email in provider request
			const user = await this.prisma.user.findUnique({ where: { id: userId } });
			const customer = user ? { name: user.fullName, email: user.email } : undefined;
			const ra = await this.monnify.createReservedAccount(userId, customer);
			if (!ra || !ra.accountNumber) {
				this.logger.error('Monnify did not return accountNumber', ra);
				throw new Error('Failed to create provider reserved account');
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
		const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
		if (!wallet) {
			throw new NotFoundException('Wallet not found');
		}
		return wallet.balance;
	}

	async getWalletDetails(userId: string, page = 1, limit = 20) {
		const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
		if (!wallet) {
			throw new NotFoundException('Wallet not found');
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

	async deposit(userId: string, amount: number) {
		// keep method name for compatibility but delegate to Monnify
		// fetch user info to provide accurate customer name/email to provider
		const user = await this.prisma.user.findUnique({ where: { id: userId } });
		const customer = user ? { name: user.fullName, email: user.email } : { name: userId, email: `${userId}@example.com` };
		const init = await this.monnify.initializeTransaction(userId, amount, customer);

		// record a pending transaction in DB to allow idempotent webhook handling
		await this.prisma.transaction.create({
			data: {
				userId,
				type: 'DEPOSIT',
				title: `Deposit initiated`,
				amount: amount as any,
				status: 'PENDING',
				provider: 'MONNIFY',
				providerReference: init.paymentReference,
			},
		});

		return init;
	}

	async findByProviderReference(providerReference: string) {
		return this.prisma.transaction.findFirst({ where: { providerReference } });
	}

	async processProviderPayment(providerReference: string, userId: string, amount: number, provider = 'MONNIFY') {
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
}

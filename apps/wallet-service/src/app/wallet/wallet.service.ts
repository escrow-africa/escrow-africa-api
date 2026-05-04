import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MonnifyService } from '../monnify/monnify.service';

@Injectable()
export class WalletService {
	private readonly logger = new Logger(WalletService.name);
	constructor(private readonly prisma: PrismaService, private readonly monnify: MonnifyService) {}

	async topUp(userId: string, amount: number, method: 'bank' | 'ussd' | 'card', opts: any = {}) {
		if (amount <= 0) throw new BadRequestException('Amount must be positive');

		// get user customer info
		const user = await this.prisma.user.findUnique({ where: { id: userId } });
		const customer = user ? { name: user.fullName, email: user.email } : { name: userId, email: `${userId}@example.com` };

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });

		// initialize transaction with provider
		const init = await this.monnify.initializeTransaction(userId, amount, customer);
    console.log({ reference: init.providerResponse.responseBody });

		const transactionReference = init.providerResponse.responseBody.transactionReference;

		// persist pending payment
		await this.prisma.payment.create({
			data: {
				provider: 'MONNIFY',
				providerReference: transactionReference,
				userId,
				amount: amount as any,
				status: 'PENDING',
				metadata: { method },
			},
		});

		// Branch by method
		switch (method) {
			case 'bank':
			case 'ussd': {
				const bankCode = wallet?.bankCode;
				if (!bankCode) throw new BadRequestException('bankCode is required for bank/ussd payments');
				const resp = await this.monnify.initBankPayment(transactionReference, bankCode);
				// attach provider data to payment
				await this.prisma.payment.update({ where: { providerReference: transactionReference }, data: { metadata: { ...resp.raw, method } } });
				return { transactionReference, ...resp };
			}
			case 'card': {
				const card = opts.card;
				const deviceInformation = opts.deviceInformation;
				if (!card) throw new BadRequestException('card details required for card payments');
				const resp = await this.monnify.chargeCard(transactionReference, card, deviceInformation);
				await this.prisma.payment.update({ where: { providerReference: transactionReference }, data: { metadata: { ...resp.raw, method, tokenId: resp.tokenId } } });
				return { transactionReference, ...resp };
			}
			default:
				throw new BadRequestException('Unsupported payment method');
		}
	}

	async authorizeCardOtp(transactionReference: string | undefined, tokenId: string, token: string) {
		// transactionReference corresponds to our payment.providerReference
		if (!tokenId || !token) throw new BadRequestException('tokenId and token are required');

		const txRef = transactionReference;
		let payment = null;
		if (txRef) {
			payment = await this.prisma.payment.findUnique({ where: { providerReference: txRef } });
			if (!payment) throw new NotFoundException('Payment not found for transactionReference');
		}

		const resp = await this.monnify.authorizeCardOtp(tokenId, token, txRef);
		// persist provider response
		if (txRef) {
			await this.prisma.payment.update({ where: { providerReference: txRef }, data: { metadata: { ...(payment?.metadata || {}), ...(resp.raw || {}) } } });
		}

		// if provider indicates success, credit wallet
		const providerRef = resp.providerReference || txRef;
		if (resp.status && String(resp.status).toUpperCase().includes('SUCCESS')) {
			// find payment to get userId and amount
			const p = txRef ? payment : await this.prisma.payment.findUnique({ where: { providerReference: providerRef } });
			if (p) {
				await this.processProviderPayment(providerRef, p.userId, Number(p.amount));
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

	async getWalletDetails(userId: string) {
		const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
		if (!wallet) {
			throw new NotFoundException('Wallet not found');
		}

		const payments = await this.prisma.payment.findMany({
			where: { userId },
			orderBy: { createdAt: 'desc' },
		});

		return { wallet, payments };
	}

	async credit(userId: string, amount: number) {
		if (amount <= 0) {
			throw new BadRequestException('Amount must be positive');
		}
		const wallet = await this.createWalletForUser(userId);
		return this.prisma.wallet.update({
			where: { id: wallet.id },
			data: { balance: { increment: amount } as any },
		});
	}

	async debit(userId: string, amount: number) {
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
		return this.prisma.wallet.update({
			where: { id: wallet.id },
			data: { balance: { decrement: amount } as any },
		});
	}

	async deposit(userId: string, amount: number) {
		// keep method name for compatibility but delegate to Monnify
		// fetch user info to provide accurate customer name/email to provider
		const user = await this.prisma.user.findUnique({ where: { id: userId } });
		const customer = user ? { name: user.fullName, email: user.email } : { name: userId, email: `${userId}@example.com` };
		const init = await this.monnify.initializeTransaction(userId, amount, customer);

		// record a pending payment in DB to allow idempotent webhook handling
		await this.prisma.payment.create({
			data: {
				provider: 'MONNIFY',
				providerReference: init.paymentReference,
				userId,
				amount: amount as any,
				status: 'PENDING',
			},
		});

		return init;
	}

	async processProviderPayment(providerReference: string, userId: string, amount: number, provider = 'MONNIFY') {
		if (!providerReference) throw new BadRequestException('Missing provider reference');
		// Check if payment already exists
		const existing = await this.prisma.payment.findUnique({ where: { providerReference } });
		if (existing && existing.status === 'SUCCESS') {
			this.logger.debug('Payment already processed', providerReference);
			return existing;
		}

		// create if missing
		const payment = existing
			? await this.prisma.payment.update({ where: { providerReference }, data: { status: 'SUCCESS', amount: amount as any } })
			: await this.prisma.payment.create({
					data: {
						provider,
						providerReference,
						userId,
						amount: amount as any,
						status: 'SUCCESS',
					},
				});

		// credit the wallet
		await this.credit(userId, amount);
		return payment;
	}
}

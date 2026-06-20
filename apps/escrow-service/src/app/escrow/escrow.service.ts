import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';
import axios from 'axios';

import { KafkaEvents } from '@org/kafka';
import { CloudinaryService } from './cloudinary.service';

@Injectable()
export class EscrowService {
	constructor(
		private readonly prisma: PrismaService,
		@Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientProxy,
		private readonly cloudinaryService: CloudinaryService,
	) {}

	private FEE_RATE = 0.015;

	private readonly logger = new Logger(EscrowService.name);

	// In-memory Monnify token cache — avoids a round-trip on every transfer
	private monnifyTokenCache: { token: string; expiresAt: number } | null = null;

	private async getMonnifyAccessToken(): Promise<string> {
		if (this.monnifyTokenCache && Date.now() < this.monnifyTokenCache.expiresAt) {
			return this.monnifyTokenCache.token;
		}
		const base = process.env.MONNIFY_BASE_URL;
		const apiKey = process.env.MONNIFY_API_KEY;
		const secret = process.env.MONNIFY_SECRET_KEY;
		if (!base || !apiKey || !secret) throw new Error('Monnify not configured');
		const url = `${base}/auth/login`;
		const encoded = Buffer.from(`${apiKey}:${secret}`).toString('base64');
		this.logger.debug('Requesting Monnify access token', { url });
		const resp = await axios.post(url, {}, { headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/json' } });
		const data = resp.data;
		const token = data?.responseBody?.accessToken || data?.response?.accessToken;
		// Cache for 50 minutes (Monnify tokens are typically valid for 60 min)
		this.monnifyTokenCache = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
		return token;
	}

	private async transferToCompanyFromUserReservedAccount(userAccountNumber: string, amount: number, metadata?: any) {
		// company account details from env
		const companyAccount = process.env.COMPANY_ACCOUNT_NUMBER;
		const companyBankCode = process.env.COMPANY_BANK_CODE;
		const companyAccountName = process.env.COMPANY_ACCOUNT_NAME || process.env.COMPANY_ACCOUNT_NUMBER;
		if (!companyAccount || !companyBankCode) throw new Error('Company bank account not configured');

		const token = await this.getMonnifyAccessToken();
		const base = process.env.MONNIFY_BASE_URL!;
		// Monnify transfer endpoint (best-effort). Payload may vary by Monnify version.
		const url = `${base}/merchant/bank-transfer/transfer`;
		const payload: any = {
			amount,
			senderAccountNumber: userAccountNumber,
			beneficiaryAccountNumber: companyAccount,
			beneficiaryBankCode: companyBankCode,
			beneficiaryName: companyAccountName,
			narration: `Escrow fee transfer`,
			contractCode: process.env.MONNIFY_CONTRACT_CODE,
			metadata: metadata || {},
		};
		this.logger.debug('Initiating Monnify transfer to company', { url, senderAccountNumber: userAccountNumber, amount });
		const resp = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
		return resp.data;
	}

	private async transferBetweenMonnifyAccounts(senderAccountNumber: string, beneficiaryAccountNumber: string, beneficiaryBankCode: string, amount: number, narration = 'Escrow transfer') {
		const token = await this.getMonnifyAccessToken();
		const base = process.env.MONNIFY_BASE_URL!;
		const url = `${base}/merchant/bank-transfer/transfer`;
		const payload: any = {
			amount,
			senderAccountNumber,
			beneficiaryAccountNumber,
			beneficiaryBankCode,
			beneficiaryName: beneficiaryAccountNumber,
			narration,
			contractCode: process.env.MONNIFY_CONTRACT_CODE,
		};
		this.logger.debug('Initiating Monnify account-to-account transfer', { url, senderAccountNumber, beneficiaryAccountNumber, amount });
		const resp = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
		return resp.data;
	}

	async findUserIdByEmail(email: string) {
		if (!email) throw new BadRequestException('Email required');
		const user = await this.prisma.user.findUnique({ where: { email } });
		if (!user) throw new NotFoundException('User not found');
		return user.id;
	}

	async createEscrowDetailed(opts: {
		buyerEmail: string;
		sellerId: string;
		milestones: string[];
		amount: number;
		deliveryDeadline: string | Date;
		inspectionPeriodDays: 1 | 3 | 5 | 7;
		description?: string;
	}) {
		const { buyerEmail, sellerId, milestones, amount, deliveryDeadline, inspectionPeriodDays, description } = opts;
		if (amount <= 0) throw new BadRequestException('Amount must be positive');

		// resolve buyer id by email
		const buyerId = await this.findUserIdByEmail(buyerEmail);

		// generate escrow code and payment reference + link
		const escrowCode = await this.generateEscrowCode();
		const paymentReference = this.generatePaymentReference();
		const base = process.env.PAYMENT_BASE_URL || 'https://payments.example.com/pay';
		const paymentLink = `${base}/${paymentReference}`;

		// create escrow in PENDING_PAYMENT state
		const created = await this.prisma.escrow.create({
			data: {
				escrowCode,
				buyerId,
				sellerId,
				amount,
				milestones: milestones as any,
				deliveryDeadline: new Date(deliveryDeadline),
				inspectionPeriodDays,
				description: description || null,
				paymentReference,
				paymentLink,
				status: 'PENDING_PAYMENT',
			} as any,
		});

		// create payment record representing the pending payment for this escrow
		const fee = Number((amount * this.FEE_RATE).toFixed(2));
		await this.prisma.payment.create({
			data: {
				provider: process.env.PAYMENT_PROVIDER || 'payment_link',
				providerReference: paymentReference,
				userId: buyerId,
				amount: amount as any,
				referenceId: created.id,
				fee: fee as any,
				type: 'ESCROW',
				metadata: { escrowId: created.id, milestones } as any,
				status: 'PENDING',
			} as any,
		});

		this.kafkaClient.emit(KafkaEvents.ESCROW_CREATED, { escrowId: created.id, buyerId, sellerId, amount, paymentLink });
		this.kafkaClient.emit(KafkaEvents.ESCROW_PAYMENT_INITIATED, { escrowId: created.id, paymentReference, paymentLink, amount, fee });

		return { escrow: created, paymentLink, paymentReference };
	}

	private generatePaymentReference() {
		return `${Date.now().toString(36).slice(2, 9)}`;
	}

	private async generateEscrowCode() {
		// simple sequential code: ESC-0001, ESC-0002, ...
		const count = await this.prisma.escrow.count();
		const next = count + 1;
		return `ESC-${String(next).padStart(4, '0')}`;
	}

	async extendDeadline(escrowId: string, newDeadline: string | Date) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');
		const updated = await this.prisma.escrow.update({ where: { id: escrowId }, data: { deliveryDeadline: new Date(newDeadline) } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_DEADLINE_EXTENDED, { escrowId: updated.id, newDeadline: updated.deliveryDeadline });
		return updated;
	}

	async markCompleted(escrowId: string, buyerId?: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');

		if (buyerId && escrow.buyerId !== buyerId) {
			throw new BadRequestException('Only the buyer can mark as completed');
		}

		const releasableStatuses = ['FUNDED', 'UNDER_REVIEW'];
		if (!releasableStatuses.includes(escrow.status as string) && escrow.status !== 'RELEASED') {
			throw new BadRequestException('Escrow cannot be marked completed in its current state');
		}

		if (releasableStatuses.includes(escrow.status as string)) {
			// check buyer wallet balance before releasing
			const buyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });
			if (!buyerWallet || Number(buyerWallet.balance) < Number(escrow.amount)) {
				throw new BadRequestException('INSUFFICIENT_FUNDS');
			}
			await this.release(escrowId);
		}

		const updated = await this.prisma.escrow.update({ where: { id: escrowId }, data: { status: 'COMPLETED' } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_COMPLETED, { escrowId: updated.id, buyerId: updated.buyerId, sellerId: updated.sellerId });
		return updated;
	}

	async deliver(escrowId: string, fileBuffer: Buffer, originalName: string, sellerId: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');
		if (escrow.sellerId !== sellerId) throw new BadRequestException('Only the seller can mark as delivered');
		if (escrow.status !== 'FUNDED' && escrow.status !== 'IN_PROGRESS') {
			throw new BadRequestException('Escrow must be FUNDED or IN_PROGRESS to mark as delivered');
		}

		const publicId = `escrow-${escrowId}-${Date.now()}`;
		const proofUrl = await this.cloudinaryService.uploadBuffer(fileBuffer, {
			folder: 'escrow-proofs',
			resource_type: 'auto',
			public_id: publicId,
		});

		const updated = await this.prisma.escrow.update({
			where: { id: escrowId },
			data: { status: 'UNDER_REVIEW', proofUrl, deliveredAt: new Date() } as any,
		});

		this.kafkaClient.emit(KafkaEvents.ESCROW_DELIVERED, {
			escrowId: updated.id,
			buyerId: updated.buyerId,
			sellerId: updated.sellerId,
			proofUrl,
		});

		return updated;
	}

	async nudgeBuyer(escrowId: string, sellerId: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');
		if (escrow.sellerId !== sellerId) throw new BadRequestException('Only the seller can nudge the buyer');
		if (escrow.status !== 'UNDER_REVIEW') {
			throw new BadRequestException('Escrow must be UNDER_REVIEW to nudge buyer');
		}

		this.kafkaClient.emit(KafkaEvents.ESCROW_NUDGE_BUYER, {
			escrowId: escrow.id,
			buyerId: escrow.buyerId,
			sellerId: escrow.sellerId,
		});

		return { message: 'Buyer has been nudged' };
	}

	async fund(escrowId: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) {
      throw new NotFoundException('Escrow not found');
    }
    if (escrow.status !== 'CREATED' && escrow.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('Escrow cannot be funded in its current state');
    }

		// debit buyer
		const buyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });
    if (!buyerWallet) {
      throw new NotFoundException('Buyer wallet not found');
    }
    if (Number(buyerWallet.balance) < Number(escrow.amount)) {
      throw new BadRequestException('Insufficient funds');
    }


		await this.prisma.wallet.update({ where: { id: buyerWallet.id }, data: { balance: { decrement: Number(escrow.amount) } as any } });

		const funded = await this.prisma.escrow.update({ where: { id: escrowId }, data: { status: 'FUNDED' } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_FUNDED, { escrowId: funded.id, buyerId: funded.buyerId, sellerId: funded.sellerId, amount: funded.amount });
		return funded;
	}

	async release(escrowId: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) {
		throw new NotFoundException('Escrow not found');
		}
		if (escrow.status !== 'FUNDED' && escrow.status !== 'UNDER_REVIEW') {
		throw new BadRequestException('Escrow must be FUNDED or UNDER_REVIEW to release');
		}

		// compute fee and seller payout
		const amount = Number(escrow.amount);
		const fee = Number((amount * this.FEE_RATE).toFixed(2));
		const sellerPayout = Number((amount - fee).toFixed(2));

		// credit seller locally (canonical ledger) then attempt provider transfers
		const sellerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.sellerId } });
		if (!sellerWallet) {
			await this.prisma.wallet.create({ data: { userId: escrow.sellerId, balance: sellerPayout } as any });
		} else {
			await this.prisma.wallet.update({ where: { id: sellerWallet.id }, data: { balance: { increment: sellerPayout } as any } });
		}
		const buyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });
		const companyAccount = process.env.COMPANY_ACCOUNT_NUMBER;
		const companyBankCode = process.env.COMPANY_BANK_CODE;

		let sellerCreditedLocally = false;

		try {
			// determine sender account: prefer buyer's reserved account, fall back to ESCROW_HOLDING_ACCOUNT_NUMBER env
			const senderAccount = buyerWallet?.accountNumber || process.env.ESCROW_HOLDING_ACCOUNT_NUMBER;
			if (!senderAccount) throw new Error('No Monnify sender account available');

			// transfer seller payout via Monnify if seller has reserved account
			if (sellerWallet && sellerWallet.accountNumber && sellerWallet.bankCode) {
				await this.transferBetweenMonnifyAccounts(String(senderAccount), String(sellerWallet.accountNumber), String(sellerWallet.bankCode), sellerPayout, `Escrow payout ${escrow.id}`);
				this.logger.debug('Transferred seller payout via Monnify', { escrowId: escrow.id, sellerId: escrow.sellerId, amount: sellerPayout });
			} else {
				// fallback to local wallet credit for seller
				sellerCreditedLocally = true;
				if (!sellerWallet) {
					await this.prisma.wallet.create({ data: { userId: escrow.sellerId, balance: sellerPayout } as any });
				} else {
					await this.prisma.wallet.update({ where: { id: sellerWallet.id }, data: { balance: { increment: sellerPayout } as any } });
				}
				this.logger.debug('Credited seller locally (no Monnify account)', { sellerId: escrow.sellerId, amount: sellerPayout });
			}

			// transfer fee to company via Monnify if configured
			if (companyAccount && companyBankCode) {
				await this.transferBetweenMonnifyAccounts(String(senderAccount), String(companyAccount), String(companyBankCode), fee, `Escrow fee ${escrow.id}`);
				this.logger.debug('Transferred company fee via Monnify', { escrowId: escrow.id, amount: fee });
			} else {
				this.logger.warn('Company bank account not configured for Monnify transfer; crediting local company wallet');
				const companyUserId = process.env.COMPANY_USER_ID;
				if (companyUserId) {
					const companyWallet = await this.prisma.wallet.findUnique({ where: { userId: companyUserId } });
					if (!companyWallet) {
						await this.prisma.wallet.create({ data: { userId: companyUserId, balance: fee } as any });
					} else {
						await this.prisma.wallet.update({ where: { id: companyWallet.id }, data: { balance: { increment: fee } as any } });
					}
				}
			}
		} catch (e: any) {
			this.logger.error('Monnify transfer failed; falling back to local credits where necessary', e?.response?.data || e?.message || e);
			// If seller wasn't credited locally yet, credit now
			if (!sellerCreditedLocally) {
				if (!sellerWallet) {
					await this.prisma.wallet.create({ data: { userId: escrow.sellerId, balance: sellerPayout } as any });
				} else {
					await this.prisma.wallet.update({ where: { id: sellerWallet.id }, data: { balance: { increment: sellerPayout } as any } });
				}
			}
			// ensure company local wallet credited as fallback
			const companyUserId = process.env.COMPANY_USER_ID;
			if (companyUserId) {
				const companyWallet = await this.prisma.wallet.findUnique({ where: { userId: companyUserId } });
				if (!companyWallet) {
					await this.prisma.wallet.create({ data: { userId: companyUserId, balance: fee } as any });
				} else {
					await this.prisma.wallet.update({ where: { id: companyWallet.id }, data: { balance: { increment: fee } as any } });
				}
			}
		}

		const released = await this.prisma.escrow.update({ where: { id: escrowId }, data: { status: 'RELEASED', fee } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_RELEASED, { escrowId: released.id, buyerId: released.buyerId, sellerId: released.sellerId, amount: released.amount, fee });
		return released;
	}

	async refund(escrowId: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) {
      throw new NotFoundException('Escrow not found');
    }
    if (escrow.status !== 'FUNDED') {
      throw new BadRequestException('Escrow not funded');
    }

		// credit back buyer
		const buyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });

		if (!buyerWallet) {
			await this.prisma.wallet.create({ data: { userId: escrow.buyerId, balance: escrow.amount } as any });
		} else {
			await this.prisma.wallet.update({ where: { id: buyerWallet.id }, data: { balance: { increment: Number(escrow.amount) } as any } });
		}

		const refunded = await this.prisma.escrow.update({ where: { id: escrowId }, data: { status: 'REFUNDED' } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_REFUNDED, { escrowId: refunded.id, buyerId: refunded.buyerId, sellerId: refunded.sellerId, amount: refunded.amount });
		return refunded;
	}

	async getEscrows(userId: string, preset: 'active' | 'completed' | 'disputed' | 'all' = 'active') {
		const presets: Record<string, string[]> = {
			active: ['CREATED', 'PENDING_PAYMENT', 'FUNDED', 'IN_PROGRESS', 'DELIVERED', 'UNDER_REVIEW'],
			completed: ['COMPLETED', 'RELEASED'],
			disputed: ['DISPUTED'],
		};
		const where: any = {};
		if (preset !== 'all') {
			where.status = { in: presets[preset] || [] };
		}
		if (userId) where.OR = [{ buyerId: userId }, { sellerId: userId }];

		const escrows = await this.prisma.escrow.findMany({ where });

		// collect unique user ids
		const userIds = new Set<string>();
		escrows.forEach((e) => {
			if (e.buyerId) userIds.add(e.buyerId);
			if (e.sellerId) userIds.add(e.sellerId);
		});

		const users = await this.prisma.user.findMany({
			where: { id: { in: Array.from(userIds) } },
			select: { id: true, fullName: true, email: true },
		});
		const userMap = new Map(users.map((u) => [u.id, u]));

		return escrows.map((escrow) => {
			const buyer = userMap.get(escrow.buyerId) ? { id: escrow.buyerId, name: userMap.get(escrow.buyerId)!.fullName, email: userMap.get(escrow.buyerId)!.email } : null;
			const seller = userMap.get(escrow.sellerId) ? { id: escrow.sellerId, name: userMap.get(escrow.sellerId)!.fullName, email: userMap.get(escrow.sellerId)!.email } : null;

			if (userId) {
				if (userId === escrow.sellerId) {
					return { ...escrow, user: buyer };
				}
				if (userId === escrow.buyerId) {
					return { ...escrow, user: seller };
				}
			}
		});
	}

	async getEscrowById(escrowId: string, currentUserId?: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');

		const [buyer, seller] = await Promise.all([
			this.prisma.user.findUnique({ where: { id: escrow.buyerId }, select: { id: true, fullName: true, email: true } }),
			this.prisma.user.findUnique({ where: { id: escrow.sellerId }, select: { id: true, fullName: true, email: true } }),
		]);

		const buyerObj = buyer ? { id: buyer.id, name: buyer.fullName, email: buyer.email } : null;
		const sellerObj = seller ? { id: seller.id, name: seller.fullName, email: seller.email } : null;

		if (currentUserId) {
			if (currentUserId === escrow.sellerId) return { ...escrow, buyer: buyerObj };
			if (currentUserId === escrow.buyerId) return { ...escrow, seller: sellerObj };
		}

		return { ...escrow, buyer: buyerObj, seller: sellerObj };
	}

	async getEscrowStats(userId: string) {
		const activeStatuses = [
			'CREATED',
			'PENDING_PAYMENT',
			'FUNDED',
			'IN_PROGRESS',
			'DELIVERED',
			'UNDER_REVIEW',
		];

		const activeEscrows = await this.prisma.escrow.findMany({
			where: {
				status: {
					in: activeStatuses,
				},
				OR: [{ buyerId: userId }, { sellerId: userId }],
			},
			select: {
				amount: true,
				status: true,
				buyerId: true,
				sellerId: true,
			},
		});

		const totalActiveEscrowAmount = activeEscrows.reduce((sum, escrow) => sum + Number(escrow.amount), 0);

		const pendingReleaseAmount = activeEscrows
		.filter(
			(escrow) =>
			(escrow.status === 'FUNDED' || escrow.status === 'UNDER_REVIEW') &&
			escrow.sellerId === userId,
		)
		.reduce((sum, escrow) => sum + Number(escrow.amount), 0);

		return {
			totalActiveEscrowAmount,
			pendingReleaseAmount,
			activeEscrowCount: activeEscrows.length,
		};
	}
}

import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';
import axios from 'axios';
import * as crypto from 'crypto';

import { KafkaEvents } from '@org/kafka';
import { CloudinaryService } from './cloudinary.service';

@Injectable()
export class EscrowService implements OnModuleDestroy {
	constructor(
		private readonly prisma: PrismaService,
		@Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientProxy,
		private readonly cloudinaryService: CloudinaryService,
	) {
		// start periodic inspection expiry checks
		this.startInspectionExpiryChecks();
	}

	// In-memory retry tracker for expired inspection releases
	private inspectionRetryMap: Map<string, { attempts: number; nextAttemptAt: number }> = new Map();

	private FEE_RATE = 0.015;

	private readonly logger = new Logger(EscrowService.name);

	// In-memory Monnify token cache — avoids a round-trip on every transfer
	private monnifyTokenCache: { token: string; expiresAt: number } | null = null;
	private inspectionIntervalHandle: NodeJS.Timeout | null = null;

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

	private async transferBetweenMonnifyAccounts(senderAccountNumber: string, beneficiaryAccountNumber: string, beneficiaryBankCode: string, amount: number, narration = 'Escrow transfer') {
		const token = await this.getMonnifyAccessToken();
		const base = process.env.MONNIFY_BASE_URL!;
		// Use Monnify Disbursement single endpoint
		const url = `${base}/disbursement/single`;
		const payload: any = {
			contractCode: process.env.MONNIFY_CONTRACT_CODE,
			amount,
			accountNumber: beneficiaryAccountNumber,
			bankCode: beneficiaryBankCode,
			narration,
			externalReference: `escrow-${Date.now().toString(36)}`,
			debitAccountNumber: senderAccountNumber,
		};
		this.logger.debug('Initiating Monnify disbursement (single)', { url, senderAccountNumber, beneficiaryAccountNumber, amount });
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
		creatorRole: 'BUYER' | 'SELLER';
		authenticatedUserId: string;
		authenticatedUserEmail?: string;
		buyerEmail?: string;
		sellerEmail?: string;
		milestones: string[];
		amount: number;
		deliveryDeadline: string | Date;
		inspectionPeriodDays: 1 | 3 | 5 | 7;
		description?: string;
	}) {
		const {
			creatorRole,
			authenticatedUserId,
			authenticatedUserEmail,
			buyerEmail,
			sellerEmail,
			milestones,
			amount,
			deliveryDeadline,
			inspectionPeriodDays,
			description,
		} = opts;
		if (amount <= 0) throw new BadRequestException('Amount must be positive');

		let buyerId: string;
		let sellerId: string;
		let buyerContactEmail: string | null = null;
		let sellerContactEmail: string | null = null;

		if (creatorRole === 'SELLER') {
			if (!buyerEmail) throw new BadRequestException('Buyer email is required when creatorRole is SELLER');
			buyerId = await this.findUserIdByEmail(buyerEmail);
			sellerId = authenticatedUserId;
			buyerContactEmail = buyerEmail;
			sellerContactEmail = authenticatedUserEmail || null;
		} else {
			if (!sellerEmail) throw new BadRequestException('Seller email is required when creatorRole is BUYER');
			sellerId = await this.findUserIdByEmail(sellerEmail);
			buyerId = authenticatedUserId;
			buyerContactEmail = authenticatedUserEmail || null;
			sellerContactEmail = sellerEmail;
		}

		if (buyerId === sellerId) {
			throw new BadRequestException('Buyer and seller must be different users');
		}

		// generate escrow code and payment reference + link
		const escrowCode = await this.generateEscrowCode();
		const paymentReference = this.generatePaymentReference();
		// Single-use token for the buyer's email approval link - the escrow stays gated in
		// PENDING_APPROVAL (no delivery, no funding) until this is consumed via approveByBuyer().
		const approvalToken = crypto.randomBytes(32).toString('hex');

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
				status: 'PENDING_APPROVAL',
				approvalToken,
			} as any,
		});

		// create transaction record representing the pending payment for this escrow
		const fee = Number((amount * this.FEE_RATE).toFixed(2));
		await this.prisma.transaction.create({
			data: {
				userId: buyerId,
				type: 'DEPOSIT',
				title: `Escrow payment ${created.id}`,
				amount: amount as any,
				status: 'PENDING',
				metadata: { escrowId: created.id, milestones } as any,
				provider: process.env.PAYMENT_PROVIDER,
				providerReference: paymentReference,
				referenceId: created.id,
				fee: fee as any,
				paymentType: 'ESCROW',
			} as any,
		});

		const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
		const approvalLink = `${apiBaseUrl}/escrow/${created.id}/approve?token=${approvalToken}`;

		this.kafkaClient.emit(KafkaEvents.ESCROW_CREATED, {
			escrowId: created.id,
			buyerId,
			sellerId,
			amount,
			creatorRole,
			buyerEmail: buyerContactEmail,
			sellerEmail: sellerContactEmail,
			approvalLink,
		});
		this.kafkaClient.emit(KafkaEvents.ESCROW_PAYMENT_INITIATED, {
			escrowId: created.id,
			paymentReference,
			amount,
			fee,
			buyerEmail: buyerContactEmail,
		});

		return { escrow: created, paymentReference };
	}

	// Consumes the single-use token from the buyer's approval email link. Moves the escrow out
	// of PENDING_APPROVAL (where delivery/funding are blocked) into IN_PROGRESS.
	async approveByBuyer(escrowId: string, token: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');

		if (escrow.status !== 'PENDING_APPROVAL') {
			throw new BadRequestException(escrow.approvedAt ? 'This escrow has already been approved' : 'This escrow is not awaiting approval');
		}
		if (!token || !escrow.approvalToken || escrow.approvalToken !== token) {
			throw new BadRequestException('Invalid or expired approval link');
		}

		const updated = await this.prisma.escrow.update({
			where: { id: escrowId },
			data: { status: 'IN_PROGRESS', approvedAt: new Date(), approvalToken: null } as any,
		});

		const sellerUser = await this.prisma.user.findUnique({ where: { id: updated.sellerId }, select: { email: true } });
		this.kafkaClient.emit(KafkaEvents.ESCROW_APPROVED, {
			escrowId: updated.id,
			buyerId: updated.buyerId,
			sellerId: updated.sellerId,
			sellerEmail: sellerUser?.email || null,
		});

		return updated;
	}

	private generatePaymentReference() {
		return `${Date.now().toString(36).slice(2, 9)}`;
	}

	private async generateEscrowCode() {
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

		const releasableStatuses = ['UNDER_REVIEW'];
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

	async deliver(escrowId: string, fileBuffer: Buffer, sellerId: string) {
		console.log({ escrowId, sellerId, fileBufferLength: fileBuffer.length });
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');
		if (escrow.sellerId !== sellerId) throw new BadRequestException('Only the seller can mark as delivered');
		if (escrow.status !== 'FUNDED' && escrow.status !== 'IN_PROGRESS') {
			throw new BadRequestException('Escrow must be FUNDED or IN_PROGRESS to mark as delivered');
		}
		console.log({ escrowStatus: escrow.status, isSeller: escrow.sellerId === sellerId });

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
		// CREATED/PENDING_PAYMENT are legacy pre-approval statuses that createEscrowDetailed()
		// no longer assigns (every escrow now starts at PENDING_APPROVAL) - kept here only in
		// case a future payment-webhook path reintroduces them. IN_PROGRESS is the real status
		// every escrow is actually in once approveByBuyer() clears it for funding/delivery.
		const fundableStatuses = ['CREATED', 'PENDING_PAYMENT', 'IN_PROGRESS'];
		if (!fundableStatuses.includes(escrow.status)) {
			throw new BadRequestException('Escrow cannot be funded in its current state');
		}

		// debit buyer
		const buyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });
		if (!buyerWallet) {
			throw new NotFoundException('Buyer wallet not found');
		}
		if (Number(buyerWallet.balance) < Number(escrow.amount)) {
			throw new BadRequestException('INSUFFICIENT_FUNDS');
		}

		await this.prisma.wallet.update({ where: { id: buyerWallet.id }, data: { balance: { decrement: Number(escrow.amount) } as any } });

		const funded = await this.prisma.escrow.update({ where: { id: escrowId }, data: { status: 'FUNDED' } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_FUNDED, { escrowId: funded.id, buyerId: funded.buyerId, sellerId: funded.sellerId, amount: funded.amount });
		return funded;
	}

	async release(escrowId: string, opts: { viaDisputeResolution?: boolean } = {}) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) {
			throw new NotFoundException('Escrow not found');
		}

		// Enforce fund lock — if escrow is locked due to an open dispute, reject release.
		// A dispute resolution verdict is the one legitimate way to release a locked escrow;
		// it unlocks as part of settling, rather than requiring the normal unlocked precondition.
		if (escrow.isLocked === true && !opts.viaDisputeResolution) {
			throw new ConflictException(`Escrow is locked due to ${escrow.lockedReason || 'an open dispute'}. Funds cannot be released while locked.`);
		}

		const buyerUser = await this.prisma.user.findUnique({ where: { id: escrow.buyerId }, select: { email: true } });
		const buyerEmail = buyerUser?.email || null;
		const releasableStatuses = opts.viaDisputeResolution
			? ['UNDER_REVIEW', 'IN_PROGRESS', 'DELIVERED', 'FUNDED', 'DISPUTED']
			: ['UNDER_REVIEW'];
		if (!releasableStatuses.includes(escrow.status)) {
			throw new BadRequestException(`Escrow must be UNDER_REVIEW to release`);
		}

		// compute fee and seller payout
		const amount = Number(escrow.amount);
		const fee = Number((amount * this.FEE_RATE).toFixed(2));
		const sellerPayout = Number((amount - fee).toFixed(2));

		// Ensure company receives the fee first (attempt provider transfer, fallback to local company wallet).
		// Local wallet credits must only occur as explicit fallbacks when Monnify is not available.
		const sellerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.sellerId } });
		const buyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });
		const companyAccount = process.env.COMPANY_ACCOUNT_NUMBER;
		const companyBankCode = process.env.COMPANY_BANK_CODE;

		// determine sender account: prefer buyer's reserved account, fall back to ESCROW_HOLDING_ACCOUNT_NUMBER env
		const senderAccount = buyerWallet?.accountNumber;

		// First: transfer fee to company (best-effort). If Monnify not configured or transfer fails, credit local company wallet if configured.
		try {
			if (companyAccount && companyBankCode && senderAccount) {
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
					try {
						await this.prisma.transaction.create({
							data: {
								userId: companyUserId,
								type: 'DEPOSIT',
								title: `Escrow fee ${escrow.id}`,
								amount: fee as any,
								status: 'COMPLETED',
								metadata: { escrowId } as any,
							},
						});
					} catch (e: any) {
						this.logger.warn('Failed to create company transaction record (local credit)', e?.message || e);
					}
				}
			}
		} catch (e: any) {
			this.logger.error('Failed to transfer fee to company via Monnify; crediting local company wallet if configured', e?.response?.data || e?.message || e);
			const companyUserId = process.env.COMPANY_USER_ID;
			if (companyUserId) {
				const companyWallet = await this.prisma.wallet.findUnique({ where: { userId: companyUserId } });
				if (!companyWallet) {
					await this.prisma.wallet.create({ data: { userId: companyUserId, balance: fee } as any });
				} else {
					await this.prisma.wallet.update({ where: { id: companyWallet.id }, data: { balance: { increment: fee } as any } });
				}
				try {
					await this.prisma.transaction.create({
						data: {
							userId: companyUserId,
							type: 'DEPOSIT',
							title: `Escrow fee (fallback) ${escrow.id}`,
							amount: fee as any,
							status: 'COMPLETED',
							metadata: { escrowId } as any,
						},
					});
				} catch (e: any) {
					this.logger.warn('Failed to create company transaction record after fallback credit', e?.message || e);
				}
			}
		}

		let sellerTransferSucceeded = false;
		let sellerProviderResp: any = null;
		try {
			// transfer seller payout via Monnify if seller has reserved account
			if (sellerWallet && sellerWallet.accountNumber && sellerWallet.bankCode && senderAccount) {
				const resp = await this.transferBetweenMonnifyAccounts(String(senderAccount), String(sellerWallet.accountNumber), String(sellerWallet.bankCode), sellerPayout, `Escrow payout ${escrow.id}`);
				sellerProviderResp = resp;
				sellerTransferSucceeded = true;
				this.logger.debug('Transferred seller payout via Monnify', { escrowId: escrow.id, sellerId: escrow.sellerId, amount: sellerPayout, resp });
			} else {
				// Seller has no provider reserved account — do not credit locally automatically.
				this.logger.warn('Seller has no provider reserved account; skipping automatic local credit. Manual payout required', { sellerId: escrow.sellerId, escrowId: escrow.id, amount: sellerPayout });
			}
		} catch (e: any) {
			this.logger.error('Monnify seller payout failed; payout must be retried/handled manually', e?.response?.data || e?.message || e);
		}

		// If provider payout succeeded, reflect it in the seller's local wallet and ledger
		if (sellerTransferSucceeded) {
			try {
				const currentSellerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.sellerId } });
				if (!currentSellerWallet) {
					await this.prisma.wallet.create({ data: { userId: escrow.sellerId, balance: sellerPayout } as any });
				} else {
					await this.prisma.wallet.update({ where: { id: currentSellerWallet.id }, data: { balance: { increment: sellerPayout } as any } });
				}

				const currentBuyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });
				if (currentBuyerWallet) {
					await this.prisma.wallet.update({ where: { id: currentBuyerWallet.id }, data: { balance: { decrement: sellerPayout } as any } });
				} else {
					this.logger.warn('Buyer wallet not found when attempting to reflect seller payout; manual reconciliation may be required', { buyerId: escrow.buyerId, escrowId: escrow.id });
				}

				try {
					await this.prisma.transaction.create({
						data: {
							userId: escrow.sellerId,
							type: 'DEPOSIT',
							title: `Escrow payout ${escrow.id}`,
							amount: sellerPayout as any,
							status: 'COMPLETED',
							metadata: { escrowId, providerResponse: sellerProviderResp } as any,
						},
					});
				} catch (e: any) {
					this.logger.warn('Failed to create seller transaction record after payout', e?.message || e);
				}
			} catch (e: any) {
				this.logger.warn('Failed to update/create seller wallet after provider payout', e?.message || e);
			}
		}

		// Update buyer payment to SUCCESS if payout succeeded, and ensure a seller payout record exists.
		try {
			// create or ensure seller payout payment record exists
			const existingPayout = await this.prisma.transaction.findFirst({ where: { referenceId: escrowId, userId: escrow.sellerId, paymentType: 'PAYOUT' } });
			if (!existingPayout) {
				const provider = process.env.PAYMENT_PROVIDER;
				const possibleRef = (sellerProviderResp && (sellerProviderResp.responseBody?.transactionReference || sellerProviderResp.transactionReference || sellerProviderResp.response?.transactionReference)) || `escrow-payout-${escrowId}-${Date.now().toString(36)}`;
				await this.prisma.transaction.create({
					data: {
						userId: escrow.sellerId,
						type: 'PAYOUT',
						title: `Escrow payout ${escrowId}`,
						amount: sellerPayout as any,
						referenceId: escrowId,
						fee: 0 as any,
						paymentType: 'PAYOUT',
						provider: provider,
						providerReference: possibleRef,
						metadata: { escrowId, sellerPayout } as any,
						status: sellerTransferSucceeded ? 'COMPLETED' : 'PENDING',
					} as any,
				});
			} else {
				// update existing payout record if it exists
				await this.prisma.transaction.update({
					where: { id: existingPayout.id },
					data: {
						amount: sellerPayout as any,
						status: sellerTransferSucceeded ? 'COMPLETED' : 'PENDING',
						metadata: { escrowId, sellerPayout, providerResponse: sellerProviderResp } as any,
					} as any,
				});
			}
		} catch (e: any) {
			this.logger.warn('Failed to update escrow payment record or create seller payout record', e?.message || e);
		}

		const released = await this.prisma.escrow.update({
			where: { id: escrowId },
			data: opts.viaDisputeResolution
				? { status: 'RELEASED', isLocked: false, lockedReason: null }
				: { status: 'RELEASED' },
		} as any);
		this.kafkaClient.emit(KafkaEvents.ESCROW_RELEASED, { escrowId: released.id, buyerId: released.buyerId, sellerId: released.sellerId, amount: released.amount, fee, buyerEmail });
		return released;
    }

	async refund(escrowId: string, opts: { viaDisputeResolution?: boolean } = {}) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) {
			throw new NotFoundException('Escrow not found');
		}
		if (escrow.isLocked === true && !opts.viaDisputeResolution) {
			throw new ConflictException(`Escrow is locked due to ${escrow.lockedReason || 'an open dispute'}. Funds cannot be refunded while locked.`);
		}
		const refundableStatuses = opts.viaDisputeResolution
			? ['FUNDED', 'IN_PROGRESS', 'DELIVERED', 'UNDER_REVIEW', 'DISPUTED']
			: ['FUNDED'];
		if (!refundableStatuses.includes(escrow.status)) {
			throw new BadRequestException('Escrow not funded');
		}

		// credit back buyer
		const buyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });

		if (!buyerWallet) {
			await this.prisma.wallet.create({ data: { userId: escrow.buyerId, balance: escrow.amount } as any });
		} else {
			await this.prisma.wallet.update({ where: { id: buyerWallet.id }, data: { balance: { increment: Number(escrow.amount) } as any } });
		}

		const refunded = await this.prisma.escrow.update({
			where: { id: escrowId },
			data: opts.viaDisputeResolution
				? { status: 'REFUNDED', isLocked: false, lockedReason: null }
				: { status: 'REFUNDED' },
		} as any);
		this.kafkaClient.emit(KafkaEvents.ESCROW_REFUNDED, { escrowId: refunded.id, buyerId: refunded.buyerId, sellerId: refunded.sellerId, amount: refunded.amount });
		return refunded;
	}

	async cancel(escrowId: string, requesterId: string, reason?: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) {
			throw new NotFoundException('Escrow not found');
		}
		if (requesterId !== escrow.buyerId && requesterId !== escrow.sellerId) {
			throw new BadRequestException('Only the buyer or seller on this escrow can cancel it');
		}

		const cancellableStatuses = ['CREATED', 'PENDING_APPROVAL', 'PENDING_PAYMENT', 'FUNDED', 'IN_PROGRESS'];
		if (!cancellableStatuses.includes(escrow.status)) {
			throw new BadRequestException(`Cannot cancel an escrow with status ${escrow.status}`);
		}

		const wasFunded = escrow.status === 'FUNDED' || escrow.status === 'IN_PROGRESS';

		if (wasFunded) {
			// refund the locked funds back to the buyer, same as refund()
			const buyerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.buyerId } });
			if (!buyerWallet) {
				await this.prisma.wallet.create({ data: { userId: escrow.buyerId, balance: escrow.amount } as any });
			} else {
				await this.prisma.wallet.update({ where: { id: buyerWallet.id }, data: { balance: { increment: Number(escrow.amount) } as any } });
			}
		}

		const cancelled = await this.prisma.escrow.update({
			where: { id: escrowId },
			data: { status: 'CANCELLED', lockedReason: reason || null } as any,
		});

		this.kafkaClient.emit(KafkaEvents.ESCROW_CANCELLED, {
			escrowId: cancelled.id,
			buyerId: cancelled.buyerId,
			sellerId: cancelled.sellerId,
			amount: cancelled.amount,
			wasFunded,
			reason,
		});

		return cancelled;
	}

	async getEscrows(userId: string, preset: 'active' | 'completed' | 'disputed' | 'all' = 'active', page = 1, limit = 20) {
		const presets: Record<string, string[]> = {
			active: ['PENDING_APPROVAL', 'CREATED', 'PENDING_PAYMENT', 'FUNDED', 'IN_PROGRESS', 'DELIVERED', 'UNDER_REVIEW'],
			completed: ['COMPLETED', 'RELEASED'],
			disputed: ['DISPUTED'],
		};
		const where: any = {};
		if (preset !== 'all') {
			where.status = { in: presets[preset] || [] };
		}
		if (userId) where.OR = [{ buyerId: userId }, { sellerId: userId }];

		const take = Math.min(limit, 100);
		const skip = Math.max(0, (page - 1) * take);

		const [escrows, total] = await Promise.all([
			this.prisma.escrow.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
			this.prisma.escrow.count({ where }),
		]);

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

		const data = escrows.map((escrow) => {
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

			return { ...escrow, buyer, seller };
		});

		return { data, page, limit: take, total };
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
			'PENDING_APPROVAL',
			'CREATED',
			'PENDING_PAYMENT',
			'FUNDED',
			'IN_PROGRESS',
			'DELIVERED',
			'UNDER_REVIEW',
		] as const;

		const activeEscrows = await this.prisma.escrow.findMany({
			where: {
				status: {
					in: activeStatuses as any,
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

	async lockEscrowOnDisputeOpen(escrowId: string, disputeId: string, breachCategory: string) {
		try {
			const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
			if (!escrow) {
				this.logger.warn(`Escrow ${escrowId} not found when locking on dispute open (dispute: ${disputeId})`);
				return;
			}

			// If already locked, just log and return (idempotent)
			if (escrow.isLocked === true) {
				this.logger.debug(`Escrow ${escrowId} already locked (dispute: ${disputeId})`);
				return;
			}

			// Lock the escrow
			const locked = await this.prisma.escrow.update({
				where: { id: escrowId },
				data: {
					isLocked: true,
					lockedReason: 'DISPUTE_OPEN',
					lockedAt: new Date(),
				},
			});

			this.logger.log(`Escrow ${escrowId} locked via Kafka dispute.opened event (dispute: ${disputeId})`);
			this.kafkaClient.emit(KafkaEvents.ESCROW_LOCKED, {
				escrowId: locked.id,
				disputeId,
				breachCategory,
				lockedAt: locked.lockedAt,
			});
		} catch (err: any) {
			this.logger.error(`Failed to lock escrow ${escrowId} on dispute open event`, err?.message || err);
		}
	}

	// Entry point for every DISPUTE_RESOLVED event, whether or not it carries a fund-moving
	// verdict. Only the bot's AI adjudication (and, in future, a structured admin decision)
	// currently sets `verdict` - admin free-text resolutions and mutual settlements do not, since
	// neither captures which party should receive the funds. Those still close out the dispute,
	// though, so the lock DISPUTE_OPENED put in place must be released either way; otherwise the
	// escrow is stuck locked forever with no verdict ever arriving to unlock it.
	async handleDisputeResolved(escrowId: string, disputeId: string, verdict?: 'RELEASE_TO_SELLER' | 'REFUND_BUYER') {
		if (verdict === 'RELEASE_TO_SELLER' || verdict === 'REFUND_BUYER') {
			return this.applyDisputeVerdict(escrowId, verdict, disputeId);
		}

		try {
			const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
			if (!escrow || !escrow.isLocked) return;
			await this.prisma.escrow.update({ where: { id: escrowId }, data: { isLocked: false, lockedReason: null, lockedAt: null } });
			this.logger.log(`Escrow ${escrowId} unlocked after dispute ${disputeId} resolved without a fund-moving verdict`);
		} catch (err: any) {
			this.logger.error(`Failed to unlock escrow ${escrowId} after dispute ${disputeId} resolved`, err?.message || err);
		}
	}

	// Triggered when dispute-service resolves a dispute with a fund-moving verdict (bot
	// adjudication or an admin decision that specifies one). Idempotent against repeat delivery.
	async applyDisputeVerdict(escrowId: string, verdict: 'RELEASE_TO_SELLER' | 'REFUND_BUYER', disputeId: string) {
		try {
			const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
			if (!escrow) {
				this.logger.warn(`Escrow ${escrowId} not found when applying dispute verdict (dispute: ${disputeId})`);
				return;
			}
			if (['RELEASED', 'REFUNDED', 'COMPLETED', 'CANCELLED'].includes(escrow.status)) {
				this.logger.debug(`Escrow ${escrowId} already settled (status ${escrow.status}); ignoring dispute verdict`);
				return;
			}

			if (verdict === 'RELEASE_TO_SELLER') {
				await this.release(escrowId, { viaDisputeResolution: true });
			} else if (verdict === 'REFUND_BUYER') {
				await this.refund(escrowId, { viaDisputeResolution: true });
			}
			this.logger.log(`Applied dispute verdict ${verdict} to escrow ${escrowId} (dispute: ${disputeId})`);
		} catch (err: any) {
			this.logger.error(`Failed to apply dispute verdict to escrow ${escrowId} (dispute: ${disputeId})`, err?.message || err);
		}
	}

	// Start periodic inspection expiry checks
	private startInspectionExpiryChecks() {
		const intervalMinutes = Number(process.env.INSPECTION_CHECK_INTERVAL_MINUTES) || 10;
		this.inspectionIntervalHandle = setInterval(() => {
			this.processExpiredInspections().catch((e) => this.logger.error('Inspection expiry check failed', e?.message || e));
		}, intervalMinutes * 60 * 1000);
		this.logger.log(`Inspection expiry checks scheduled every ${intervalMinutes} minutes`);
	}

	async onModuleDestroy() {
		if (this.inspectionIntervalHandle) {
			clearInterval(this.inspectionIntervalHandle);
			this.inspectionIntervalHandle = null;
		}
	}

	private async processExpiredInspections() {
		this.logger.debug('Running inspection expiry scan');
		const now = new Date();
		// Find escrows that are UNDER_REVIEW and whose deliveredAt + inspectionPeriodDays <= now
		const candidates = await this.prisma.escrow.findMany({
			where: {
				status: 'UNDER_REVIEW',
				deliveredAt: { not: null },
			},
		});

		for (const e of candidates) {
			const delivered = e.deliveredAt as Date;
			const expiry = new Date(delivered.getTime() + Number(e.inspectionPeriodDays || 0) * 24 * 60 * 60 * 1000);
			if (expiry <= now) {
				// Already expired — attempt release with retries
				this.attemptReleaseWithRetries(e.id).catch((err) => this.logger.warn('attemptReleaseWithRetries failed', err?.message || err));
			}
		}
	}

	private async attemptReleaseWithRetries(escrowId: string) {
		const maxAttempts = Number(process.env.INSPECTION_RELEASE_MAX_ATTEMPTS) || 12;
		const retryIntervalMinutes = Number(process.env.INSPECTION_RELEASE_RETRY_MINUTES) || 5;
		const key = escrowId;
		const state = this.inspectionRetryMap.get(key) || { attempts: 0, nextAttemptAt: 0 };
		if (state.attempts >= maxAttempts) {
			this.logger.warn('Max release attempts reached for escrow', escrowId);
			return;
		}
		state.attempts += 1;
		this.inspectionRetryMap.set(key, state);
		try {
			this.logger.log(`Attempting release for expired escrow ${escrowId} (attempt ${state.attempts})`);
			await this.release(escrowId);
			this.inspectionRetryMap.delete(key);
			this.logger.log(`Release succeeded for expired escrow ${escrowId}`);
		} catch (e: any) {
			this.logger.warn(`Release attempt ${state.attempts} failed for escrow ${escrowId}`, e?.message || e);
			// emit failure event so notification service can inform buyer
			const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
			const buyerUser = await this.prisma.user.findUnique({ where: { id: escrow?.buyerId }, select: { email: true } });
			this.kafkaClient.emit(KafkaEvents.ESCROW_RELEASE_FAILED, {
				escrowId,
				buyerId: escrow?.buyerId,
				sellerId: escrow?.sellerId,
				reason: e?.message || e,
				buyerEmail: buyerUser?.email || null,
				attempt: state.attempts,
			});
			// schedule next attempt
			state.nextAttemptAt = Date.now() + retryIntervalMinutes * 60 * 1000;
			this.inspectionRetryMap.set(key, state);
			setTimeout(() => this.attemptReleaseWithRetries(escrowId).catch((err) => this.logger.warn('Retry failed', err?.message || err)), retryIntervalMinutes * 60 * 1000);
		}
	}
}

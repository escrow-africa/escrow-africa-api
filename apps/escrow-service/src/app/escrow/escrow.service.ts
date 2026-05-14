import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';

import { KafkaEvents } from '@org/kafka';

@Injectable()
export class EscrowService {
	constructor(
		private readonly prisma: PrismaService,
		@Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientProxy,
	) {}

	private FEE_RATE = 0.015;

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

	/**
	 * Extend an escrow delivery deadline.
	 */
	async extendDeadline(escrowId: string, newDeadline: string | Date) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');
		const updated = await this.prisma.escrow.update({ where: { id: escrowId }, data: { deliveryDeadline: new Date(newDeadline) } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_DEADLINE_EXTENDED, { escrowId: updated.id, newDeadline: updated.deliveryDeadline });
		return updated;
	}

	/**
	 * Mark an escrow as completed. If it's still FUNDED, release funds then mark completed.
	 */
	async markCompleted(escrowId: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
		if (!escrow) throw new NotFoundException('Escrow not found');
		if (escrow.status === 'FUNDED') {
			// release funds first
			await this.release(escrowId);
			// ensure we fetch latest
		}
		if (escrow.status !== 'RELEASED' && escrow.status !== 'FUNDED') {
			throw new BadRequestException('Escrow cannot be marked completed in its current state');
		}
		const updated = await this.prisma.escrow.update({ where: { id: escrowId }, data: { status: 'COMPLETED' } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_COMPLETED, { escrowId: updated.id, buyerId: updated.buyerId, sellerId: updated.sellerId });
		return updated;
	}

	async fund(escrowId: string) {
		const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) {
      throw new NotFoundException('Escrow not found');
    }
    if (escrow.status !== 'CREATED') {
      throw new BadRequestException('Escrow not in CREATED state');
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
    if (escrow.status !== 'FUNDED') {
      throw new BadRequestException('Escrow not funded');
    }

		// compute fee and seller payout
		const amount = Number(escrow.amount);
		const fee = Number((amount * this.FEE_RATE).toFixed(2));
		const sellerPayout = Number((amount - fee).toFixed(2));

		// credit seller with amount minus fee
		const sellerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.sellerId } });

		if (!sellerWallet) {
			await this.prisma.wallet.create({ data: { userId: escrow.sellerId, balance: sellerPayout } as any });
		} else {
			await this.prisma.wallet.update({ where: { id: sellerWallet.id }, data: { balance: { increment: sellerPayout } as any } });
		}

		// credit company account if configured
		const companyUserId = process.env.COMPANY_USER_ID;
		if (companyUserId) {
			const companyWallet = await this.prisma.wallet.findUnique({ where: { userId: companyUserId } });
			if (!companyWallet) {
				await this.prisma.wallet.create({ data: { userId: companyUserId, balance: fee } as any });
			} else {
				await this.prisma.wallet.update({ where: { id: companyWallet.id }, data: { balance: { increment: fee } as any } });
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

	async getActiveEscrows(userId?: string) {
		const activeStatuses = ['CREATED', 'PENDING_PAYMENT', 'FUNDED', 'IN_PROGRESS', 'DELIVERED'];
		const where: any = { status: { in: activeStatuses } };
		if (userId) {
			where.OR = [{ buyerId: userId }, { sellerId: userId }];
		}
		return this.prisma.escrow.findMany({ where });
	}

	async getCompletedEscrows(userId?: string) {
		const where: any = { status: 'COMPLETED' };
		if (userId) where.OR = [{ buyerId: userId }, { sellerId: userId }];
		return this.prisma.escrow.findMany({ where });
	}

	async getDisputedEscrows(userId?: string) {
		const where: any = { status: { in: ['DISPUTED', 'UNDER_REVIEW'] } };
		if (userId) where.OR = [{ buyerId: userId }, { sellerId: userId }];
		return this.prisma.escrow.findMany({ where });
	}
}

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

	async createEscrow(buyerId: string, sellerId: string, amount: number) {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
		const created = await this.prisma.escrow.create({ data: { buyerId, sellerId, amount, status: 'CREATED' } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_CREATED, { escrowId: created.id, buyerId, sellerId, amount });
		return created;
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

		// credit seller
		const sellerWallet = await this.prisma.wallet.findUnique({ where: { userId: escrow.sellerId } });

		if (!sellerWallet) {
			await this.prisma.wallet.create({ data: { userId: escrow.sellerId, balance: escrow.amount } as any });
		} else {
			await this.prisma.wallet.update({ where: { id: sellerWallet.id }, data: { balance: { increment: Number(escrow.amount) } as any } });
		}

		const released = await this.prisma.escrow.update({ where: { id: escrowId }, data: { status: 'RELEASED' } as any });
		this.kafkaClient.emit(KafkaEvents.ESCROW_RELEASED, { escrowId: released.id, buyerId: released.buyerId, sellerId: released.sellerId, amount: released.amount });
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
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransactionService {
	constructor(private readonly prisma: PrismaService) {}

	async fetchTransactions(userId: string, page = 1, limit = 20, type?: string) {
		const take = Math.min(limit, 100);
		const skip = Math.max(0, (page - 1) * take);

		const where: any = { userId };
		if (type) where.type = type;

		const [data, total] = await Promise.all([
			this.prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
			this.prisma.transaction.count({ where }),
		]);

		return { data, page, limit: take, total };
	}
}

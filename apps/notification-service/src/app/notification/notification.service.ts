import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type NotificationType =
  | 'ESCROW_CREATED'
  | 'ESCROW_APPROVED'
  | 'ESCROW_RELEASED'
  | 'ESCROW_RELEASE_FAILED'
  | 'DISPUTE_OPENED'
  | 'DISPUTE_RESOLVED';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordForUser(userId: string | null | undefined, params: {
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityId?: string;
    link?: string;
  }) {
    if (!userId) return null;

    try {
      return await this.prisma.notification.create({
        data: {
          userId,
          type: params.type as any,
          title: params.title,
          message: params.message,
          relatedEntityId: params.relatedEntityId,
          link: params.link,
        },
      });
    } catch (e: any) {
      this.logger.warn(`Failed to persist notification for user ${userId}`, e?.message || e);
      return null;
    }
  }

  // Dispute events only carry escrowId, not buyer/sellerId — resolved here via a direct read
  // against the shared Postgres schema, the same cross-domain pattern auth-service's
  // getUserStats() already uses to read Wallet/Escrow.
  async getEscrowParties(escrowId: string): Promise<{ buyerId: string; sellerId: string } | null> {
    const escrow = await this.prisma.escrow.findUnique({
      where: { id: escrowId },
      select: { buyerId: true, sellerId: true },
    });
    return escrow;
  }

  async findMine(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return { data, page, limit, total };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, read: false } });
    return { unreadCount: count };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return { message: 'All notifications marked as read' };
  }
}

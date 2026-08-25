import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SUBSCRIPTION_PLANS, findPlan } from './plans';

const RENEWAL_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  getPlans() {
    return SUBSCRIPTION_PLANS;
  }

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return {
      tier: user.subscriptionTier,
      renewsAt: user.subscriptionRenewsAt,
    };
  }

  async upgrade(userId: string, planId: string, authorizationHeader?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const plan = findPlan(planId);
    if (!plan) throw new BadRequestException('Unknown plan');

    if (plan.tier === user.subscriptionTier) {
      throw new BadRequestException('This plan is already active on your account');
    }

    if (plan.price > 0) {
      await this.debitWallet(userId, plan.price, authorizationHeader);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionTier: plan.tier as any,
          subscriptionRenewsAt: new Date(Date.now() + RENEWAL_PERIOD_MS),
        },
      }),
      this.prisma.subscriptionEvent.create({
        data: { userId, tier: plan.tier as any, amount: plan.price },
      }),
    ]);

    return this.getStatus(userId);
  }

  private async debitWallet(userId: string, amount: number, authorizationHeader?: string) {
    const baseUrl = process.env.WALLET_API_URL;
    try {
      const normalized = String(baseUrl).replace(/\/+$/, '');
      await axios.post(
        `${normalized}/api/wallet/debit`,
        { amount },
        { headers: authorizationHeader ? { Authorization: authorizationHeader } : {} },
      );
    } catch (e: any) {
      const message = e?.response?.data?.message || 'Failed to charge wallet for subscription upgrade';
      throw new BadRequestException(message);
    }
  }
}

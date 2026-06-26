import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  private async generateCustomId() {
    const count = await this.prisma.advertisement.count();
    const next = count + 1;
    return `AD-${String(next).padStart(3, '0')}`;
  }

  async create(createDto: CreateAdDto) {
    const customId = await this.generateCustomId();
    const data = {
      customId,
      productTitle: createDto.productTitle,
      description: createDto.description,
      basePrice: createDto.basePrice,
      coverImage: createDto.coverImage,
      promotionPlacementSlot: createDto.promotionPlacementSlot,
      industry: createDto.industry,
      targetAudience: createDto.targetAudience,
      startDate: new Date(createDto.startDate),
      endDate: new Date(createDto.endDate),
      billingDailyBudget: createDto.billingDailyBudget,
      allocatedBudgetLimit: createDto.allocatedBudgetLimit,
      badgeLabel: createDto.badgeLabel,
      presentationTheme: createDto.presentationTheme,
    } as any;

    const ad = await this.prisma.advertisement.create({ data });
    return ad;
  }

  async deposit(adId: string, amount: number) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (amount <= Number(ad.allocatedBudgetLimit)) {
      throw new BadRequestException('Deposit must be greater than allocatedBudgetLimit');
    }
    const updated = await this.prisma.advertisement.update({
      where: { id: adId },
      data: { depositedAmount: { increment: amount }, status: 'ACTIVE' },
    });
    return updated;
  }

  async update(adId: string, dto: UpdateAdDto) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    const data: any = {};
    Object.assign(data, dto);
    if (dto.startDate) data.startDate = new Date(dto.startDate as any);
    if (dto.endDate) data.endDate = new Date(dto.endDate as any);
    const updated = await this.prisma.advertisement.update({ where: { id: adId }, data });
    return updated;
  }

  async pause(adId: string) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    return this.prisma.advertisement.update({ where: { id: adId }, data: { status: 'PAUSED' } });
  }

  async resume(adId: string) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    return this.prisma.advertisement.update({ where: { id: adId }, data: { status: 'ACTIVE' } });
  }

  async terminate(adId: string) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    return this.prisma.advertisement.update({ where: { id: adId }, data: { status: 'TERMINATED' } });
  }

  async delete(adId: string) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    await this.prisma.advertisement.delete({ where: { id: adId } });
    return { success: true };
  }

  async analytics() {
    const now = new Date();
    const totalActivePromotions = await this.prisma.advertisement.count({
      where: { status: 'ACTIVE', startDate: { lte: now }, endDate: { gte: now } as any } as any,
    });
    const agg = await this.prisma.advertisement.aggregate({
      _sum: { impressions: true, clicks: true, revenue: true },
    });
    return {
      totalActivePromotions,
      totalPlatformImpressions: Number(agg._sum.impressions || 0),
      conversionClicks: Number(agg._sum.clicks || 0),
      totalRevenue: Number(agg._sum.revenue || 0),
    };
  }

  async fetchAll(page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = Math.max(0, (page - 1) * take);
    const [data, total] = await Promise.all([
      this.prisma.advertisement.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.advertisement.count(),
    ]);
    return { data, total, page, limit: take };
  }
}

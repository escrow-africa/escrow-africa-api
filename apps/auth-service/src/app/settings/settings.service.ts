import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from './cloudinary.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateBillingDto } from './dto/update-billing.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

const KYC_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const KYC_DOCUMENT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async getUserOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.getUserOrThrow(userId);

    const fullName = dto.fullName || (dto.firstName || dto.lastName
      ? `${dto.firstName || ''} ${dto.lastName || ''}`.trim()
      : undefined);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName ? { fullName } : {}),
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
      },
    });

    const { password: _password, ...rest } = updated as any;
    return rest;
  }

  async uploadAvatar(userId: string, file?: Express.Multer.File) {
    await this.getUserOrThrow(userId);

    if (!file) throw new BadRequestException('Avatar file is required');
    if (!AVATAR_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Avatar must be a JPEG, PNG, or WEBP image');
    }
    if (file.size > AVATAR_MAX_SIZE_BYTES) {
      throw new BadRequestException('Avatar must be 2MB or smaller');
    }

    const avatarUrl = await this.cloudinary.uploadBuffer(file.buffer, {
      folder: 'avatars',
      resource_type: 'image',
      public_id: `user-${userId}-${Date.now()}`,
    });

    await this.prisma.user.update({ where: { id: userId }, data: { avatarUrl } });

    return { avatarUrl };
  }

  async getBilling(userId: string) {
    const user = await this.getUserOrThrow(userId);
    return {
      companyName: user.companyName,
      vatId: user.vatId,
      billingAddress: user.billingAddress,
    };
  }

  async updateBilling(userId: string, dto: UpdateBillingDto) {
    await this.getUserOrThrow(userId);
    const updated = await this.prisma.user.update({ where: { id: userId }, data: dto });
    return {
      companyName: updated.companyName,
      vatId: updated.vatId,
      billingAddress: updated.billingAddress,
    };
  }

  async getNotificationPreferences(userId: string) {
    await this.getUserOrThrow(userId);
    const existing = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (existing) return existing;

    // Defaults mirror the NotificationPreference model's column defaults, without persisting
    // a row until the user actually saves a change.
    return {
      userId,
      escrowContractReleases: true,
      dispersalClearingAlerts: true,
      disputeArbitrationWarning: true,
      tipsPromotionalAnalytics: false,
    };
  }

  async updateNotificationPreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    await this.getUserOrThrow(userId);
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  async getPreferences(userId: string) {
    const user = await this.getUserOrThrow(userId);
    return {
      currency: user.currency,
      language: user.language,
      timezone: user.timezone,
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    await this.getUserOrThrow(userId);
    const updated = await this.prisma.user.update({ where: { id: userId }, data: dto });
    return {
      currency: updated.currency,
      language: updated.language,
      timezone: updated.timezone,
    };
  }

  async submitKyc(userId: string, documentType: string, file?: Express.Multer.File) {
    await this.getUserOrThrow(userId);

    if (!file) throw new BadRequestException('KYC document file is required');
    if (!KYC_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Document must be a PDF, JPEG, or PNG file');
    }
    if (file.size > KYC_DOCUMENT_MAX_SIZE_BYTES) {
      throw new BadRequestException('Document must be 5MB or smaller');
    }

    const documentUrl = await this.cloudinary.uploadBuffer(file.buffer, {
      folder: 'kyc-documents',
      resource_type: 'auto',
      public_id: `kyc-${userId}-${Date.now()}`,
    });

    return this.prisma.kyc.create({
      data: { userId, documentType, documentUrl, status: 'PENDING' },
    });
  }

  async getKycStatus(userId: string) {
    await this.getUserOrThrow(userId);
    const latest = await this.prisma.kyc.findFirst({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
    });

    if (!latest) return { status: 'NOT_SUBMITTED' };

    return {
      status: latest.status,
      documentType: latest.documentType,
      submittedAt: latest.submittedAt,
      reviewedAt: latest.reviewedAt,
      rejectionReason: latest.rejectionReason,
    };
  }
}

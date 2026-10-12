import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { KycReviewDecision, ReviewKycDto } from './dto/review-kyc.dto';
import * as bcrypt from 'bcryptjs';

const DEFAULT_VERIFIED_MONTHLY_DISPERSAL_LIMIT = 2_000_000;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createAdminDto: CreateAdminDto, creatorRole: string) {
    if (creatorRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only Super Admins can add other admins.');
    }

    const existingAdmin = await this.prisma.admin.findUnique({
      where: { email: createAdminDto.email },
    });

    if (existingAdmin) {
      throw new ConflictException('Admin with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(createAdminDto.password, 10);

    return this.prisma.admin.create({
      data: {
        fullName: createAdminDto.fullName,
        email: createAdminDto.email,
        password: hashedPassword,
        role: createAdminDto.role || 'ADMIN',
      },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
  }

  async seedSuperAdmin(createAdminDto: CreateAdminDto) {
    const adminCount = await this.prisma.admin.count();
    if (adminCount > 0) {
      throw new ForbiddenException('Admins already exist. Use the authenticated endpoint.');
    }

    const hashedPassword = await bcrypt.hash(createAdminDto.password, 10);

    return this.prisma.admin.create({
      data: {
        fullName: createAdminDto.fullName,
        email: createAdminDto.email,
        password: hashedPassword,
        role: 'SUPER_ADMIN',
      },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.admin.findUnique({ where: { email } });
  }

  async findAll(page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = Math.max(0, (page - 1) * take);

    const [data, total] = await Promise.all([
      this.prisma.admin.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: { id: true, email: true, fullName: true, role: true, createdAt: true },
      }),
      this.prisma.admin.count(),
    ]);

    return { data, page, limit: take, total };
  }

  async listKycSubmissions(status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING', page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = Math.max(0, (page - 1) * take);

    const [data, total] = await Promise.all([
      this.prisma.kyc.findMany({
        where: { status },
        orderBy: { submittedAt: 'asc' },
        skip,
        take,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, kycTier: true } },
        },
      }),
      this.prisma.kyc.count({ where: { status } }),
    ]);

    return { data, page, limit: take, total };
  }

  async reviewKyc(kycId: string, dto: ReviewKycDto) {
    const kyc = await this.prisma.kyc.findUnique({ where: { id: kycId } });
    if (!kyc) throw new NotFoundException('KYC submission not found');
    if (kyc.status !== 'PENDING') {
      throw new ConflictException(`This submission has already been ${kyc.status.toLowerCase()}`);
    }

    if (dto.status === KycReviewDecision.APPROVED) {
      const newLimit = dto.verifiedMonthlyDispersalLimit
        ? Number(dto.verifiedMonthlyDispersalLimit)
        : DEFAULT_VERIFIED_MONTHLY_DISPERSAL_LIMIT;

      const [updatedKyc] = await this.prisma.$transaction([
        this.prisma.kyc.update({
          where: { id: kycId },
          data: { status: 'APPROVED', reviewedAt: new Date(), rejectionReason: null },
        }),
        this.prisma.user.update({
          where: { id: kyc.userId },
          data: { kycTier: 'VERIFIED', monthlyDispersalLimit: newLimit },
        }),
      ]);

      return updatedKyc;
    }

    return this.prisma.kyc.update({
      where: { id: kycId },
      data: { status: 'REJECTED', reviewedAt: new Date(), rejectionReason: dto.rejectionReason },
    });
  }
}

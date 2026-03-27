import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import * as bcrypt from 'bcryptjs';

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

  async findAll() {
    return this.prisma.admin.findMany({
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
  }
}

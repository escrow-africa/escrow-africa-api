import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OtpService {
  constructor(private prisma: PrismaService) {}

  async create(email: string) {
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = new Date();
    otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);

    return this.prisma.otp.create({
      data: {
        email,
        otp,
        otpExpiry,
        isUsed: false,
      },
    });
  }

  async findLatestByEmail(email: string) {
    return this.prisma.otp.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsUsed(id: string) {
    return this.prisma.otp.update({
      where: { id },
      data: { isUsed: true },
    });
  }
}

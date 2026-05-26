import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../common/mailer.service';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  constructor(private prisma: PrismaService, private mailer: MailerService) {}

  async create(email: string) {
    const otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpiry = new Date();
    otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);

    const record = await this.prisma.otp.create({
      data: {
        email,
        otp,
        otpExpiry,
        isUsed: false,
      },
    });

    try {
      await this.mailer.sendOtpEmail(email, otp);
    } catch (err) {
      this.logger.warn('Failed to send OTP email, but OTP record was created');
    }

    return record;
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

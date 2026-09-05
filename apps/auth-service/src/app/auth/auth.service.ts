import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RegisterDto } from './dto/register.dto';
import { WaitlistDto } from './dto/waitlist.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserService } from '../user/user.service';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseUserAgent } from './utils/parse-user-agent';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private otpService: OtpService,
    private jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  generateAccessToken(userId: string, email: string, sessionId?: string) {
    return this.jwtService.sign(
      { sub: userId, email, sessionId },
      { expiresIn: (process.env.JWT_EXPIRE) as any },
    );
  }

  async validateUser(email: string, password: string) {
    const user = await this.userService.findOne(email);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      throw new UnauthorizedException('Invalid password');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Email not verified');
    }

    const { password: _, ...userWithoutPassword } = user;

    return userWithoutPassword;
  }

  async register(registerDto: RegisterDto) {
    const { firstName, lastName, email, phone, createPassword, confirmPassword, referralCode } = registerDto;
    const fullName = `${firstName} ${lastName}`.trim();

    if (createPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const isExisting = await this.userService.findOne(email);

    if (isExisting) {
      throw new ConflictException('A user with this email already exists');
    }

    let referrerId: string | undefined;

    if (referralCode) {
      const agent = await this.prisma.agent.findUnique({
        where: { referralCode },
        select: { id: true },
      });

      if (!agent) {
        throw new BadRequestException('Invalid referral code');
      }

      referrerId = agent.id;
    }

    const user = await this.userService.create({
      firstName,
      lastName,
      fullName,
      email,
      phone,
      password: createPassword,
      referrerId,
    });

    // create and store OTP for email verification
    await this.otpService.create(email);

    // create a wallet for the user by calling the wallet service
      const baseUrl = process.env.API_BASE_URL;
      try {
        const normalized = String(baseUrl).replace(/\/+$/, '');
        const walletUrl = `${normalized}/wallet/create`;
        // Request wallet creation with provider (strict) - fail registration if provider creation fails
        await axios.post(walletUrl, { userId: user.id });
    } catch (err) {
      console.log({ err });
      // don't block registration if wallet creation fails; log and continue
      console.warn('Wallet creation failed for user', user.id, (err as any)?.message || err);
    }

    return {
      message: 'Registration successful, OTP sent to email',
      userId: user.id,
    };
  }

  async joinWaitlist(dto: WaitlistDto) {
    const existing = await this.prisma.waitlistEntry.findUnique({ where: { email: dto.email } });
    if (existing) {
      return { message: "You're already on the waitlist" };
    }

    await this.prisma.waitlistEntry.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
      },
    });

    return { message: 'Added to the waitlist successfully' };
  }

  async login(data: any, deviceMeta: { userAgent?: string; ip?: string } = {}) {
    const { browser, deviceType } = parseUserAgent(deviceMeta.userAgent);
    const session = await this.prisma.session.create({
      data: {
        userId: data.id,
        browser,
        deviceType: deviceType as any,
        ip: deviceMeta.ip,
        userAgent: deviceMeta.userAgent,
      },
    });

    return {
      user: data,
      accessToken: this.generateAccessToken(data.id, data.email, session.id),
    };
  }

  async requestOtp(email: string) {
    const isExisting = await this.userService.findOne(email);

    if (!isExisting) {
      throw new NotFoundException('A user with this email does not exist');
    }

    await this.otpService.create(email);

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const { email, otp } = verifyOtpDto;
    const latestOtp = await this.otpService.findLatestByEmail(email);
    if (!latestOtp || latestOtp.isUsed) {
      throw new BadRequestException('Invalid or already used OTP');
    }

    const isOtpValid = latestOtp.otp === otp && latestOtp.otpExpiry.getTime() > new Date().getTime();
    if (!isOtpValid) {
      throw new BadRequestException('Expired OTP');
    }

    const [user] = await Promise.all([
      this.userService.findOne(email),
      this.otpService.markAsUsed(latestOtp.id),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // mark user as verified
    await this.userService.findByIdAndUpdate(user.id, { isEmailVerified: true });

    return {
      message: 'Email verified successfully',
    };
  }

  async resetPassword(authUser: any, resetPasswordDto: ResetPasswordDto) {
    const { newPassword, confirmNewPassword } = resetPasswordDto;

    const isExisting = await this.userService.findById(authUser.id);
    if (!isExisting) {
      throw new NotFoundException('A user with this ID does not exist');
    }

    const isPasswordValid = newPassword === confirmNewPassword;
    if (!isPasswordValid) {
      throw new BadRequestException('Passwords do not match');
    }

    await this.userService.findByIdAndUpdate(authUser.id, {
      password: bcrypt.hashSync(newPassword, 10),
    });
    return { message: 'Password reset successful' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const isCurrentPasswordCorrect = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isCurrentPasswordCorrect) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.userService.findByIdAndUpdate(userId, {
      password: bcrypt.hashSync(dto.newPassword, 10),
    });

    return { message: 'Password changed successfully' };
  }

  async deactivateAccount(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { isActive: false } }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Account deactivated' };
  }

  async listSessions(userId: string, currentSessionId?: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      browser: s.browser,
      type: s.deviceType.toLowerCase(),
      ip: s.ip,
      isActive: !s.revokedAt,
      isCurrent: s.id === currentSessionId,
      createdAt: s.createdAt,
    }));
  }

  async revokeOtherSessions(userId: string, currentSessionId?: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(currentSessionId ? { NOT: { id: currentSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    return { message: 'Other sessions revoked' };
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return { message: 'Session revoked' };
  }

  async getUserDetails(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const { password: _, ...rest } = user as any;
    return rest;
  }

  async getUserStats(userId: string) {
    const activeStatuses = ['CREATED', 'PENDING_PAYMENT', 'FUNDED', 'IN_PROGRESS', 'DELIVERED', 'UNDER_REVIEW'] as any[];

    const [wallet, held, earnings, activeEscrowsCount] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId } }),
      this.prisma.escrow.aggregate({
        _sum: { amount: true },
        where: { buyerId: userId, status: { in: ['FUNDED', 'UNDER_REVIEW'] as any[] } },
      }),
      this.prisma.escrow.aggregate({
        _sum: { amount: true },
        where: { sellerId: userId, status: { in: ['RELEASED', 'COMPLETED'] as any[] } },
      }),
      this.prisma.escrow.count({
        where: { status: { in: activeStatuses }, OR: [{ buyerId: userId }, { sellerId: userId }] },
      }),
    ]);

    return {
      totalEarnings: Number(earnings._sum.amount || 0),
      availableBalance: wallet ? Number(wallet.balance) : 0,
      escrowHeldFunds: Number(held._sum.amount || 0),
      activeEscrows: activeEscrowsCount,
    };
  }
}

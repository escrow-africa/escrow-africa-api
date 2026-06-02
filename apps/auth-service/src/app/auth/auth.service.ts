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
import { UserService } from '../user/user.service';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private otpService: OtpService,
    private jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  generateAccessToken(userId: string, email: string) {
    return this.jwtService.sign(
      { sub: userId, email },
      { expiresIn: (process.env.JWT_EXPIRE) as any },
    );
  }

  async validateUser(email: string, password: string) {
    const user = await this.userService.findOne(email);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordCorrect = bcrypt.compareSync(password, user.password);

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
    const { fullName, email, phone, password } = registerDto;

    const isExisting = await this.userService.findOne(email);

    if (isExisting) {
      throw new ConflictException('A user with this email already exists');
    }

    const user = await this.userService.create({
      fullName,
      email,
      phone,
      password,
    });

    // create and store OTP for email verification
    await this.otpService.create(email);

    // create a wallet for the user by calling the wallet service
      const baseUrl = process.env.WALLET_API_URL || process.env.API_BASE_URL || '';
      try {
        const normalized = String(baseUrl).replace(/\/+$/, '');
        const walletUrl = `${normalized}/api/wallet/create`;
        // Request wallet creation with provider (strict) - fail registration if provider creation fails
        await axios.post(walletUrl, { userId: user.id });
    } catch (err) {
      // don't block registration if wallet creation fails; log and continue
      console.warn('Wallet creation failed for user', user.id, (err as any)?.message || err);
    }

    return {
      message: 'Registration successful, OTP sent to email',
      userId: user.id,
    };
  }

  async login(data: any) {
    return {
      user: data,
      accessToken: this.generateAccessToken(data.id, data.email),
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

  async getUserDetails(userId: string) {
    const user = await this.userService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const { password: _, ...rest } = user as any;
    return rest;
  }

  async getUserStats(userId: string) {
    // availableBalance from wallet
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    const availableBalance = wallet ? Number(wallet.balance) : 0;

    // escrowHeldFunds: sum of escrows where user is buyer and status is FUNDED
    const held = await this.prisma.escrow.aggregate({
      _sum: { amount: true },
      where: { buyerId: userId, status: 'FUNDED' },
    });
    const escrowHeldFunds = Number(held._sum.amount || 0);

    // totalEarnings: sum of amounts for escrows where user is seller and status in RELEASED or COMPLETED
    const earnings = await this.prisma.escrow.aggregate({
      _sum: { amount: true },
      where: { sellerId: userId, status: { in: ['RELEASED', 'COMPLETED'] } },
    });
    const totalEarnings = Number(earnings._sum.amount || 0);

    // activeEscrows: count of escrows in active statuses for this user
    const activeStatuses = ['CREATED', 'PENDING_PAYMENT', 'FUNDED', 'IN_PROGRESS', 'DELIVERED'];
    const activeEscrowsCount = await this.prisma.escrow.count({ where: { status: { in: activeStatuses }, OR: [{ buyerId: userId }, { sellerId: userId }] } });

    return {
      totalEarnings,
      availableBalance,
      escrowHeldFunds,
      activeEscrows: activeEscrowsCount,
    };
  }
}

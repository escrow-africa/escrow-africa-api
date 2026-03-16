import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RegisterDto } from './dto/register.dto';
import { UserService } from '../user/user.service';
import { OtpService } from '../otp/otp.service';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private otpService: OtpService,
    private jwtService: JwtService,
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

    const { password: _, ...userWithoutPassword } = user;

    return userWithoutPassword;
  }

  async register(registerDto: RegisterDto) {
    const { fullName, email, phone, whatsappPhone, password } = registerDto;

    const isExisting = await this.userService.findOne(email);

    if (isExisting) {
      throw new ConflictException('A user with this email already exists');
    }

    const user = await this.userService.create({
      fullName,
      email,
      phone,
      whatsappPhone,
      password,
    });

    return {
      message: 'Registration successful',
      accessToken: this.generateAccessToken(user.id, user.email),
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

    return {
      message: 'Email verified successfully',
      accessToken: this.generateAccessToken(user.id, user.email),
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
}

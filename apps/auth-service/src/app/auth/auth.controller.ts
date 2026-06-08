import { Body, Controller, HttpCode, Post, UseGuards, Request, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LocalAuthGuard } from './guard/local-auth.guard';
import { JwtAuthGuard } from './guard/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(200)
  async login(@Request() req: any) {
    return this.authService.login(req.user);
  }

  @Post('request-otp')
  @HttpCode(200)
  requestOtp(@Body('email') email: string) {
    return this.authService.requestOtp(email);
  }

  @Post('verify-otp')
  @HttpCode(200)
  verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(
    @Request() req: any,
    @Body() resetPasswordDto: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(req.user, resetPasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: any) {
    const userId = req.user?.id;
    return this.authService.getUserDetails(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats')
  stats(@Request() req: any) {
    const userId = req.user?.id;
    return this.authService.getUserStats(userId);
  }
}

import { Body, Controller, HttpCode, Post, UseGuards, Request, Get, Delete, Param } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
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
    const userAgent = req.headers?.['user-agent'];
    const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress;
    return this.authService.login(req.user, { userAgent, ip });
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

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(200)
  changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user?.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('deactivate')
  @HttpCode(200)
  deactivate(@Request() req: any) {
    return this.authService.deactivateAccount(req.user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(@Request() req: any) {
    return this.authService.listSessions(req.user?.id, req.user?.sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  @HttpCode(200)
  revokeOtherSessions(@Request() req: any) {
    return this.authService.revokeOtherSessions(req.user?.id, req.user?.sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  revokeSession(@Request() req: any, @Param('id') id: string) {
    return this.authService.revokeSession(req.user?.id, id);
  }
}

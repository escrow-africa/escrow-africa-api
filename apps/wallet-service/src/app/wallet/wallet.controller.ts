import { Controller, Post, Body, Get, Req, UseGuards } from '@nestjs/common';
import { type Request } from 'express';
import { WalletService } from './wallet.service';
import { TopUpDto } from './dto/topup.dto';
import { CardOtpDto } from './dto/card-otp.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post('create')
  async create(@Body() body: { userId: string; skipProvider?: boolean }) {
    const { userId, skipProvider } = body as any;
    return this.walletService.createWalletForUser(userId, !!skipProvider);
  }

  @Get('banks')
  async banks() {
    return this.walletService.getBanks();
  }

  @Get('balance')
  async balance(@Req() req: Request) {
    const userId = (req as any).user?.sub;
    return this.walletService.getBalance(userId);
  }

  @Get('details')
  async details(@Req() req: Request) {
    const userId = (req as any).user?.sub;
    return this.walletService.getWalletDetails(userId);
  }

  @Post('deposit')
  async deposit(@Req() req: Request, @Body('amount') amount: number) {
    const userId = (req as any).user?.sub;
    return this.walletService.deposit(userId, amount);
  }

  @Post('credit')
  async credit(@Req() req: Request, @Body('amount') amount: number) {
    const userId = (req as any).user?.sub;
    return this.walletService.credit(userId, amount);
  }

  @Post('debit')
  async debit(@Req() req: Request, @Body('amount') amount: number) {
    const userId = (req as any).user?.sub;
    return this.walletService.debit(userId, amount);
  }

  @Post('topup')
  async topup(@Req() req: Request, @Body() dto: TopUpDto) {
    const userId = (req as any).user?.sub;
    const { amount, method, card, deviceInformation, skipProvider } = dto as any;
    return this.walletService.topUp(userId, amount, method, {card, deviceInformation, skipProvider });
  }

  @Post('card-otp')
  async cardOtp(@Body() dto: CardOtpDto) {
    const { transactionReference, tokenId, token } = dto as any;
    return this.walletService.authorizeCardOtp(transactionReference, tokenId, token);
  }
}

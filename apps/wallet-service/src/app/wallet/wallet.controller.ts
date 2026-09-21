import { Controller, Post, Body, Get, Req, UseGuards, Query, Delete, Patch, Param } from '@nestjs/common';
import { type Request } from 'express';
import { WalletService } from './wallet.service';
import { TopUpDto } from './dto/topup.dto';
import { CardOtpDto } from './dto/card-otp.dto';
import { CreatePayoutAccountDto } from './dto/payout-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../../decorators/public.decorator';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post('create')
  @Public()
  async create(@Body() body: { userId: string; skipProvider?: boolean }) {
    const { userId, skipProvider } = body as any;
    return this.walletService.createWalletForUser(userId, !!skipProvider);
  }

  @Get('banks')
  @Public()
  async banks() {
    return this.walletService.getBanks();
  }

  @Get('balance')
  async balance(@Req() req: Request) {
    const userId = (req as any).user?.sub;
    return this.walletService.getBalance(userId);
  }

  @Get('details')
  async details(@Req() req: Request, @Query('page') page = '1', @Query('limit') limit = '20') {
    const userId = (req as any).user?.sub;
    return this.walletService.getWalletDetails(userId, Number(page) || 1, Number(limit) || 20);
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

  @Get('transaction')
  async transactions(@Req() req: Request, @Query('page') page = '1', @Query('limit') limit = '20', @Query('type') type?: string) {
    const userId = (req as any).user?.sub;
    const p = Number(page) || 1;
    const l = Number(limit) || 20;
    return this.walletService.fetchTransactions(userId, p, l, type);
  }

  @Get('payout-accounts')
  async listPayoutAccounts(@Req() req: Request) {
    const userId = (req as any).user?.sub;
    return this.walletService.listPayoutAccounts(userId);
  }

  @Post('payout-accounts')
  async addPayoutAccount(@Req() req: Request, @Body() dto: CreatePayoutAccountDto) {
    const userId = (req as any).user?.sub;
    return this.walletService.addPayoutAccount(userId, dto);
  }

  @Delete('payout-accounts/:id')
  async deletePayoutAccount(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user?.sub;
    return this.walletService.deletePayoutAccount(userId, id);
  }

  @Patch('payout-accounts/:id/default')
  async setDefaultPayoutAccount(@Req() req: Request, @Param('id') id: string) {
    const userId = (req as any).user?.sub;
    return this.walletService.setDefaultPayoutAccount(userId, id);
  }
}

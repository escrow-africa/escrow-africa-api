import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { TopUpDto } from './dto/topup.dto';
import { CardOtpDto } from './dto/card-otp.dto';


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

  @Get(':userId/balance')
  async balance(@Param('userId') userId: string) {
    return this.walletService.getBalance(userId);
  }

  @Get(':userId')
  async details(@Param('userId') userId: string) {
    return this.walletService.getWalletDetails(userId);
  }

  @Post(':userId/deposit')
  async deposit(@Param('userId') userId: string, @Body('amount') amount: number) {
    return this.walletService.deposit(userId, amount);
  }

  @Post(':userId/credit')
  async credit(@Param('userId') userId: string, @Body('amount') amount: number) {
    return this.walletService.credit(userId, amount);
  }

  @Post(':userId/debit')
  async debit(@Param('userId') userId: string, @Body('amount') amount: number) {
    return this.walletService.debit(userId, amount);
  }

  @Post('topup')
  async topup(@Body() dto: TopUpDto) {
    const { userId, amount, method, card, deviceInformation, skipProvider } = dto as any;
    return this.walletService.topUp(userId, amount, method, {card, deviceInformation, skipProvider });
  }

  @Post('card-otp')
  async cardOtp(@Body() dto: CardOtpDto) {
    const { transactionReference, tokenId, token } = dto as any;
    return this.walletService.authorizeCardOtp(transactionReference, tokenId, token);
  }
}

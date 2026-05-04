import { Controller, Post, Body, Param } from '@nestjs/common';
import { EscrowService } from './escrow.service';

@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('create')
  async create(@Body('buyerId') buyerId: string, @Body('sellerId') sellerId: string, @Body('amount') amount: number) {
    return this.escrowService.createEscrow(buyerId, sellerId, amount);
  }

  @Post(':id/fund')
  async fund(@Param('id') id: string) {
    return this.escrowService.fund(id);
  }

  @Post(':id/release')
  async release(@Param('id') id: string) {
    return this.escrowService.release(id);
  }

  @Post(':id/refund')
  async refund(@Param('id') id: string) {
    return this.escrowService.refund(id);
  }
}

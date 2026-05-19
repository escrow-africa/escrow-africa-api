import { Controller, Post, Body, Param, Req, BadRequestException, Get, Query } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { type Request } from 'express';

@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('create')
  async create(@Body() dto: CreateEscrowDto, @Req() req: Request) {
    const sellerId = (req as any).user?.id;

    if (!sellerId) throw new BadRequestException('Authenticated seller id not found');

    return this.escrowService.createEscrowDetailed({
      buyerEmail: dto.buyerEmail,
      sellerId,
      milestones: dto.milestones || [],
      amount: dto.amount,
      deliveryDeadline: dto.deliveryDeadline,
      inspectionPeriodDays: dto.inspectionPeriodDays,
      description: dto.description,
    });
  }

  @Get()
  async getEscrows(
    @Req() req: Request,
    @Query('filter') filter?: 'active' | 'completed' | 'disputed',
  ) {
    const userId = (req as any).user?.sub || (req as any).user?.id || (req as any).user?.userId;
    return this.escrowService.getEscrows(filter, userId);
  }

  @Get(':escrowId')
  async getEscrowDetails(@Param('escrowId') escrowId: string, @Req() req: Request) {
    const userId = (req as any).user?.sub || (req as any).user?.id || (req as any).user?.userId;
    return this.escrowService.getEscrowDetails(escrowId, userId);
  }

  @Post(':id/fund')
  async fund(@Param('id') id: string) {
    return this.escrowService.fund(id);
  }

  @Post(':id/extend')
  async extend(@Param('id') id: string, @Body('deliveryDeadline') deliveryDeadline: string) {
    return this.escrowService.extendDeadline(id, deliveryDeadline);
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string) {
    return this.escrowService.markCompleted(id);
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

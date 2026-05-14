import { Controller, Post, Body, Param, Req, BadRequestException, Get, UseGuards } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { type Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('create')
  async create(@Body() dto: CreateEscrowDto, @Req() req: Request) {
    let sellerId = (req as any).user?.id;
    if (!sellerId) {
      // fallback: try to decode Bearer token from Authorization header
      const auth = (req as any).headers?.authorization || (req as any).headers?.Authorization;
      if (auth && String(auth).startsWith('Bearer ')) {
        const token = String(auth).slice('Bearer '.length);
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            sellerId = payload?.sub || payload?.id || payload?.userId;
          }
        } catch {
          // ignore and fall through to error below
        }
      }
    }
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

  @UseGuards(JwtAuthGuard)
  @Get('active')
  async active(@Req() req: Request) {
    const userId = (req as any).user?.sub || (req as any).user?.id || (req as any).user?.userId;
    return this.escrowService.getActiveEscrows(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('completed')
  async completed(@Req() req: Request) {
    const userId = (req as any).user?.sub || (req as any).user?.id || (req as any).user?.userId;
    return this.escrowService.getCompletedEscrows(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('disputed')
  async disputed(@Req() req: Request) {
    const userId = (req as any).user?.sub || (req as any).user?.id || (req as any).user?.userId;
    return this.escrowService.getDisputedEscrows(userId);
  }

  @Post(':id/fund')
  async fund(@Param('id') id: string) {
    return this.escrowService.fund(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/extend')
  async extend(@Param('id') id: string, @Body('deliveryDeadline') deliveryDeadline: string) {
    return this.escrowService.extendDeadline(id, deliveryDeadline);
  }

  @UseGuards(JwtAuthGuard)
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

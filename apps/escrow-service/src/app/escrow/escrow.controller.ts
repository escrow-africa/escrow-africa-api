import { Controller, Post, Body, Param, Req, BadRequestException, Get, UseGuards, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { type Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@UseGuards(JwtAuthGuard)
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('create')
  async create(@Body() dto: CreateEscrowDto, @Req() req: Request) {
    const sellerId = (req as any).user?.sub;
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
  async getEscrows(@Req() req: Request, @Query('preset') preset: 'active' | 'completed' | 'disputed' | 'all' = 'active') {
    const userId = (req as any).user?.sub;
    return this.escrowService.getEscrows(userId, preset);
  }

  @Get('stats')
  getEscrowStats(@Req() req: Request) {
    const userId = (req as any).user?.sub;
    return this.escrowService.getEscrowStats(userId);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.sub;
    return this.escrowService.getEscrowById(id, userId);
  }

  @Post(':id/fund')
  async fund(@Param('id') id: string) {
    return this.escrowService.fund(id);
  }

  @Post(':id/deliver')
  @UseInterceptors(FileInterceptor('proof', { storage: memoryStorage() }))
  async deliver(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const sellerId = (req as any).user?.sub;
    if (!sellerId) throw new BadRequestException('Authenticated seller id not found');
    if (!file) throw new BadRequestException('Proof file is required');
    return this.escrowService.deliver(id, file.buffer, sellerId);
  }

  @Post(':id/nudge')
  async nudge(@Param('id') id: string, @Req() req: Request) {
    const sellerId = (req as any).user?.sub;
    if (!sellerId) throw new BadRequestException('Authenticated seller id not found');
    return this.escrowService.nudgeBuyer(id, sellerId);
  }

  @Post(':id/extend')
  async extend(@Param('id') id: string, @Body('deliveryDeadline') deliveryDeadline: string) {
    return this.escrowService.extendDeadline(id, deliveryDeadline);
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string, @Req() req: Request) {
    const buyerId = (req as any).user?.sub;
    return this.escrowService.markCompleted(id, buyerId);
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

import { Controller, Post, Body, Param, Req, BadRequestException, Get, UseGuards, Query, UploadedFile, UseInterceptors, Res } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EscrowService } from './escrow.service';
import { CreateEscrowDto } from './dto/create-escrow.dto';
import { type Request, type Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../../decorators/public.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { KafkaEvents } from '@org/kafka';

@UseGuards(JwtAuthGuard)
@Controller('escrow')
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('create')
  async create(@Body() dto: CreateEscrowDto, @Req() req: Request) {
    const authUserId = (req as any).user?.sub;
    const authUserEmail = (req as any).user?.email;
    if (!authUserId) throw new BadRequestException('Authenticated user id not found');

    return this.escrowService.createEscrowDetailed({
      creatorRole: dto.creatorRole,
      authenticatedUserId: authUserId,
      authenticatedUserEmail: authUserEmail,
      buyerEmail: dto.buyerEmail,
      sellerEmail: dto.sellerEmail,
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
    @Query('preset') preset: 'active' | 'completed' | 'disputed' | 'all' = 'active',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const userId = (req as any).user?.sub;
    return this.escrowService.getEscrows(userId, preset, Number(page) || 1, Number(limit) || 20);
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

  // Public: reached directly from the "Approve Escrow" button in the buyer's email, so it
  // can't require a JWT. Renders a plain confirmation page rather than JSON since this is a
  // browser navigation, not an API call.
  @Get(':id/approve')
  @Public()
  async approve(@Param('id') id: string, @Query('token') token: string, @Res() res: Response) {
    try {
      const escrow = await this.escrowService.approveByBuyer(id, token);
      res.status(200).send(this.renderApprovalPage(true, `Escrow ${escrow.escrowCode} has been approved. The seller has been notified and can now proceed.`));
    } catch (error: any) {
      res.status(400).send(this.renderApprovalPage(false, error?.message || 'This approval link is invalid or has expired.'));
    }
  }

  private renderApprovalPage(success: boolean, message: string) {
    const color = success ? '#0F3D2E' : '#B91C1C';
    const heading = success ? 'Escrow Approved' : 'Approval Failed';
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} - Escrow Africa</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #F5F7F8; margin: 0; padding: 0; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { background: #fff; border-radius: 20px; padding: 40px; max-width: 440px; text-align: center; box-shadow: 0 20px 60px rgba(15,61,46,0.1); }
  h1 { color: ${color}; font-size: 22px; margin: 0 0 12px; }
  p { color: #4B5563; font-size: 15px; line-height: 1.5; }
</style></head>
<body><div class="card"><h1>${heading}</h1><p>${message}</p></div></body></html>`;
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

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body('reason') reason: string | undefined, @Req() req: Request) {
    const requesterId = (req as any).user?.sub;
    if (!requesterId) throw new BadRequestException('Authenticated user id not found');
    return this.escrowService.cancel(id, requesterId, reason);
  }

  // Defense-in-depth: Lock escrow when dispute.opened event is received
  // This ensures that if the transactional lock in dispute-service fails,
  // the escrow is still locked via Kafka event
  @EventPattern(KafkaEvents.DISPUTE_OPENED)
  async handleDisputeOpened(@Payload() data: any) {
    return this.escrowService.lockEscrowOnDisputeOpen(data.escrowId, data.disputeId, data.breachCategory);
  }

  // Fired whenever dispute-service resolves a dispute. If it carries a fund-moving verdict
  // (currently only the WhatsApp bot's AI adjudication sets one), funds move automatically;
  // otherwise the escrow is just unlocked so the normal release/refund/cancel endpoints work
  // again - see EscrowService.handleDisputeResolved for why both paths still need to unlock.
  @EventPattern(KafkaEvents.DISPUTE_RESOLVED)
  async handleDisputeResolved(@Payload() data: any) {
    return this.escrowService.handleDisputeResolved(data.escrowId, data.disputeId, data.verdict);
  }
}

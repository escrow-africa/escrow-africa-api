import { Controller, Post, Body, Patch, Param, Get, Req, UnauthorizedException } from '@nestjs/common';
import { DisputeService } from './dispute.service';
import { CreateDisputeDto, CreateDisputeMessageDto, RequestReviewDto, ProposeSettlementDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@Controller('disputes')
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  @Post()
  create(@Body() createDisputeDto: CreateDisputeDto, @Req() req: any) {
    // Example: extracting userId from regular user JWT. Adjust as Auth structure finalizes
    const userId = req.user?.id || 'AUTH_USER_PLACEHOLDER'; 
    return this.disputeService.create(createDisputeDto, userId);
  }

  @Post(':id/message')
  addMessage(@Param('id') id: string, @Body() dto: CreateDisputeMessageDto, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.addMessage(id, dto, userId);
  }

  @Post(':id/request-review')
  requestReview(@Param('id') id: string, @Body() dto: RequestReviewDto, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.requestReview(id, dto, userId);
  }

  @Post(':id/propose-settlement')
  proposeSettlement(@Param('id') id: string, @Body() dto: ProposeSettlementDto, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.proposeSettlement(id, dto, userId);
  }

  @Patch(':id/review')
  resolve(@Param('id') id: string, @Body() resolveDto: ResolveDisputeDto, @Req() req: any) {
    if (req.user?.type !== 'ADMIN') throw new UnauthorizedException('Access denied: Admins only');
    
    // Admin IDs pulled straight from decoded token
    const adminId = req.user?.id || 'ADMIN_ID_PLACEHOLDER';
    return this.disputeService.resolve(id, resolveDto, adminId);
  }

  @Get()
  findAll(@Req() req: any) {
    if (req.user?.type !== 'ADMIN') throw new UnauthorizedException('Access denied: Admins only');
    return this.disputeService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.disputeService.findOne(id);
  }
}

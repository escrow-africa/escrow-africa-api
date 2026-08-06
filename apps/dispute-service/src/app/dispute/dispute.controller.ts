import { Controller, Post, Body, Patch, Param, Get, Req, UnauthorizedException, UseGuards, UseInterceptors, UploadedFiles, BadRequestException, Query } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DisputeService } from './dispute.service';
import { CreateDisputeDto, CreateDisputeMessageDto, RequestReviewDto, RequestManualDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  @Post()
  @UseInterceptors(FilesInterceptor('proofOfBreach', 10, { storage: memoryStorage() }))
  create(
    @Body() createDisputeDto: CreateDisputeDto,
    @Req() req: any,
    @UploadedFiles() proofOfBreach: Express.Multer.File[],
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    if (!proofOfBreach || proofOfBreach.length === 0) {
      throw new BadRequestException('At least one proof file is required');
    }
    return this.disputeService.create(createDisputeDto, userId, proofOfBreach);
  }

  @Post(':id/message')
  addMessage(@Param('id') id: string, @Body() dto: CreateDisputeMessageDto, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.addMessage(id, dto, userId);
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Req() req: any, @Query('page') page = '1', @Query('limit') limit = '30') {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.getMessages(id, userId, req.user?.type, Number(page) || 1, Number(limit) || 30);
  }

  @Get(':id/events')
  getEvents(@Param('id') id: string, @Req() req: any, @Query('page') page = '1', @Query('limit') limit = '100') {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.getEvents(id, userId, req.user?.type, Number(page) || 1, Number(limit) || 100);
  }

  @Post(':id/request-review')
  requestReview(@Param('id') id: string, @Body() dto: RequestReviewDto, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.requestReview(id, dto, userId);
  }

  @Post(':id/request-manual')
  requestManual(@Param('id') id: string, @Body() dto: RequestManualDto, @Req() req: any) {
    const userId = req.user?.id || dto.requesterId;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.requestManual(id, dto, userId);
  }

  @Post(':id/propose-settlement')
  proposeSettlement(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.proposeSettlement(id, userId);
  }

  @Post(':id/settlement/:eventId/accept')
  acceptSettlement(@Param('id') id: string, @Param('eventId') eventId: string, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.acceptSettlement(eventId, userId);
  }

  @Post(':id/settlement/:eventId/decline')
  declineSettlement(@Param('id') id: string, @Param('eventId') eventId: string, @Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.declineSettlement(eventId, userId);
  }

  @Patch(':id/review')
  resolve(@Param('id') id: string, @Body() resolveDto: ResolveDisputeDto, @Req() req: any) {
    if (req.user?.type !== 'ADMIN') throw new UnauthorizedException('Access denied: Admins only');
    
    // Admin IDs pulled straight from decoded token
    const adminId = req.user?.id;
    return this.disputeService.resolve(id, resolveDto, adminId);
  }

  @Get('me')
  findMine(@Req() req: any, @Query('page') page = '1', @Query('limit') limit = '20') {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.disputeService.findMine(userId, Number(page) || 1, Number(limit) || 20);
  }

  @Get()
  findAll(@Req() req: any, @Query('page') page = '1', @Query('limit') limit = '20') {
    if (req.user?.type !== 'ADMIN') throw new UnauthorizedException('Access denied: Admins only');
    return this.disputeService.findAll(Number(page) || 1, Number(limit) || 20);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.disputeService.findOne(id);
  }
}

import { Controller, Post, Body, Patch, Param, Get, Req, UnauthorizedException } from '@nestjs/common';
import { DisputeService } from './dispute.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
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

  @Patch(':id/review')
  review(@Param('id') id: string, @Req() req: any) {
    // Guards should ensure req.user exists and possesses type: 'ADMIN'
    // To strictly enforce without guard file for now:
    if (req.user?.type !== 'ADMIN') throw new UnauthorizedException('Access denied: Admins only');
    return this.disputeService.review(id);
  }

  @Patch(':id/resolve')
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

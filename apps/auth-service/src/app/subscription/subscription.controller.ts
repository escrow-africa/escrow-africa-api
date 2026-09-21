import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';

@Controller('auth/subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('plans')
  getPlans() {
    return this.subscriptionService.getPlans();
  }

  @Get()
  getStatus(@Req() req: any) {
    return this.subscriptionService.getStatus(req.user?.id);
  }

  @Post('upgrade')
  upgrade(@Req() req: any, @Body() dto: UpgradePlanDto) {
    return this.subscriptionService.upgrade(req.user?.id, dto.planId, req.headers?.authorization);
  }
}

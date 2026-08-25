import { Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationFeedController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  findMine(@Req() req: any, @Query('page') page = '1', @Query('limit') limit = '20') {
    return this.notificationService.findMine(req.user?.id, Number(page) || 1, Number(limit) || 20);
  }

  @Get('unread-count')
  unreadCount(@Req() req: any) {
    return this.notificationService.unreadCount(req.user?.id);
  }

  @Post(':id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.notificationService.markRead(req.user?.id, id);
  }

  @Post('read-all')
  markAllRead(@Req() req: any) {
    return this.notificationService.markAllRead(req.user?.id);
  }
}

import { Module } from '@nestjs/common';
import { NotificationFeedController } from './notification-feed.controller';
import { NotificationService } from './notification.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationFeedController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}

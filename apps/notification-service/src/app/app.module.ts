import { Module } from '@nestjs/common';
import { KafkaModule } from '@org/kafka';
import { NotificationController } from './notification.controller';
import { WhatsappService } from './whatsapp.service';
import { MailerService } from './mailer.service';
import { PrismaModule } from './prisma/prisma.module';
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [KafkaModule, PrismaModule, NotificationModule],
  controllers: [NotificationController],
  providers: [WhatsappService, MailerService],
})
export class AppModule {}

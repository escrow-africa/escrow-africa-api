import { Module } from '@nestjs/common';
import { KafkaModule } from '@org/kafka';
import { NotificationController } from './notification.controller';
import { WhatsappService } from './whatsapp.service';
import { MailerService } from './mailer.service';

@Module({
  imports: [KafkaModule],
  controllers: [NotificationController],
  providers: [WhatsappService, MailerService],
})
export class AppModule {}

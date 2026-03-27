import { Module } from '@nestjs/common';
import { KafkaModule } from '@org/kafka';
import { NotificationController } from './notification.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [KafkaModule],
  controllers: [NotificationController],
  providers: [WhatsappService],
})
export class AppModule {}

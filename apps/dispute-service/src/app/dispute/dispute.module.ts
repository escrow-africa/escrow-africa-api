import { Module } from '@nestjs/common';
import { DisputeService } from './dispute.service';
import { DisputeController } from './dispute.controller';
import { CloudinaryService } from './cloudinary.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  controllers: [DisputeController],
  providers: [DisputeService, CloudinaryService],
})
export class DisputeModule {}

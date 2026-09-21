import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { DisputeAiService } from './dispute-ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../dispute/cloudinary.service';
import { DisputeService } from '../dispute/dispute.service';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, DisputeAiService, PrismaService, CloudinaryService, DisputeService],
  exports: [WhatsappService],
})
export class WhatsappModule {}

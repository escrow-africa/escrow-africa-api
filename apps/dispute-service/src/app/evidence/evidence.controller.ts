import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EvidenceService } from './evidence.service';

@Controller()
export class EvidenceController {
  private readonly logger = new Logger(EvidenceController.name);

  constructor(private readonly evidenceService: EvidenceService) {}

  @EventPattern('WHATSAPP_EVIDENCE_RECEIVED')
  async handleWhatsappEvidence(@Payload() data: { disputeId: string; senderId: string; text?: string; attachmentUrl?: string }) {
    this.logger.log(`Received WhatsApp evidence for dispute ${data.disputeId}`);
    
    if (data.text) {
      await this.evidenceService.addMessage(data.disputeId, data.senderId, data.text);
    }
    if (data.attachmentUrl) {
      await this.evidenceService.addAttachment(data.disputeId, data.attachmentUrl);
    }
  }
}

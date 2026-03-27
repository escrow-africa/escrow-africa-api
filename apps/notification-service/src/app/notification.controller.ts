import { Controller, Post, Body, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload, ClientKafka } from '@nestjs/microservices';
import { KafkaEvents } from '@org/kafka';
import { WhatsappService } from './whatsapp.service';

@Controller('webhook/whatsapp')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientKafka,
  ) {}

  @EventPattern(KafkaEvents.DISPUTE_CREATED)
  async handleDisputeCreated(@Payload() data: any) {
    // We mock the DB lookup of user's Whatsapp number for brevity
    await this.whatsappService.sendMessage('user_phone', `🚨 Escrow Africa: A dispute has been opened on your transaction #${data.escrowId}. Please log in to provide evidence.`);
  }

  @EventPattern(KafkaEvents.DISPUTE_UNDER_REVIEW)
  async handleDisputeUnderReview(@Payload() data: any) {
    await this.whatsappService.sendMessage('user_phone', `⚖️ Escrow Africa: Your dispute ${data.disputeId} is now under review by our arbitration team.`);
  }

  @EventPattern(KafkaEvents.DISPUTE_RESOLVED)
  async handleDisputeResolved(@Payload() data: any) {
    await this.whatsappService.sendMessage('user_phone', `✅ Escrow Africa: Your dispute ${data.disputeId} has been resolved! Resolution: ${data.resolution}`);
  }

  @Post()
  async handleIncomingMessage(@Body() payload: any) {
    // Handling HTTP POST Webhooks directly from the WhatsApp integration provider
    this.logger.log(`Received WhatsApp Webhook Payload: ${JSON.stringify(payload)}`);
    
    // Dummy parsing
    const disputeId = payload.disputeId || 'DISPUTE_ID_EXTRACTED_FROM_CONTEXT';
    const senderId = payload.from || 'SENDER_PHONE_NUMBER';
    const text = payload.text || payload.body;
    const attachmentUrl = payload.mediaUrl;

    // Routing mapped payload quietly back to the dispute engine
    this.kafkaClient.emit('WHATSAPP_EVIDENCE_RECEIVED', {
      disputeId,
      senderId,
      text,
      attachmentUrl
    });

    return { status: 'success' };
  }
}

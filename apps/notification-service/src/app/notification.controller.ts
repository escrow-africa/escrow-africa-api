import { Controller, Post, Body, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload, ClientKafka } from '@nestjs/microservices';
import { KafkaEvents } from '@org/kafka';
import { WhatsappService } from './whatsapp.service';
import { MailerService } from './mailer.service';

@Controller('webhook/whatsapp')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientKafka,
    private readonly mailerService: MailerService,
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

  @EventPattern(KafkaEvents.ESCROW_CREATED)
  async handleEscrowCreated(@Payload() data: any) {
    // notify buyer that an escrow was created by the seller
    const to = data.buyerEmail || data.buyerId || 'user_email';
    const text = `Escrow created: An escrow (${data.escrowId}) for ₦${data.amount} has been created by the seller. Please fund your wallet to proceed.`;
    try {
      if (data.buyerEmail) await this.mailerService.sendMail(data.buyerEmail, 'Escrow created – action required', text);
    } catch (e) {
      this.logger.warn('Failed to send escrow-created email', e?.message || e);
    }
    await this.whatsappService.sendMessage('user_phone', text);
  }

  @EventPattern(KafkaEvents.ESCROW_RELEASED)
  async handleEscrowReleased(@Payload() data: any) {
    const text = `Escrow ${data.escrowId} inspection period passed — funds (₦${data.amount}) released to seller.`;
    if (data.buyerEmail) {
      try {
        await this.mailerService.sendMail(data.buyerEmail, 'Escrow released', text);
      } catch (e) {
        this.logger.warn('Failed to send escrow-released email', e?.message || e);
      }
    }
    await this.whatsappService.sendMessage('user_phone', text);
  }

  @EventPattern(KafkaEvents.ESCROW_RELEASE_FAILED)
  async handleEscrowReleaseFailed(@Payload() data: any) {
    const text = `Attempt to release escrow ${data.escrowId} failed (attempt ${data.attempt}). Reason: ${data.reason}. We'll retry.`;
    if (data.buyerEmail) {
      try {
        await this.mailerService.sendMail(data.buyerEmail, 'Escrow release attempt failed', text);
      } catch (e) {
        this.logger.warn('Failed to send escrow-release-failed email', e?.message || e);
      }
    }
    await this.whatsappService.sendMessage('user_phone', text);
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

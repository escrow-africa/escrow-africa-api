import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { KafkaEvents } from '@org/kafka';
import { WhatsappService } from './whatsapp.service';
import { MailerService } from './mailer.service';

// Pure notification-sending service: reacts to lifecycle events and performs the actual
// outbound delivery (email, WhatsApp). It does not own any dispute/escrow domain logic or
// inbound WhatsApp webhook handling - that lives in dispute-service, which has direct access
// to the data needed to resolve a phone number to a user and dispute, and to enforce that
// buyer and seller are only ever messaged separately. See WHATSAPP_SEND below.
@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly mailerService: MailerService,
  ) {}

  // Generic outbound WhatsApp send, used by dispute-service's bot once it has resolved a
  // real phone number for a specific party. { to: E.164 phone (no leading '+'), message }
  @EventPattern(KafkaEvents.WHATSAPP_SEND)
  async handleWhatsappSend(@Payload() data: { to: string; message: string }) {
    if (!data?.to || !data?.message) {
      this.logger.warn('WHATSAPP_SEND event missing to/message', data);
      return;
    }
    await this.whatsappService.sendMessage(data.to, data.message);
  }

  // Every new escrow is gated in PENDING_APPROVAL until the buyer approves via the link in
  // this email - so the buyer always gets one, regardless of who created the escrow.
  @EventPattern(KafkaEvents.ESCROW_CREATED)
  async handleEscrowCreated(@Payload() data: any) {
    const amountText = `₦${data.amount}`;

    if (data.buyerEmail && data.approvalLink) {
      const subject = 'Approve your escrow - action required';
      const text = `An escrow (${data.escrowId}) for ${amountText} has been created and is awaiting your approval. Approve it here: ${data.approvalLink}`;
      const html = this.buildApprovalEmailHtml(amountText, data.approvalLink);
      try {
        await this.mailerService.sendMail(data.buyerEmail, subject, text, html);
      } catch (e) {
        this.logger.warn('Failed to send escrow-approval email', e?.message || e);
      }
    }

    // If the buyer created the escrow themselves, let the seller know one is pending the
    // buyer's own approval; the seller hears again via ESCROW_APPROVED once that happens.
    if (data.creatorRole === 'BUYER' && data.sellerEmail) {
      const text = `A buyer has proposed an escrow (${data.escrowId}) for ${amountText}. It's pending the buyer's own approval before it becomes active - we'll notify you once that happens.`;
      try {
        await this.mailerService.sendMail(data.sellerEmail, 'Escrow proposed - awaiting buyer approval', text);
      } catch (e) {
        this.logger.warn('Failed to send escrow-proposed email', e?.message || e);
      }
    }
    // NOTE: pre-existing gap, out of scope for the dispute WhatsApp bot work - WhatsApp
    // notifications here still have no real phone number to send to. Needs the same
    // phone-resolution treatment dispute-service now has before this can actually deliver.
  }

  @EventPattern(KafkaEvents.ESCROW_APPROVED)
  async handleEscrowApproved(@Payload() data: any) {
    if (!data?.sellerEmail) return;
    const text = `Good news - the buyer approved escrow ${data.escrowId}. You can now proceed with the agreed milestones.`;
    try {
      await this.mailerService.sendMail(data.sellerEmail, 'Escrow approved by buyer', text);
    } catch (e) {
      this.logger.warn('Failed to send escrow-approved email', e?.message || e);
    }
  }

  private buildApprovalEmailHtml(amountText: string, approvalLink: string) {
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F5F7F8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
<div style="max-width:480px;margin:40px auto;background:#fff;border-radius:20px;padding:36px;box-shadow:0 20px 60px rgba(15,61,46,0.08);">
  <h1 style="color:#0F3D2E;font-size:20px;margin:0 0 12px;">Approve your escrow</h1>
  <p style="color:#4B5563;font-size:15px;line-height:1.5;margin:0 0 24px;">
    An escrow for <strong>${amountText}</strong> has been created and is awaiting your approval before it becomes active.
  </p>
  <a href="${approvalLink}" style="display:inline-block;background:#0F3D2E;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:14px 28px;border-radius:12px;">Approve Escrow</a>
  <p style="color:#9CA3AF;font-size:12px;line-height:1.5;margin:24px 0 0;">
    If the button doesn't work, copy and paste this link into your browser:<br>${approvalLink}
  </p>
</div>
</body></html>`;
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
  }
}

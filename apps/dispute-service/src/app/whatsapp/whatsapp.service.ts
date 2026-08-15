import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import axios from 'axios';
import * as crypto from 'crypto';
import { KafkaEvents } from '@org/kafka';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../dispute/cloudinary.service';
import { DisputeService } from '../dispute/dispute.service';
import { DisputeAiService } from './dispute-ai.service';

interface MediaItem {
  url: string;
  headers?: Record<string, string>;
  fileName?: string;
}

interface IncomingPayload {
  from: string; // WhatsApp phone number, no leading '+'
  text?: string;
  mediaItems?: MediaItem[];
}

interface ResolvedParty {
  userId: string;
  role: 'buyer' | 'seller';
  dispute: { id: string; status: string } | null;
  escrow: { id: string; buyerId: string; sellerId: string; escrowCode: string } | null;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly disputeService: DisputeService,
    private readonly ai: DisputeAiService,
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientKafka,
  ) {}

  private normalizePhone(phone: string): string {
    return String(phone || '').replace(/[^\d]/g, '');
  }

  private send(to: string, message: string) {
    this.kafkaClient.emit(KafkaEvents.WHATSAPP_SEND, { to: this.normalizePhone(to), message });
  }

  private async logBotEvent(disputeId: string, direction: 'in' | 'out', text: string, userId?: string) {
    try {
      await this.prisma.disputeEvent.create({
        data: { disputeId, eventType: 'BOT_MESSAGE', payload: { direction, text }, triggeredBy: userId || 'bot' },
      });
    } catch (e) {
      this.logger.warn('Failed to log bot conversation event', e);
    }
  }

  // Resolves an inbound WhatsApp number to the Escrow Africa account + their single most
  // recent open/under-review dispute. Never guesses across multiple disputes - if a user has
  // more than one active dispute, we surface the most recent one only.
  private async resolveParty(phoneRaw: string): Promise<ResolvedParty | null> {
    const normalized = this.normalizePhone(phoneRaw);
    if (!normalized) return null;

    let user = await this.prisma.user.findFirst({ where: { phone: `+${normalized}` } });
    if (!user) {
      const last10 = normalized.slice(-10);
      user = await this.prisma.user.findFirst({ where: { phone: { contains: last10 } } });
    }
    if (!user) return null;

    const escrows = await this.prisma.escrow.findMany({
      where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      select: { id: true, buyerId: true, sellerId: true, escrowCode: true },
    });
    const escrowIds = escrows.map((e) => e.id);

    const dispute = escrowIds.length
      ? await this.prisma.dispute.findFirst({
          where: { relatedContractId: { in: escrowIds }, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, relatedContractId: true },
        })
      : null;

    if (!dispute) return { userId: user.id, role: 'buyer', dispute: null, escrow: null };

    const escrow = escrows.find((e) => e.id === dispute.relatedContractId)!;
    return {
      userId: user.id,
      role: escrow.buyerId === user.id ? 'buyer' : 'seller',
      dispute,
      escrow,
    };
  }

  private async counterpartyPhone(escrow: { buyerId: string; sellerId: string }, userId: string): Promise<string | null> {
    const counterpartyId = escrow.buyerId === userId ? escrow.sellerId : escrow.buyerId;
    const user = await this.prisma.user.findUnique({ where: { id: counterpartyId }, select: { phone: true } });
    return user?.phone || null;
  }

  private async findRespondableProposal(disputeId: string, userId: string) {
    const events = await this.prisma.disputeEvent.findMany({
      where: { disputeId, eventType: { in: ['SETTLEMENT_PROPOSED', 'SETTLEMENT_ACCEPTED', 'SETTLEMENT_DECLINED'] } },
      orderBy: { createdAt: 'asc' },
    });
    const responded = new Set(
      events
        .filter((e) => e.eventType !== 'SETTLEMENT_PROPOSED')
        .map((e: any) => e.payload?.acceptedProposalId || e.payload?.declinedProposalId),
    );
    const pending = events.filter((e) => e.eventType === 'SETTLEMENT_PROPOSED' && e.triggeredBy !== userId && !responded.has(e.id));
    return pending[pending.length - 1] || null;
  }

  async handleIncoming(rawBody: any) {
    let provider: 'meta' | '360dialog' | 'unknown' = 'unknown';
    const messages: any[] = [];

    if (rawBody && rawBody.object === 'whatsapp_business_account' && Array.isArray(rawBody.entry)) {
      provider = 'meta';
      for (const entry of rawBody.entry) {
        const changes = entry.changes || [];
        for (const ch of changes) {
          const value = ch.value || {};
          if (Array.isArray(value.messages)) messages.push(...value.messages);
        }
      }
    } else if (rawBody && Array.isArray(rawBody.messages)) {
      provider = '360dialog';
      messages.push(...rawBody.messages);
    } else if (rawBody && rawBody.messages) {
      messages.push(rawBody.messages);
    }

    if (messages.length === 0) return { ok: true };

    const msg = messages[0];
    const from = msg.from || msg.sender?.id || rawBody.from || rawBody.sender || 'unknown';
    const text = msg.text?.body || msg.body || (msg.message && msg.message.body) || (msg.text && msg.text.body) || rawBody.body || '';

    const mediaItems: MediaItem[] = [];
    try {
      if (provider === 'meta') {
        const mediaTypes = ['image', 'document', 'video', 'audio'];
        for (const t of mediaTypes) {
          const m = msg[t];
          if (m && m.id) {
            const token = process.env.WHATSAPP_ACCESS_TOKEN;
            if (!token) this.logger.warn('WHATSAPP_ACCESS_TOKEN not set; cannot fetch media');
            try {
              const metaInfo = await axios.get(`https://graph.facebook.com/v20.0/${m.id}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const mediaUrl = metaInfo.data?.url;
              if (mediaUrl) {
                mediaItems.push({ url: mediaUrl, headers: { Authorization: `Bearer ${token}` }, fileName: m.filename || undefined });
              }
            } catch (err) {
              this.logger.error('Failed to resolve Meta media URL', err);
            }
          }
        }
      } else if (provider === '360dialog') {
        const attachments = msg.attachments || msg.media || [];
        for (const a of attachments) {
          if (a.url) mediaItems.push({ url: a.url, fileName: a.filename || undefined });
        }
      }
    } catch (err) {
      this.logger.error('Error extracting media items', err);
    }

    const payload: IncomingPayload = { from, text, mediaItems };

    const party = await this.resolveParty(payload.from);
    if (!party) {
      this.send(payload.from, "We couldn't find an Escrow Africa account registered with this WhatsApp number. Please make sure you're messaging from the number you signed up with.");
      return { ok: true };
    }
    if (!party.dispute || !party.escrow) {
      this.send(payload.from, "You don't currently have an active dispute. This line is only for ongoing dispute resolution.");
      return { ok: true };
    }

    const { userId, dispute, escrow, role } = party;
    await this.logBotEvent(dispute.id, 'in', payload.text || '[media]', userId);

    // Media -> evidence
    if (payload.mediaItems && payload.mediaItems.length > 0) {
      const created: string[] = [];
      for (const item of payload.mediaItems) {
        try {
          const res = await axios.get(item.url, { responseType: 'arraybuffer', headers: item.headers });
          const buffer = Buffer.from(res.data);
          const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
          const mimeType = String(res.headers['content-type'] || 'application/octet-stream');
          const fileName = item.fileName || item.url.split('/').pop() || `media-${Date.now()}`;

          const cloudUrl = await this.cloudinary.uploadBuffer(buffer, { resource_type: 'auto' });

          await this.prisma.evidence.create({
            data: {
              disputeId: dispute.id,
              url: item.url,
              proofUrl: cloudUrl,
              mimeType,
              fileName,
              fileHash,
              fileSize: buffer.length,
              uploadedById: userId,
              proofOfBreach: false,
            },
          });
          created.push(cloudUrl);
        } catch (err) {
          this.logger.error('Failed to fetch/upload media', err);
        }
      }

      await this.prisma.disputeEvent.create({
        data: { disputeId: dispute.id, eventType: 'EVIDENCE_ADDED', payload: { added: created.length, urls: created }, triggeredBy: userId },
      });

      const reply = `Received ${created.length} file(s) as evidence. Type DECIDE when you're ready for our AI mediator to review your case, or HUMAN to request a human mediator instead.`;
      await this.logBotEvent(dispute.id, 'out', reply, userId);
      this.send(payload.from, reply);
      return { ok: true };
    }

    const normalized = (payload.text || '').trim().toLowerCase();
    let reply: string;

    if (normalized.startsWith('decide') || normalized.startsWith('review') || normalized === 'ai') {
      // Fire-and-forget: the AI review can take well over the ~5s Meta expects for a webhook
      // response, so acknowledge immediately and let it message both parties when it's done.
      reply = "On it — our AI mediator is reviewing the evidence submitted so far. This can take a minute; we'll message you both with the outcome.";
      this.ai.reviewAndDecide(dispute.id).catch((e) => this.logger.error('AI review failed', e?.message || e));
    } else if (normalized.startsWith('human') || normalized.startsWith('agent') || normalized.startsWith('manual')) {
      try {
        await this.disputeService.requestManual(dispute.id, { reason: payload.text } as any, userId);
        reply = 'Understood — a human mediator has been requested and our team will review your case shortly.';
      } catch (e: any) {
        reply = `Could not request a human mediator: ${e?.message || 'unknown error'}`;
      }
    } else if (normalized.startsWith('propose')) {
      try {
        await this.disputeService.proposeSettlement(dispute.id, userId);
        reply = "Settlement proposed. We've notified the other party — they can accept or decline.";
        const cp = await this.counterpartyPhone(escrow, userId);
        if (cp) this.send(cp, `The other party has proposed a settlement for your dispute on escrow ${escrow.escrowCode}. Reply ACCEPT or DECLINE, or log in to see the full case.`);
      } catch (e: any) {
        reply = `Could not propose a settlement: ${e?.message || 'unknown error'}`;
      }
    } else if (normalized.startsWith('accept')) {
      const proposal = await this.findRespondableProposal(dispute.id, userId);
      if (!proposal) {
        reply = 'There is no pending settlement proposal for you to accept right now.';
      } else {
        try {
          await this.disputeService.acceptSettlement(proposal.id, userId);
          reply = 'You accepted the settlement. This dispute is now resolved.';
          const cp = await this.counterpartyPhone(escrow, userId);
          if (cp) this.send(cp, 'The other party accepted your settlement proposal. This dispute is now resolved.');
        } catch (e: any) {
          reply = `Could not accept the settlement: ${e?.message || 'unknown error'}`;
        }
      }
    } else if (normalized.startsWith('decline')) {
      const proposal = await this.findRespondableProposal(dispute.id, userId);
      if (!proposal) {
        reply = 'There is no pending settlement proposal for you to decline right now.';
      } else {
        try {
          await this.disputeService.declineSettlement(proposal.id, userId);
          reply = 'You declined the settlement proposal.';
          const cp = await this.counterpartyPhone(escrow, userId);
          if (cp) this.send(cp, 'The other party declined your settlement proposal.');
        } catch (e: any) {
          reply = `Could not decline the settlement: ${e?.message || 'unknown error'}`;
        }
      }
    } else if (normalized.startsWith('status')) {
      const evidenceCount = await this.prisma.evidence.count({ where: { disputeId: dispute.id } });
      reply = `Dispute status: ${dispute.status}. Evidence submitted so far: ${evidenceCount}. You are the ${role} on escrow ${escrow.escrowCode}.\n\nCommands: send photos/videos as evidence, DECIDE (AI review), HUMAN (request a mediator), PROPOSE/ACCEPT/DECLINE (settlement), STATUS.`;
    } else {
      reply = `Hi, I'm the Escrow Africa dispute assistant for escrow ${escrow.escrowCode}. This conversation is private between you and me.\n\nCommands:\n- Send photos/videos as evidence\n- DECIDE - ask our AI mediator to review your case\n- HUMAN - request a human mediator\n- PROPOSE / ACCEPT / DECLINE - settlement offers\n- STATUS - current case status`;
    }

    await this.logBotEvent(dispute.id, 'out', reply, userId);
    this.send(payload.from, reply);
    return { ok: true };
  }
}

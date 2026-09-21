import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto, CreateDisputeMessageDto, RequestReviewDto, RequestManualDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { ClientKafka } from '@nestjs/microservices';
import { KafkaEvents } from '@org/kafka';
import * as crypto from 'crypto';
import { Decimal } from '@prisma/client/runtime/client';
import { CloudinaryService } from './cloudinary.service';

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientKafka,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Create a dispute with mandatory evidence collection and escrow locking.
   * 
   * Validates:
   * - Escrow exists and is valid
   * - User is a party to the escrow (buyer or seller)
   * - Disputed amount is positive and <= escrow total
   * - Proof of breach has at least one file with valid mime type (image/* or video/*)
   * 
   * Atomically:
   * - Creates Dispute record
   * - Creates Evidence records for proof files (with sha256 hash)
   * - Creates DisputeEvent (STATUS_CHANGE)
   * - Locks Escrow (sets isLocked=true, lockedReason='DISPUTE_OPEN')
   * - Emits dispute.opened Kafka event
   */
  async create(createDisputeDto: CreateDisputeDto, userId: string, proofOfBreach: Express.Multer.File[]) {
    const { relatedContractId, contract, breachCategory, disputedAmount, amount, claimDescription, description } = createDisputeDto;
    const escrowReference = relatedContractId || contract;
    const normalizedAmount = disputedAmount ?? amount;
    const normalizedDescription = claimDescription || description || 'Dispute raised without detailed description.';
    const normalizedCategory = this.normalizeBreachCategory(breachCategory);

    if (!escrowReference) {
      throw new BadRequestException('A related contract or escrow reference is required');
    }

    // 1. Validate escrow exists
    const escrow = await this.prisma.escrow.findFirst({
      where: {
        OR: [{ id: escrowReference }, { escrowCode: escrowReference }],
      },
    });
    if (!escrow) {
      throw new NotFoundException(`Escrow with reference ${escrowReference} not found`);
    }

    // 2. Validate user is a party to the escrow (buyer or seller)
    if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
      throw new BadRequestException('You are not a party to this escrow and cannot open a dispute');
    }

    // 3. Validate disputedAmount
    if (normalizedAmount == null || Number(normalizedAmount) <= 0) {
      throw new BadRequestException('Disputed amount must be greater than 0');
    }
    if (Number(normalizedAmount) > escrow.amount) {
      throw new BadRequestException(`Disputed amount (${normalizedAmount}) cannot exceed escrow total (${escrow.amount})`);
    }

    // 4. Validate proofOfBreach files
    if (!proofOfBreach || proofOfBreach.length === 0) {
      throw new BadRequestException('At least one proof file is required');
    }

    const validMimeTypes = /^(image|video)\//;
    for (const file of proofOfBreach) {
      if (!validMimeTypes.test(file.mimetype)) {
        throw new BadRequestException(
          `Invalid file type: ${file.mimetype}. Only image/* and video/* are allowed.`
        );
      }
      if (!file.buffer) {
        throw new BadRequestException('Proof files must be uploaded as binary files');
      }
    }

    // 5. Upload proof files to Cloudinary BEFORE opening a DB transaction - external network
    // calls inside a Prisma interactive transaction count against its 5s timeout, and a slow
    // upload (or several) reliably blows past that and aborts the whole transaction.
    const uploadBatchId = crypto.randomUUID();
    const uploadedFiles = await Promise.all(
      proofOfBreach.map(async (file) => {
        const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
        const proofUrl = await this.cloudinaryService.uploadBuffer(file.buffer, {
          folder: 'dispute-proofs',
          resource_type: 'auto',
          public_id: `dispute-${uploadBatchId}-${Date.now().toString(36)}-${file.originalname.replace(/\.[^/.]+$/, '')}`,
        });
        return { file, fileHash, proofUrl };
      })
    );

    // 6-8. Create dispute, evidence, dispute event, and lock escrow in one fast DB-only transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create dispute
      const dispute = await tx.dispute.create({
        data: {
          relatedContractId: escrow.id,
          openedById: userId,
          breachCategory: normalizedCategory as any,
          disputedAmount: new Decimal(Number(normalizedAmount)),
          claimDescription: normalizedDescription,
          status: 'OPEN',
        },
      });

      // Create Evidence records for the already-uploaded proof files
      const evidenceRecords = await Promise.all(
        uploadedFiles.map(({ file, fileHash, proofUrl }) =>
          tx.evidence.create({
            data: {
              disputeId: dispute.id,
              url: file.originalname,
              proofUrl,
              mimeType: file.mimetype,
              fileName: file.originalname,
              fileHash,
              uploadedById: userId,
              proofOfBreach: true,
            },
          })
        )
      );

      // Create DisputeEvent for dispute opening
      await tx.disputeEvent.create({
        data: {
          disputeId: dispute.id,
          eventType: 'STATUS_CHANGE',
          payload: {
            from: null,
            to: 'OPEN',
            reason: claimDescription,
          },
          triggeredBy: userId,
        },
      });

      // Lock the escrow
      const lockedEscrow = await tx.escrow.update({
        where: { id: escrow.id },
        data: {
          isLocked: true,
          lockedReason: 'DISPUTE_OPEN',
          lockedAt: new Date(),
        },
      });

      return { dispute, evidenceRecords, lockedEscrow };
    });

    // 8. Emit dispute.opened Kafka event
    this.logger.log(`Emitting dispute.opened for escrow ${escrow.id}, dispute ${result.dispute.id}`);
    this.kafkaClient.emit(KafkaEvents.DISPUTE_OPENED, {
      disputeId: result.dispute.id,
      escrowId: escrow.id,
      openedBy: userId,
      breachCategory: normalizedCategory,
      disputedAmount: Number(normalizedAmount),
      status: 'OPEN',
      timestamp: new Date(),
    });

    // 9. Proactively message both parties on WhatsApp separately - each gets their own
    // 1:1 thread with the bot, never a shared one, so they never see each other's replies.
    this.notifyPartiesOfNewDispute(escrow.id, result.dispute.id).catch((e) =>
      this.logger.warn('Failed to send dispute-opened WhatsApp notifications', e?.message || e),
    );

    return result.dispute;
  }

  private async notifyPartiesOfNewDispute(escrowId: string, disputeId: string) {
    const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
    if (!escrow) return;

    const [buyer, seller] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: escrow.buyerId }, select: { phone: true } }),
      this.prisma.user.findUnique({ where: { id: escrow.sellerId }, select: { phone: true } }),
    ]);

    const text =
      `A dispute has been opened on your escrow transaction (${escrow.escrowCode}). ` +
      `Reply here with photos/videos of your evidence and a brief explanation of your side. ` +
      `Type DECIDE once you're ready for our AI mediator to review the case, or HUMAN at any time to request a human mediator. ` +
      `This conversation is private between you and the Escrow Africa bot.`;

    const normalize = (p?: string | null) => (p ? p.replace(/[^\d]/g, '') : null);
    const buyerPhone = normalize(buyer?.phone);
    const sellerPhone = normalize(seller?.phone);

    if (buyerPhone) this.kafkaClient.emit(KafkaEvents.WHATSAPP_SEND, { to: buyerPhone, message: text });
    if (sellerPhone) this.kafkaClient.emit(KafkaEvents.WHATSAPP_SEND, { to: sellerPhone, message: text });
  }

  async review(id: string) {
    const existing = await this.prisma.dispute.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Dispute not found');

    if (existing.status === 'RESOLVED' || existing.status === 'REJECTED') {
      throw new BadRequestException(`Cannot review a dispute that is already ${existing.status}`);
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: 'UNDER_REVIEW',
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Emitting DISPUTE_UNDER_REVIEW for dispute ${id}`);
    this.kafkaClient.emit(KafkaEvents.DISPUTE_UNDER_REVIEW, {
      disputeId: updated.id,
      escrowId: updated.relatedContractId,
      status: updated.status
    });
    
    return updated;
  }

  async resolve(id: string, resolveDto: ResolveDisputeDto, adminId: string) {
    const existing = await this.prisma.dispute.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Dispute not found');

    if (existing.status === 'RESOLVED') {
      throw new BadRequestException('Dispute already resolved');
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolution: resolveDto.resolution,
        resolvedBy: 'ADMIN_DECISION' as any,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Emitting DISPUTE_RESOLVED for escrow ${updated.relatedContractId}`);
    this.kafkaClient.emit(KafkaEvents.DISPUTE_RESOLVED, {
      disputeId: updated.id,
      escrowId: updated.relatedContractId,
      resolution: updated.resolution,
      status: updated.status
    });

    return updated;
  }

  // Resolution path for the WhatsApp bot's AI adjudication. Distinct from resolve() (admin path):
  // sets resolvedBy=BOT_ADJUDICATION and includes `verdict` on the emitted event, which
  // escrow-service listens for to actually release/refund the locked funds.
  async resolveByBot(id: string, verdict: 'RELEASE_TO_SELLER' | 'REFUND_BUYER', reasoning: string, confidence: number) {
    const existing = await this.prisma.dispute.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Dispute not found');

    if (existing.status === 'RESOLVED' || existing.status === 'REJECTED') {
      throw new BadRequestException('Dispute already closed');
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolution: reasoning,
        resolvedBy: 'BOT_ADJUDICATION' as any,
        confidence,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Emitting DISPUTE_RESOLVED (bot verdict: ${verdict}) for escrow ${updated.relatedContractId}`);
    this.kafkaClient.emit(KafkaEvents.DISPUTE_RESOLVED, {
      disputeId: updated.id,
      escrowId: updated.relatedContractId,
      resolution: updated.resolution,
      status: updated.status,
      verdict,
    });

    return updated;
  }

  async addMessage(id: string, dto: CreateDisputeMessageDto, userId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    if (!escrow || (escrow.buyerId !== userId && escrow.sellerId !== userId)) {
      throw new BadRequestException('Only the buyer or seller can add chat messages to this dispute');
    }

    if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
      throw new BadRequestException('Cannot add messages to a closed dispute');
    }

    const event = await this.prisma.disputeEvent.create({
      data: {
        disputeId: id,
        eventType: 'MESSAGE',
        payload: { message: dto.message },
        triggeredBy: userId,
      },
    });

    return event;
  }

  // page=1 returns the most recent `limit` messages (newest first) so the chat UI can show the
  // latest window without fetching the entire thread; the caller reverses `data` for chronological
  // display and pages forward (page=2, 3, ...) to load progressively older messages.
  async getMessages(id: string, userId: string, userType?: string, page = 1, limit = 30) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    const isParticipant = !!escrow && (escrow.buyerId === userId || escrow.sellerId === userId);
    if (!isParticipant && userType !== 'ADMIN') {
      throw new BadRequestException('Only the buyer, seller, or an admin can view dispute messages');
    }

    const take = Math.min(limit, 100);
    const skip = Math.max(0, (page - 1) * take);
    const where = { disputeId: id, eventType: 'MESSAGE' as const };

    const [data, total] = await Promise.all([
      this.prisma.disputeEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          createdAt: true,
          triggeredBy: true,
          payload: true,
        },
      }),
      this.prisma.disputeEvent.count({ where }),
    ]);

    return { data, page, limit: take, total };
  }

  // All dispute events (settlement proposals/accepts/declines, reviews, etc.) - lets the
  // frontend discover a pending settlement proposal and the eventId needed to accept/decline it.
  // Kept chronological (ascending) and defaulting to a generous page size: settlement
  // accept/decline events reference an earlier proposal event by id, and the frontend derives
  // "pending vs resolved" proposal status by cross-referencing across the whole set - splitting
  // that pair across two pages would silently misreport a settlement's status.
  async getEvents(id: string, userId: string, userType?: string, page = 1, limit = 100) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    const isParticipant = !!escrow && (escrow.buyerId === userId || escrow.sellerId === userId);
    if (!isParticipant && userType !== 'ADMIN') {
      throw new BadRequestException('Only the buyer, seller, or an admin can view dispute events');
    }

    const take = Math.min(limit, 200);
    const skip = Math.max(0, (page - 1) * take);
    // MESSAGE is the existing shared web chat; BOT_MESSAGE is each party's private,
    // separate WhatsApp conversation with the bot and must never be exposed to the
    // other party. BOT_ANALYSIS_RESULT (the AI's verdict) stays visible to both.
    const where = { disputeId: id, eventType: { notIn: ['MESSAGE', 'BOT_MESSAGE'] as any } };

    const [data, total] = await Promise.all([
      this.prisma.disputeEvent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
        select: {
          id: true,
          eventType: true,
          createdAt: true,
          triggeredBy: true,
          payload: true,
        },
      }),
      this.prisma.disputeEvent.count({ where }),
    ]);

    return { data, page, limit: take, total };
  }

  async requestReview(id: string, dto: RequestReviewDto, userId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    if (!escrow || (escrow.buyerId !== userId && escrow.sellerId !== userId)) {
      throw new BadRequestException('Only the buyer or seller can request review for this dispute');
    }

    if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
      throw new BadRequestException('Cannot request review for a closed dispute');
    }

    if (dispute.status === 'UNDER_REVIEW') {
      throw new BadRequestException('Review has already been requested for this dispute');
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: 'UNDER_REVIEW',
        updatedAt: new Date(),
      },
    });

    await this.prisma.disputeEvent.create({
      data: {
        disputeId: id,
        eventType: 'REVIEW_REQUESTED',
        payload: { reason: dto.reason || null },
        triggeredBy: userId,
      },
    });

    this.kafkaClient.emit(KafkaEvents.DISPUTE_REVIEW_REQUESTED, {
      disputeId: updated.id,
      escrowId: updated.relatedContractId,
      requestedBy: userId,
      reason: dto.reason || null,
    });

    return updated;
  }

  async proposeSettlement(id: string, userId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    if (!escrow || (escrow.buyerId !== userId && escrow.sellerId !== userId)) {
      throw new BadRequestException('Only the buyer or seller can propose settlement for this dispute');
    }

    if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
      throw new BadRequestException('Cannot propose settlement for a closed dispute');
    }
    const event = await this.prisma.disputeEvent.create({
      data: {
        disputeId: id,
        eventType: 'SETTLEMENT_PROPOSED',
        payload: {},
        triggeredBy: userId,
      },
    });

    this.kafkaClient.emit(KafkaEvents.DISPUTE_SETTLEMENT_PROPOSED, {
      disputeId: id,
      escrowId: dispute.relatedContractId,
      proposedBy: userId,
    });

    return event;
  }

  async acceptSettlement(eventId: string, userId: string) {
    const event = await this.prisma.disputeEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Settlement proposal not found');
    if (event.eventType !== 'SETTLEMENT_PROPOSED') throw new BadRequestException('Not a settlement proposal');

    const dispute = await this.prisma.dispute.findUnique({ where: { id: event.disputeId } });
    if (!dispute) throw new NotFoundException('Related dispute not found');

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    if (!escrow || (escrow.buyerId !== userId && escrow.sellerId !== userId)) {
      throw new BadRequestException('Only the buyer or seller can accept a settlement');
    }

    // Prevent proposer from accepting their own proposal
    if (event.triggeredBy === userId) throw new BadRequestException('Proposer cannot accept their own settlement');

    const acceptedEvent = await this.prisma.disputeEvent.create({
      data: {
        disputeId: event.disputeId,
        eventType: 'SETTLEMENT_ACCEPTED' as any,
        payload: { acceptedProposalId: eventId },
        triggeredBy: userId,
      },
    });

    const updated = await this.prisma.dispute.update({
      where: { id: event.disputeId },
      data: { status: 'RESOLVED', resolution: 'Settlement accepted', resolvedBy: 'MUTUAL_SETTLEMENT' as any, updatedAt: new Date() },
    });

    this.kafkaClient.emit(KafkaEvents.DISPUTE_SETTLEMENT_ACCEPTED, {
      disputeId: updated.id,
      escrowId: updated.relatedContractId,
      acceptedBy: userId,
      proposalEventId: eventId,
    });

    this.kafkaClient.emit(KafkaEvents.DISPUTE_RESOLVED, {
      disputeId: updated.id,
      escrowId: updated.relatedContractId,
      resolution: updated.resolution,
      status: updated.status,
    });

    return acceptedEvent;
  }

  async declineSettlement(eventId: string, userId: string) {
    const event = await this.prisma.disputeEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Settlement proposal not found');
    if (event.eventType !== 'SETTLEMENT_PROPOSED') throw new BadRequestException('Not a settlement proposal');

    const dispute = await this.prisma.dispute.findUnique({ where: { id: event.disputeId } });
    if (!dispute) throw new NotFoundException('Related dispute not found');

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    if (!escrow || (escrow.buyerId !== userId && escrow.sellerId !== userId)) {
      throw new BadRequestException('Only the buyer or seller can decline a settlement');
    }

    if (event.triggeredBy === userId) throw new BadRequestException('Proposer cannot decline their own settlement');

    const declinedEvent = await this.prisma.disputeEvent.create({
      data: {
        disputeId: event.disputeId,
        eventType: 'SETTLEMENT_DECLINED' as any,
        payload: { declinedProposalId: eventId },
        triggeredBy: userId,
      },
    });

    this.kafkaClient.emit(KafkaEvents.DISPUTE_SETTLEMENT_DECLINED, {
      disputeId: event.disputeId,
      escrowId: dispute.relatedContractId,
      declinedBy: userId,
      proposalEventId: eventId,
    });

    return declinedEvent;
  }

  async requestManual(id: string, dto: RequestReviewDto | RequestManualDto, userId: string) {
    // Allow bot or user to request manual review; reuse requestReview logic but accept caller id
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    if (!escrow || (escrow.buyerId !== userId && escrow.sellerId !== userId)) {
      throw new BadRequestException('Only the buyer or seller can request review for this dispute');
    }

    if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
      throw new BadRequestException('Cannot request review for a closed dispute');
    }

    if (dispute.status === 'UNDER_REVIEW') {
      throw new BadRequestException('Review has already been requested for this dispute');
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: 'UNDER_REVIEW',
        updatedAt: new Date(),
      },
    });

    await this.prisma.disputeEvent.create({
      data: {
        disputeId: id,
        eventType: 'REVIEW_REQUESTED',
        payload: { reason: (dto as any).reason || null },
        triggeredBy: userId,
      },
    });

    this.kafkaClient.emit(KafkaEvents.DISPUTE_REVIEW_REQUESTED, {
      disputeId: updated.id,
      escrowId: updated.relatedContractId,
      requestedBy: userId,
      reason: (dto as any).reason || null,
    });

    return updated;
  }

  // Disputes for every escrow the user is a party to (buyer or seller) - not just ones they
  // personally opened, so the counterparty can see and respond to a dispute raised against them.
  async findMine(userId: string, page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = Math.max(0, (page - 1) * take);

    const escrows = await this.prisma.escrow.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      select: { id: true },
    });
    const where = { relatedContractId: { in: escrows.map((e) => e.id) } };

    const [data, total] = await Promise.all([
      this.prisma.dispute.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.dispute.count({ where }),
    ]);

    return { data, page, limit: take, total };
  }

  async findAll(page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = Math.max(0, (page - 1) * take);

    const [data, total] = await Promise.all([
      this.prisma.dispute.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.dispute.count(),
    ]);

    return { data, page, limit: take, total };
  }

  async findOne(id: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    return dispute;
  }

  private normalizeBreachCategory(input?: string) {
    const value = input?.trim();
    if (!value) {
      return 'OTHERS';
    }

    const mapping: Record<string, string> = {
      'quality issue': 'QUALITY_ISSUES',
      'quality issues': 'QUALITY_ISSUES',
      'delayed delivery': 'DELAYED_DELIVERY',
      'delayed delivery / missed deadline': 'DELAYED_DELIVERY',
      'communication': 'COMMUNICATION_CESSATION',
      'communication cessation / idle vendor': 'COMMUNICATION_CESSATION',
      'out of scope': 'OUT_OF_SCOPE_DEMANDS',
      'out of scope demands / contract violation': 'OUT_OF_SCOPE_DEMANDS',
      'other': 'OTHERS',
      'other unresolved dispute': 'OTHERS',
    };

    const normalized = value.toLowerCase();
    return mapping[normalized] || value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  }
}

import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto, CreateDisputeMessageDto, ProposeSettlementDto, RequestReviewDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { ClientKafka } from '@nestjs/microservices';
import { KafkaEvents } from '@org/kafka';
import * as crypto from 'crypto';
import { Decimal } from '@prisma/client/runtime/client';

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientKafka,
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
  async create(createDisputeDto: CreateDisputeDto, userId: string) {
    const { relatedContractId, breachCategory, disputedAmount, claimDescription, proofOfBreach } = createDisputeDto;

    // 1. Validate escrow exists
    const escrow = await this.prisma.escrow.findUnique({
      where: { id: relatedContractId },
    });
    if (!escrow) {
      throw new NotFoundException(`Escrow with ID ${relatedContractId} not found`);
    }

    // 2. Validate user is a party to the escrow (buyer or seller)
    if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
      throw new BadRequestException('You are not a party to this escrow and cannot open a dispute');
    }

    // 3. Validate disputedAmount
    if (disputedAmount <= 0) {
      throw new BadRequestException('Disputed amount must be greater than 0');
    }
    if (disputedAmount > escrow.amount) {
      throw new BadRequestException(`Disputed amount (${disputedAmount}) cannot exceed escrow total (${escrow.amount})`);
    }

    // 4. Validate proofOfBreach
    if (!proofOfBreach || proofOfBreach.length === 0) {
      throw new BadRequestException('At least one proof of breach file is required');
    }

    // Validate each file's mime type
    const validMimeTypes = /^(image|video)\//;
    for (const file of proofOfBreach) {
      if (!validMimeTypes.test(file.mimeType)) {
        throw new BadRequestException(
          `Invalid file type: ${file.mimeType}. Only image/* and video/* are allowed.`
        );
      }
    }

    // 5-7. Create dispute, evidence, and lock escrow in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create dispute
      const dispute = await tx.dispute.create({
        data: {
          relatedContractId,
          openedById: userId,
          breachCategory: breachCategory as any,
          disputedAmount: new Decimal(disputedAmount),
          claimDescription,
          status: 'OPEN',
        },
      });

      // Create Evidence records for proofOfBreach files
      const evidenceRecords = await Promise.all(
        proofOfBreach.map(async (file) => {
          // Compute sha256 hash of the URL (for tampering detection)
          const fileHash = crypto
            .createHash('sha256')
            .update(`${file.url}${file.fileName}${file.mimeType}`)
            .digest('hex');

          return tx.evidence.create({
            data: {
              disputeId: dispute.id,
              url: file.url,
              mimeType: file.mimeType,
              fileName: file.fileName,
              fileHash,
              uploadedById: userId,
              proofOfBreach: true, // Mark as proof of breach
            },
          });
        })
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
        where: { id: relatedContractId },
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
      breachCategory,
      disputedAmount,
      status: 'OPEN',
      timestamp: new Date(),
    });

    return result.dispute;
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

  async proposeSettlement(id: string, dto: ProposeSettlementDto, userId: string) {
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
        payload: {
          proposedResolution: dto.proposedResolution,
          offerAmount: dto.offerAmount ?? null,
        },
        triggeredBy: userId,
      },
    });

    this.kafkaClient.emit(KafkaEvents.DISPUTE_SETTLEMENT_PROPOSED, {
      disputeId: id,
      escrowId: dispute.relatedContractId,
      proposedBy: userId,
      proposedResolution: dto.proposedResolution,
      offerAmount: dto.offerAmount ?? null,
    });

    return event;
  }

  async findAll() {
    return this.prisma.dispute.findMany();
  }

  async findOne(id: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    return dispute;
  }
}

import { Injectable, NotFoundException, BadRequestException, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { ClientKafka } from '@nestjs/microservices';
import { KafkaEvents } from '@org/kafka';

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientKafka,
  ) {}

  async create(createDisputeDto: CreateDisputeDto, userId: string) {
    const dispute = await this.prisma.dispute.create({
      data: {
        escrowId: createDisputeDto.escrowId,
        raisedBy: userId,
        reason: createDisputeDto.reason,
        status: 'OPEN',
      },
    });

    this.logger.log(`Emitting DISPUTE_CREATED for escrow ${createDisputeDto.escrowId}`);
    this.kafkaClient.emit(KafkaEvents.DISPUTE_CREATED, {
      disputeId: dispute.id,
      escrowId: dispute.escrowId,
      raisedBy: dispute.raisedBy,
      status: dispute.status
    });
    
    return dispute;
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
      escrowId: updated.escrowId,
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
        resolvedBy: adminId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Emitting DISPUTE_RESOLVED for escrow ${updated.escrowId}`);
    this.kafkaClient.emit(KafkaEvents.DISPUTE_RESOLVED, {
      disputeId: updated.id,
      escrowId: updated.escrowId,
      resolution: updated.resolution,
      status: updated.status
    });

    return updated;
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

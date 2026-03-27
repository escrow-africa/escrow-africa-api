import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Evidence, EvidenceDocument, EvidenceMessage } from './evidence.schema';

@Injectable()
export class EvidenceService {
  constructor(
    @InjectModel(Evidence.name) private evidenceModel: Model<EvidenceDocument>
  ) {}

  async createOrGetEvidence(disputeId: string) {
    let evidence = await this.evidenceModel.findOne({ disputeId }).exec();
    if (!evidence) {
      evidence = await this.evidenceModel.create({ disputeId });
    }
    return evidence;
  }

  async addMessage(disputeId: string, senderId: string, text: string) {
    const evidence = await this.createOrGetEvidence(disputeId);
    evidence.messages.push({ senderId, text, timestamp: new Date() } as EvidenceMessage);
    return evidence.save();
  }

  async addAttachment(disputeId: string, attachmentUrl: string) {
    const evidence = await this.createOrGetEvidence(disputeId);
    evidence.attachments.push(attachmentUrl);
    return evidence.save();
  }

  async getEvidence(disputeId: string) {
    const evidence = await this.evidenceModel.findOne({ disputeId }).exec();
    if (!evidence) {
      throw new NotFoundException('Evidence not found for this dispute');
    }
    return evidence;
  }
}

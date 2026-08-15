import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import axios from 'axios';
import { KafkaEvents } from '@org/kafka';
import { PrismaService } from '../prisma/prisma.service';
import { DisputeService } from '../dispute/dispute.service';

// Below this confidence, the AI escalates to a human mediator instead of guessing.
const CONFIDENCE_THRESHOLD = 0.75;

const VerdictSchema = z.object({
  verdict: z.enum(['RELEASE_TO_SELLER', 'REFUND_BUYER', 'NEEDS_HUMAN_REVIEW']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

@Injectable()
export class DisputeAiService {
  private readonly logger = new Logger(DisputeAiService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly disputeService: DisputeService,
    @Inject('KAFKA_SERVICE') private readonly kafkaClient: ClientKafka,
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  private notify(phone: string | null | undefined, message: string) {
    if (!phone) return;
    this.kafkaClient.emit(KafkaEvents.WHATSAPP_SEND, { to: String(phone).replace(/[^\d]/g, ''), message });
  }

  async reviewAndDecide(disputeId: string) {
    if (!this.client) {
      this.logger.warn('ANTHROPIC_API_KEY not configured; skipping AI review');
      return;
    }

    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) return;

    const escrow = await this.prisma.escrow.findUnique({ where: { id: dispute.relatedContractId } });
    if (!escrow) return;

    const [buyer, seller] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: escrow.buyerId } }),
      this.prisma.user.findUnique({ where: { id: escrow.sellerId } }),
    ]);

    const evidence = await this.prisma.evidence.findMany({ where: { disputeId }, orderBy: { createdAt: 'asc' } });

    const content: Anthropic.MessageParam['content'] = [
      {
        type: 'text',
        text: [
          `Escrow: ${escrow.escrowCode} — amount ${escrow.amount}`,
          `Description: ${escrow.description || 'n/a'}`,
          `Milestones: ${(escrow.milestones || []).join(', ') || 'n/a'}`,
          `Delivery deadline: ${new Date(escrow.deliveryDeadline).toISOString()}`,
          '',
          `Dispute breach category: ${dispute.breachCategory}`,
          `Disputed amount: ${dispute.disputedAmount}`,
          `Claim description (from the party who opened the dispute): ${dispute.claimDescription}`,
          '',
          `Evidence items submitted: ${evidence.length}`,
        ].join('\n'),
      },
    ] as any;

    for (const item of evidence) {
      const submitter = item.uploadedById === buyer?.id ? 'buyer' : item.uploadedById === seller?.id ? 'seller' : 'unknown';
      const isImage = item.mimeType?.startsWith('image/');
      const sourceUrl = item.proofUrl || item.url;

      if (isImage && sourceUrl) {
        try {
          const res = await axios.get(sourceUrl, { responseType: 'arraybuffer' });
          const base64 = Buffer.from(res.data).toString('base64');
          (content as any[]).push({ type: 'image', source: { type: 'base64', media_type: item.mimeType, data: base64 } });
          (content as any[]).push({ type: 'text', text: `^ Evidence "${item.fileName}", submitted by the ${submitter}.` });
        } catch (err) {
          this.logger.warn(`Failed to fetch evidence image ${item.id}: ${(err as Error).message}`);
          (content as any[]).push({ type: 'text', text: `(Could not load image evidence "${item.fileName}" submitted by the ${submitter})` });
        }
      } else {
        (content as any[]).push({
          type: 'text',
          text: `Non-image evidence "${item.fileName}" (${item.mimeType}) submitted by the ${submitter}: ${sourceUrl}`,
        });
      }
    }

    let result: z.infer<typeof VerdictSchema>;
    try {
      const response = await this.client.messages.parse({
        model: 'claude-opus-5',
        max_tokens: 8000,
        system:
          'You are an impartial dispute mediator for Escrow Africa, an escrow payment platform. ' +
          'A buyer and a seller are in a dispute over an escrow transaction. Review the case details and ' +
          'evidence provided and decide whether the escrowed funds should be released to the seller or ' +
          'refunded to the buyer. Base your decision only on the evidence given. Only return a confident ' +
          'verdict (RELEASE_TO_SELLER or REFUND_BUYER) if the evidence clearly supports one party. If the ' +
          'evidence is inconclusive, contradictory, missing, or insufficient to judge fairly, return ' +
          'NEEDS_HUMAN_REVIEW with a low confidence score instead of guessing.',
        messages: [{ role: 'user', content }],
        output_config: { format: zodOutputFormat(VerdictSchema) },
      });

      if (!response.parsed_output) throw new Error('AI response failed schema validation');
      result = response.parsed_output;
    } catch (err) {
      this.logger.error(`Claude review failed for dispute ${disputeId}: ${(err as Error).message}`);
      result = { verdict: 'NEEDS_HUMAN_REVIEW', confidence: 0, reasoning: 'The AI review could not complete due to a technical error.' };
    }

    await this.prisma.disputeEvent.create({
      data: { disputeId, eventType: 'BOT_ANALYSIS_RESULT', payload: result as any, triggeredBy: 'bot' },
    });

    if (result.verdict === 'NEEDS_HUMAN_REVIEW' || result.confidence < CONFIDENCE_THRESHOLD) {
      await this.prisma.dispute.update({ where: { id: disputeId }, data: { status: 'UNDER_REVIEW', updatedAt: new Date() } });
      this.kafkaClient.emit(KafkaEvents.DISPUTE_REVIEW_REQUESTED, {
        disputeId,
        escrowId: escrow.id,
        requestedBy: 'bot',
        reason: result.reasoning,
      });

      const msg = "Our AI mediator reviewed your case but couldn't reach a confident decision, so it's been escalated to a human mediator. Our team will follow up soon.";
      this.notify(buyer?.phone, msg);
      this.notify(seller?.phone, msg);
      return;
    }

    await this.disputeService.resolveByBot(disputeId, result.verdict, result.reasoning, result.confidence);

    const outcome = result.verdict === 'RELEASE_TO_SELLER' ? 'funds will be released to the seller' : 'funds will be refunded to the buyer';
    const msg = `Our AI mediator has reviewed the evidence and reached a decision: ${outcome}.\n\nReasoning: ${result.reasoning}`;
    this.notify(buyer?.phone, msg);
    this.notify(seller?.phone, msg);
  }
}

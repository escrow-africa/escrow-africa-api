import { Controller, Post, Body, Headers, Logger, Req, ForbiddenException } from '@nestjs/common';
import { MonnifyService } from './monnify.service';
import { WalletService } from '../wallet/wallet.service';

import type { Request } from 'express';

@Controller('monnify')
export class MonnifyController {
  private readonly logger = new Logger(MonnifyController.name);
  constructor(private readonly monnify: MonnifyService, private readonly walletService: WalletService) {}

  // Monnify will POST notifications to this endpoint. Verify signature in production.
  @Post('webhook')
  async webhook(@Req() req: Request, @Body() body: any, @Headers() headers: any) {
    this.logger.debug('Monnify webhook received');

    // Try to obtain the raw body (depends on body-parser verify hook). Fallback to stable JSON stringify.
    const rawBody = (req as any).rawBody || (req as any).rawPayload || JSON.stringify(body);

    // signature header may be placed in different header names
    const signatureHeader = headers['monnify-signature'] || headers['x-monify-signature'] || headers['x-signature'] || headers['signature'] || headers['x-monnify-signature'];
    const ok = this.monnify.verifySignature(rawBody, signatureHeader as any);
    if (!ok) {
      this.logger.warn('Invalid Monnify webhook signature');
      throw new ForbiddenException('Invalid signature');
    }

    const parsed = await this.monnify.parseWebhook(body);
    if (!parsed.providerReference) {
      this.logger.warn('Webhook missing providerReference', body);
      return { ok: false };
    }

    // Our paymentReference was constructed as `${userId}-${uuid}` during initialization
    const parts = String(parsed.providerReference).split('-');
    const userId = parts.slice(0, parts.length - 1).join('-');
    const amount = Number(parsed.amount || 0);
    const status = parsed.status;

    if (status === 'PAID' || status === 'SUCCESS') {
      try {
        // walletService will record payment and credit once (idempotent behaviour)
        await this.walletService.processProviderPayment(parsed.providerReference, userId, amount, 'MONNIFY');
      } catch (e) {
        this.logger.error('Failed to process payment', e);
        return { ok: false };
      }
    }
    return { ok: true };
  }
}

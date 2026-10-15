import { Controller, Post, Body, Headers, Logger, ForbiddenException } from '@nestjs/common';
import { FlutterwaveService } from './flutterwave.service';
import { WalletService } from '../wallet/wallet.service';

@Controller('flutterwave')
export class FlutterwaveController {
  private readonly logger = new Logger(FlutterwaveController.name);
  constructor(private readonly flutterwave: FlutterwaveService, private readonly walletService: WalletService) {}

  // Flutterwave POSTs notifications here. Signature is a static secret echoed back in the
  // "verif-hash" header (set under Settings > Webhooks in the Flutterwave dashboard) - not a
  // computed HMAC like Monnify's, so this is a plain string comparison.
  @Post('webhook')
  async webhook(@Body() body: any, @Headers('verif-hash') verifHash: string) {
    this.logger.debug('Flutterwave webhook received');

    const ok = this.flutterwave.verifySignature(verifHash);
    if (!ok) {
      this.logger.warn('Invalid Flutterwave webhook signature');
      throw new ForbiddenException('Invalid signature');
    }

    const parsed = await this.flutterwave.parseWebhook(body);
    if (!parsed.providerReference) {
      this.logger.warn('Webhook missing providerReference', body);
      return { ok: false };
    }

    const amount = Number(parsed.amount || 0);
    const status = parsed.status;

    if (status === 'SUCCESSFUL' || status === 'SUCCESS') {
      try {
        const pending = await this.walletService.findByProviderReference(parsed.providerReference);
        if (!pending) {
          this.logger.warn('No pending transaction found for providerReference', parsed.providerReference);
          return { ok: false };
        }
        await this.walletService.processProviderPayment(parsed.providerReference, pending.userId, amount, 'FLUTTERWAVE');
      } catch (e) {
        this.logger.error('Failed to process payment', e);
        return { ok: false };
      }
    }
    return { ok: true };
  }
}

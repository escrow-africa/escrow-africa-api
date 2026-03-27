import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  async sendMessage(to: string, message: string) {
    // In production, instantiate Twilio SDK or native Meta Graph API here
    this.logger.log(`[WhatsApp API Mock] Sending to ${to}: ${message}`);
    return true;
  }
}

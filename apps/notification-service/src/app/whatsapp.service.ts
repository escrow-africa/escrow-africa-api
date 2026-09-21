import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  // Real Meta WhatsApp Cloud API call. `to` must be an E.164 number without the
  // leading '+' (e.g. "2348012345678"), matching what the Cloud API expects and
  // what it sends back in inbound webhook payloads.
  async sendMessage(to: string, message: string) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      this.logger.warn('WHATSAPP_ACCESS_TOKEN or PHONE_NUMBER_ID not configured; message not sent', { to });
      return false;
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    };

    try {
      await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      this.logger.log(`WhatsApp message sent to ${to}`);
      return true;
    } catch (e: any) {
      this.logger.error('Failed to send WhatsApp message', to, e?.response?.data || e?.message || e);
      return false;
    }
  }
}

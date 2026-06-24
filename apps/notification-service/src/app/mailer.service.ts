import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: any;

  constructor() {
    const host = process.env.MAIL_HOST || 'localhost';
    const port = Number(process.env.MAIL_PORT || 1025);
    const user = process.env.MAIL_USER || undefined;
    const pass = process.env.MAIL_PASS || undefined;
    const transportOptions: any = { host, port };
    if (user && pass) transportOptions.auth = { user, pass };
    this.transporter = nodemailer.createTransport(transportOptions);
  }

  async sendMail(to: string, subject: string, text: string) {
    const from = process.env.MAIL_FROM || 'no-reply@escrow.africa';
    try {
      const res = await this.transporter.sendMail({ from, to, subject, text });
      this.logger.log(`Email sent to ${to} (${res && res.messageId || 'jsonTransport'})`);
      return res;
    } catch (err: any) {
      this.logger.error('Failed to send email', err?.message || err);
      throw err;
    }
  }
}

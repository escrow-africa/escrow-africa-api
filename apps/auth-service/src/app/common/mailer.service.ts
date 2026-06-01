import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailerService.name);

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('MAIL_HOST');
    const port = Number(this.config.get<string>('MAIL_PORT'));
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASS');

    const transportOptions: any = {
      host,
      port,
      auth: { user, pass },
    };

    this.transporter = nodemailer.createTransport(transportOptions);
  }

  async sendOtpEmail(to: string, otp: number) {
    const from = this.config.get<string>('MAIL_FROM');
    const subject = 'Your verification code';
    const text = `Your verification code is: ${otp}. It expires in 10 minutes.`;
    try {
      const res = await this.transporter.sendMail({ from, to, subject, text });
      this.logger.log(`OTP email sent to ${to} (${res && (res as any).messageId || 'jsonTransport'})`);
      return res;
    } catch (err) {
      this.logger.error('Failed to send OTP email', (err as any)?.stack || err);
      throw err;
    }
  }
}

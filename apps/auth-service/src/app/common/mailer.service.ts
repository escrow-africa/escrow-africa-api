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

  async sendWaitlistEmail(to: string, firstName: string) {
    const from = this.config.get<string>('MAIL_FROM');
    const subject = "You're on the list — here's what to expect from Escrow Africa";
    const text = [
      `Hi ${firstName},`,
      '',
      "Thanks for joining the Escrow Africa waitlist! You're officially in line.",
      '',
      'Escrow Africa is a secure escrow platform for buyers and sellers doing business across Africa. ' +
        'When you agree on a deal, the buyer\'s funds are held safely in escrow until the work is delivered ' +
        'and confirmed, so buyers only pay for what they actually receive, and sellers know their payment ' +
        'is already secured before they start. If anything goes wrong, our dispute resolution process ' +
        '(backed by both AI review and human mediators) is there to sort it out fairly.',
      '',
      "Here's what happens next:",
      '- We\'re rolling out access in waves, and your spot is now reserved.',
      '- The moment your access opens up, we\'ll email you a link to create your account, no action needed from you until then.',
      '- Early waitlist members get first access to our launch pricing.',
      '',
      '',
      'Talk soon,',
      'The Escrow Africa Team',
    ].join('\n');

    const html = this.buildWaitlistEmailHtml(firstName);

    try {
      const res = await this.transporter.sendMail({ from, to, subject, text, html });
      this.logger.log(`Waitlist email sent to ${to} (${(res && (res as any).messageId) || 'jsonTransport'})`);
      return res;
    } catch (err) {
      this.logger.error('Failed to send waitlist email', (err as any)?.stack || err);
      throw err;
    }
  }

  private buildWaitlistEmailHtml(firstName: string) {
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F5F7F8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
<div style="max-width:480px;margin:40px auto;background:#fff;border-radius:20px;padding:36px;box-shadow:0 20px 60px rgba(15,61,46,0.08);">
  <h1 style="color:#0F3D2E;font-size:20px;margin:0 0 12px;">You're on the list, ${firstName} 🎉</h1>
  <p style="color:#4B5563;font-size:15px;line-height:1.6;margin:0 0 20px;">
    Thanks for joining the Escrow Africa waitlist! Here's what Escrow Africa is, and what to expect next.
  </p>
  <p style="color:#4B5563;font-size:15px;line-height:1.6;margin:0 0 20px;">
    Escrow Africa is a secure escrow platform for buyers and sellers doing business across Africa.
    A buyer's funds are held safely in escrow until the work is delivered and confirmed - so buyers
    only pay for what they actually receive, and sellers know their payment is already secured before
    they start. If anything goes wrong, our dispute resolution process (backed by both AI review and
    human mediators) is there to sort it out fairly.
  </p>
  <div style="background:#F5F7F8;border-radius:14px;padding:20px 22px;margin:0 0 24px;">
    <p style="color:#0F3D2E;font-size:13px;font-weight:600;margin:0 0 10px;">What happens next</p>
    <ul style="color:#4B5563;font-size:14px;line-height:1.6;margin:0;padding-left:18px;">
      <li>We're rolling out access in waves - your spot is now reserved.</li>
      <li>We'll email you the moment your access opens, with a link to create your account.</li>
      <li>Early waitlist members get first access to our launch pricing.</li>
    </ul>
  </div>
  <p style="color:#9CA3AF;font-size:12px;line-height:1.5;margin:0;">
    Got questions in the meantime? Just reply to this email - a real person will get back to you.
  </p>
</div>
</body></html>`;
  }
}

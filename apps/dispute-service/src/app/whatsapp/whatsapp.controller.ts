import { Controller, Post, Body, Logger, Get, Query, BadRequestException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);
  constructor(private readonly whatsappService: WhatsappService) {}

  // Verification endpoint for Meta/360dialog webhooks
  @Get('webhook')
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode && token) {
      if (token === verifyToken) {
        return Number.isNaN(Number(challenge)) ? challenge : challenge;
      }
      throw new BadRequestException('Verification token mismatch');
    }
    throw new BadRequestException('Missing mode or token');
  }

  // Incoming webhook POST from provider. Raw payload is forwarded for provider-specific parsing.
  @Post('webhook')
  async webhook(@Body() body: any) {
    this.logger.debug('Incoming whatsapp webhook');
    const resp = await this.whatsappService.handleIncoming(body);
    return resp;
  }
}

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { HelpService } from './help.service';
import { ContactSupportDto } from './dto/contact-support.dto';

@Controller('auth/help')
@UseGuards(JwtAuthGuard)
export class HelpController {
  constructor(private readonly helpService: HelpService) {}

  @Get('faqs')
  getFaqs() {
    return this.helpService.getFaqs();
  }

  @Post('contact')
  contact(@Req() req: any, @Body() dto: ContactSupportDto) {
    return this.helpService.createTicket(req.user?.id, dto.subject, dto.message);
  }

  @Get('tickets')
  listTickets(@Req() req: any) {
    return this.helpService.listMyTickets(req.user?.id);
  }
}

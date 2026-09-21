import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FAQS } from './faqs';

@Injectable()
export class HelpService {
  constructor(private readonly prisma: PrismaService) {}

  getFaqs() {
    return FAQS;
  }

  createTicket(userId: string, subject: string, message: string) {
    return this.prisma.supportTicket.create({
      data: { userId, subject, message },
    });
  }

  listMyTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.user) return true;

    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (!auth || !String(auth).startsWith('Bearer ')) return false;

    const token = String(auth).slice('Bearer '.length);
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET as string) as Record<string, any>;

      // Tokens issued before session tracking existed have no sessionId and remain valid
      // until they naturally expire, matching auth-service's own JwtStrategy.
      if (payload.sessionId) {
        const session = await this.prisma.session.findUnique({ where: { id: payload.sessionId } });
        if (!session || session.revokedAt) return false;
      }

      req.user = { ...payload, id: payload.sub };
      return true;
    } catch {
      return false;
    }
  }
}

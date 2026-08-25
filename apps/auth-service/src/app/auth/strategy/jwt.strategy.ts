import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: any) {
    // sessionId is absent from tokens issued before session tracking existed; those remain
    // valid until they naturally expire rather than being rejected outright.
    if (payload.sessionId) {
      const session = await this.prisma.session.findUnique({ where: { id: payload.sessionId } });
      if (!session || session.revokedAt) {
        throw new UnauthorizedException('Session has been revoked');
      }
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      type: payload.type,
      sessionId: payload.sessionId,
    };
  }
}

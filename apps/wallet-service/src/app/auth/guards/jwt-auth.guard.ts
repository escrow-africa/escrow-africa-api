import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();

    if (req.user) return true;

    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (!auth || !String(auth).startsWith('Bearer ')) return false;

    const token = String(auth).slice('Bearer '.length);

    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;

      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64').toString('utf8'),
      );

      req.user = payload;
      return true;
    } catch {
      return false;
    }
  }
}
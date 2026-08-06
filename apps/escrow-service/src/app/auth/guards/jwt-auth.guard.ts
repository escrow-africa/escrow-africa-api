import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from '../../../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    // if another auth layer populated req.user, allow
    if (req.user) return true;

    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (!auth || !String(auth).startsWith('Bearer ')) return false;

    const token = String(auth).slice('Bearer '.length);
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET as string) as Record<string, any>;
      req.user = { ...payload, id: payload.sub };
      return true;
    } catch (e) {
      return false;
    }
  }
}

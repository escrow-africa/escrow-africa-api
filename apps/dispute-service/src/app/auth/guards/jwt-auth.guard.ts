import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.user) return true;

    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (!auth || !String(auth).startsWith('Bearer ')) return false;

    const token = String(auth).slice('Bearer '.length);
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET as string) as Record<string, any>;
      req.user = { ...payload, id: payload.sub };
      return true;
    } catch {
      return false;
    }
  }
}

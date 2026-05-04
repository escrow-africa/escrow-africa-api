import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root() {
    return { message: 'API Gateway' };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

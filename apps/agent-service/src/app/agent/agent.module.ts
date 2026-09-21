import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'agent-service-secret',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}

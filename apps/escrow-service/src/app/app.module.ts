import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EscrowModule } from './escrow/escrow.module';
import { PrismaModule } from './prisma/prisma.module';
import { KafkaModule } from '@org/kafka';

@Module({
  imports: [PrismaModule, EscrowModule, KafkaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { DisputeModule } from './dispute/dispute.module';
import { KafkaModule } from '@org/kafka';

@Module({
  imports: [PrismaModule, DisputeModule, KafkaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

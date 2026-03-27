import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { DisputeModule } from './dispute/dispute.module';
import { KafkaModule } from '@org/kafka';
import { MongodbModule } from '@org/mongodb';
import { EvidenceModule } from './evidence/evidence.module';

@Module({
  imports: [PrismaModule, DisputeModule, KafkaModule, MongodbModule, EvidenceModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

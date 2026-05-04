import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WalletModule } from './wallet/wallet.module';
import { PrismaModule } from './prisma/prisma.module';
import { KafkaModule } from '@org/kafka';
import { TransactionModule } from './transaction/transaction.module';

@Module({
  imports: [PrismaModule, KafkaModule, WalletModule, TransactionModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

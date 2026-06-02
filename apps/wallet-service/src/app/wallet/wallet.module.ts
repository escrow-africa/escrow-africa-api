import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MonnifyModule } from '../monnify/monnify.module';
import { MonnifyController } from '../monnify/monnify.controller';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [PrismaModule, MonnifyModule, TransactionModule],
  controllers: [WalletController, MonnifyController],
  providers: [WalletService],
})
export class WalletModule {}

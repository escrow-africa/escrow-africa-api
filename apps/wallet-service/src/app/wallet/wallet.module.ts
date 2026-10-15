import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MonnifyModule } from '../monnify/monnify.module';
import { MonnifyController } from '../monnify/monnify.controller';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { FlutterwaveController } from '../flutterwave/flutterwave.controller';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  // MonnifyModule/MonnifyController are kept registered (unused by WalletService now) rather
  // than removed, so switching back is a one-line change if Flutterwave needs to be rolled back.
  imports: [PrismaModule, MonnifyModule, FlutterwaveModule, TransactionModule],
  controllers: [WalletController, MonnifyController, FlutterwaveController],
  providers: [WalletService],
})
export class WalletModule {}

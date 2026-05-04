import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MonnifyModule } from '../monnify/monnify.module';
import { MonnifyController } from '../monnify/monnify.controller';

@Module({
  imports: [PrismaModule, MonnifyModule],
  controllers: [WalletController, MonnifyController],
  providers: [WalletService],
})
export class WalletModule {}

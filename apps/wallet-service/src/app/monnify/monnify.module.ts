import { Module } from '@nestjs/common';
import { MonnifyService } from './monnify.service';

@Module({
  imports: [],
  providers: [MonnifyService],
  exports: [MonnifyService],
})
export class MonnifyModule {}

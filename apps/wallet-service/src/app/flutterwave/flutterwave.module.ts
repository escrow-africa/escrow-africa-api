import { Module } from '@nestjs/common';
import { FlutterwaveService } from './flutterwave.service';

@Module({
  imports: [],
  providers: [FlutterwaveService],
  exports: [FlutterwaveService],
})
export class FlutterwaveModule {}

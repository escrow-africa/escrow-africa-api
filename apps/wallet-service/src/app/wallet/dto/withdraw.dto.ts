import { IsNotEmpty, IsNumber, IsPositive, IsString } from 'class-validator';

export class WithdrawDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsNotEmpty()
  @IsString()
  payoutAccountId!: string;
}

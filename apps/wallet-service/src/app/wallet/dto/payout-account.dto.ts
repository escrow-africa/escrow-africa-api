import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreatePayoutAccountDto {
  @IsNotEmpty()
  @IsString()
  bankName!: string;

  @IsNotEmpty()
  @IsString()
  bankCode!: string;

  @IsNotEmpty()
  @IsString()
  @Length(10, 10)
  accountNumber!: string;

  @IsNotEmpty()
  @IsString()
  accountName!: string;
}

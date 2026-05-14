import { IsString, IsNotEmpty, IsNumber, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CardDto {
  @IsString()
  @IsNotEmpty()
  number!: string;

  @IsString()
  @IsNotEmpty()
  expiryMonth!: string;

  @IsString()
  @IsNotEmpty()
  expiryYear!: string;

  @IsOptional()
  @IsString()
  pin?: string;

  @IsOptional()
  @IsString()
  cvv?: string;
}

export class TopUpDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsNumber()
  amount!: number;

  @IsString()
  @IsIn(['bank', 'ussd', 'card'])
  method!: 'bank' | 'ussd' | 'card';

  @IsOptional()
  @ValidateNested()
  @Type(() => CardDto)
  card?: CardDto;

  @IsOptional()
  deviceInformation?: any;

  @IsOptional()
  skipProvider?: boolean;
}

export default TopUpDto;

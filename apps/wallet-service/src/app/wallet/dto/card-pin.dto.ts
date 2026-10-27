import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CardDto } from './topup.dto';

export class CardPinDto {
  @IsNotEmpty()
  @IsString()
  transactionReference!: string;

  @IsNotEmpty()
  @IsString()
  pin!: string;

  @ValidateNested()
  @Type(() => CardDto)
  card!: CardDto;
}

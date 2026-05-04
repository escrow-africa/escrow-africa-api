import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CardOtpDto {
  @IsOptional()
  @IsString()
  transactionReference?: string;

  @IsString()
  @IsNotEmpty()
  tokenId!: string;

  @IsString()
  @IsNotEmpty()
  token!: string;
}

export default CardOtpDto;

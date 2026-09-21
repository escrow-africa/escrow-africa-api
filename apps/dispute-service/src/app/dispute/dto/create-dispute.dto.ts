import { IsString, IsUUID, IsNumber, IsPositive, IsOptional, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDisputeDto {
  @IsOptional()
  @IsUUID()
  relatedContractId?: string; // escrow ID

  @IsOptional()
  @IsString()
  contract?: string; // frontend-friendly reference such as BUY-801

  @IsOptional()
  @IsString()
  breachCategory?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @IsPositive()
  disputedAmount?: number; // must be > 0

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsString()
  claimDescription?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateDisputeMessageDto {
  @IsString()
  @IsNotEmpty()
  message!: string;
}

export class RequestReviewDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RequestManualDto {
  @IsOptional()
  @IsString()
  requesterId?: string; // used when caller is a bot or external integration

  @IsOptional()
  @IsString()
  reason?: string;
}

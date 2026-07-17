import { IsNotEmpty, IsString, IsUUID, IsNumber, IsArray, ValidateNested, IsEnum, IsPositive, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ProofOfBreachFileDto {
  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string; // must be image/* or video/*

  @IsString()
  @IsNotEmpty()
  fileName!: string;
}

export class CreateDisputeDto {
  @IsUUID()
  @IsNotEmpty()
  relatedContractId!: string; // escrow ID

  @IsEnum(['QUALITY_ISSUES', 'DELAYED_DELIVERY', 'COMMUNICATION_CESSATION', 'OUT_OF_SCOPE_DEMANDS', 'OTHERS'])
  @IsNotEmpty()
  breachCategory!: string;

  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  disputedAmount!: number; // must be > 0

  @IsString()
  @IsNotEmpty()
  claimDescription!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProofOfBreachFileDto)
  @IsNotEmpty()
  proofOfBreach!: ProofOfBreachFileDto[]; // min 1 file, enforced in service
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

export class ProposeSettlementDto {
  @IsString()
  @IsNotEmpty()
  proposedResolution!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  offerAmount?: number;
}

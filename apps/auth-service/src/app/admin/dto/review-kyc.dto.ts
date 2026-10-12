import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export enum KycReviewDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class ReviewKycDto {
  @IsEnum(KycReviewDecision)
  status!: KycReviewDecision;

  @ValidateIf((dto) => dto.status === KycReviewDecision.REJECTED)
  @IsString()
  @IsNotEmpty()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  verifiedMonthlyDispersalLimit?: string;
}

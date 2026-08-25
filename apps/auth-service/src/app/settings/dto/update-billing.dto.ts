import { IsOptional, IsString } from 'class-validator';

export class UpdateBillingDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  vatId?: string;

  @IsOptional()
  @IsString()
  billingAddress?: string;
}

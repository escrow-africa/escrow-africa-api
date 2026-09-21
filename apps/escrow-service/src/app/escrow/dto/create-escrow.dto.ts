import { IsEmail, IsString, IsArray, ArrayNotEmpty, IsNumber, IsPositive, IsIn, IsOptional, IsDateString, ValidateIf, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEscrowDto {
  @IsIn(['BUYER', 'SELLER'])
  creatorRole!: 'BUYER' | 'SELLER';

  @ValidateIf((o) => o.creatorRole === 'SELLER')
  @IsEmail()
  @IsNotEmpty()
  buyerEmail?: string;

  @ValidateIf((o) => o.creatorRole === 'BUYER')
  @IsEmail()
  @IsNotEmpty()
  sellerEmail?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  milestones!: string[];

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsDateString()
  deliveryDeadline!: string;

  @Type(() => Number)
  @IsIn([1, 3, 5, 7])
  inspectionPeriodDays!: 1 | 3 | 5 | 7;

  @IsOptional()
  @IsString()
  description?: string;
}

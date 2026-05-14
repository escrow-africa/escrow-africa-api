import { IsEmail, IsString, IsArray, ArrayNotEmpty, IsNumber, IsPositive, IsIn, IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEscrowDto {
  @IsEmail()
  buyerEmail!: string;

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

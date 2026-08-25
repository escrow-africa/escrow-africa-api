import { IsIn, IsNotEmpty } from 'class-validator';

export class UpgradePlanDto {
  @IsNotEmpty()
  @IsIn(['free', 'pro', 'premium'])
  planId!: string;
}

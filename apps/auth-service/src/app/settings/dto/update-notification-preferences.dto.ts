import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  escrowContractReleases?: boolean;

  @IsOptional()
  @IsBoolean()
  dispersalClearingAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  disputeArbitrationWarning?: boolean;

  @IsOptional()
  @IsBoolean()
  tipsPromotionalAnalytics?: boolean;
}

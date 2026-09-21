import { IsIn, IsOptional } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsIn(['NGN', 'USD', 'EUR', 'GBP'])
  currency?: string;

  @IsOptional()
  @IsIn(['en-US', 'en-GB', 'fr-FR', 'es-ES'])
  language?: string;

  @IsOptional()
  @IsIn(['GMT+1', 'GMT+0', 'GMT+2', 'GMT-5'])
  timezone?: string;
}

import { Body, Controller, Get, Patch, Post, Put, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { SettingsService } from './settings.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateBillingDto } from './dto/update-billing.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Patch('me')
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.settingsService.updateProfile(req.user?.id, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', { storage: memoryStorage() }))
  uploadAvatar(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    return this.settingsService.uploadAvatar(req.user?.id, file);
  }

  @Get('billing')
  getBilling(@Req() req: any) {
    return this.settingsService.getBilling(req.user?.id);
  }

  @Put('billing')
  updateBilling(@Req() req: any, @Body() dto: UpdateBillingDto) {
    return this.settingsService.updateBilling(req.user?.id, dto);
  }

  @Get('notification-preferences')
  getNotificationPreferences(@Req() req: any) {
    return this.settingsService.getNotificationPreferences(req.user?.id);
  }

  @Put('notification-preferences')
  updateNotificationPreferences(@Req() req: any, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.settingsService.updateNotificationPreferences(req.user?.id, dto);
  }

  @Get('preferences')
  getPreferences(@Req() req: any) {
    return this.settingsService.getPreferences(req.user?.id);
  }

  @Put('preferences')
  updatePreferences(@Req() req: any, @Body() dto: UpdatePreferencesDto) {
    return this.settingsService.updatePreferences(req.user?.id, dto);
  }

  @Post('kyc')
  @UseInterceptors(FileInterceptor('document', { storage: memoryStorage() }))
  submitKyc(@Req() req: any, @Body() dto: SubmitKycDto, @UploadedFile() file: Express.Multer.File) {
    return this.settingsService.submitKyc(req.user?.id, dto.documentType, file);
  }

  @Get('kyc/status')
  getKycStatus(@Req() req: any) {
    return this.settingsService.getKycStatus(req.user?.id);
  }
}

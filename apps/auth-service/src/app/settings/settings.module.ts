import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { CloudinaryService } from './cloudinary.service';
import { PrismaModule } from '../prisma/prisma.module';

// JwtAuthGuard resolves the 'jwt' passport strategy registered by AuthModule's JwtStrategy —
// both modules must be imported into AppModule, but this one doesn't need to re-provide it.
@Module({
  imports: [PrismaModule],
  controllers: [SettingsController],
  providers: [SettingsService, CloudinaryService],
})
export class SettingsModule {}

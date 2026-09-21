import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UserModule } from './user/user.module';
import { OtpModule } from './otp/otp.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { SettingsModule } from './settings/settings.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { HelpModule } from './help/help.module';

@Module({
  imports: [
    PrismaModule,
    UserModule,
    OtpModule,
    AuthModule,
    AdminModule,
    AdminAuthModule,
    SettingsModule,
    SubscriptionModule,
    HelpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

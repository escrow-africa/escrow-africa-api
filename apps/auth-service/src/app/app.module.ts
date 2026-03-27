import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UserModule } from './user/user.module';
import { OtpModule } from './otp/otp.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { AdminAuthModule } from './admin-auth/admin-auth.module';

@Module({
  imports: [PrismaModule, UserModule, OtpModule, AuthModule, AdminModule, AdminAuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

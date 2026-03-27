import { Controller, Post, Body } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { LoginAdminDto } from './dto/login-admin.dto';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  async login(@Body() loginAdminDto: LoginAdminDto) {
    const admin = await this.adminAuthService.validateAdmin(loginAdminDto);
    return this.adminAuthService.login(admin);
  }
}

import { Controller, Get, Post, Body, UseGuards, Req, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('seed')
  seedSuperAdmin(@Body() createAdminDto: CreateAdminDto) {
    return this.adminService.seedSuperAdmin(createAdminDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  createAdmin(@Body() createAdminDto: CreateAdminDto, @Req() req: any) {
    return this.adminService.create(createAdminDto, req.user?.role);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAllAdmins(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.adminService.findAll(Number(page) || 1, Number(limit) || 20);
  }
}

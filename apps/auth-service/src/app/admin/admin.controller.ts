import { Controller, Get, Post, Body, UseGuards, Req, Query, Param, ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private assertIsAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
  }

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

  @UseGuards(JwtAuthGuard)
  @Get('kyc')
  listKycSubmissions(
    @Req() req: any,
    @Query('status') status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    this.assertIsAdmin(req);
    return this.adminService.listKycSubmissions(status, Number(page) || 1, Number(limit) || 20);
  }

  @UseGuards(JwtAuthGuard)
  @Post('kyc/:id/review')
  reviewKyc(@Req() req: any, @Param('id') id: string, @Body() dto: ReviewKycDto) {
    this.assertIsAdmin(req);
    return this.adminService.reviewKyc(id, dto);
  }
}

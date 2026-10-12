import { Controller, Post, Body, Param, Patch, Get, Query, Delete } from '@nestjs/common';
import { AdsService } from './ads.service';
import { CreateAdDto } from './dto/create-ad.dto';
import { UpdateAdDto } from './dto/update-ad.dto';

@Controller('ads')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Post()
  create(@Body() dto: CreateAdDto) {
    return this.ads.create(dto);
  }

  @Post(':id/deposit')
  deposit(@Param('id') id: string, @Body('amount') amount: number) {
    return this.ads.deposit(id, amount);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAdDto) {
    return this.ads.update(id, dto);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.ads.pause(id);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.ads.resume(id);
  }

  @Post(':id/terminate')
  terminate(@Param('id') id: string) {
    return this.ads.terminate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ads.delete(id);
  }

  @Get('analytics/summary')
  analytics() {
    return this.ads.analytics();
  }

  @Get()
  fetchAll(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.ads.fetchAll(Number(page), Number(limit));
  }
}

import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OemService } from './oem.service';

type OemRequest = { user?: { userId?: string; username?: string; role?: string } };

@ApiTags('OEM Materials & Quotations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('oem')
export class OemController {
  constructor(private readonly service: OemService) {}

  @Get('master-data')
  @Roles('admin', 'viewer')
  masterData() { return this.service.masterData(); }

  @Get('materials')
  @Roles('admin', 'viewer')
  materials() { return this.service.materials(); }

  @Post('materials')
  @Roles('admin')
  registerMaterial(@Body() body: Record<string, unknown>, @Req() request: OemRequest) {
    return this.service.registerMaterial(body, request.user?.username ?? request.user?.userId);
  }

  @Post('projects')
  @Roles('admin')
  addProject(@Body() body: Record<string, unknown>, @Req() request: OemRequest) {
    return this.service.addProject(body, request.user?.username ?? request.user?.userId);
  }

  @Get('quotations')
  @Roles('admin', 'viewer')
  quotations(@Query('page') page?: string, @Query('projectId') projectId?: string) {
    return this.service.listQuotations(page, projectId);
  }

  @Get('quotations/:quotationId')
  @Roles('admin', 'viewer')
  quotation(@Param('quotationId') id: string) { return this.service.getQuotation(id); }

  @Post('quotations')
  @Roles('admin')
  createQuotation(@Body() body: Record<string, unknown>, @Req() request: OemRequest) {
    return this.service.saveQuotation(null, body, request.user?.username ?? request.user?.userId);
  }

  @Patch('quotations/:quotationId')
  @Roles('admin')
  updateQuotation(@Param('quotationId') id: string, @Body() body: Record<string, unknown>, @Req() request: OemRequest) {
    return this.service.saveQuotation(id, body, request.user?.username ?? request.user?.userId);
  }
}
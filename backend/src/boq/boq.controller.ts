import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BoqService } from './boq.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('BOQ')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId/boq')
export class BoqController {
  constructor(private readonly boqService: BoqService) {}

  // Read-only prototype-style worksheet. Keep the existing costing route intact.
  @Roles('admin', 'manager', 'viewer')
  @Get('worksheet')
  getWorkOrderWorksheet(@Param('projectId') projectId: string) {
    return this.boqService.getWorkOrderWorksheet(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('costing')
  getBoqCosting(@Param('projectId') projectId: string) {
    return this.boqService.getBoqCosting(projectId);
  }
}

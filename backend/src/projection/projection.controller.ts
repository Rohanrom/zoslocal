import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProjectionService } from './projection.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Projection')
@Controller('projection')
export class ProjectionController {
  constructor(private readonly projectionService: ProjectionService) {}

  @Get('demo')
  getDemo() {
    return this.projectionService.getDemo();
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({
    name: 'projectId',
    required: true,
    example: 'park_heights',
    description: 'Project id used by the common indr project tables',
  })
  @Get('home-layer-progress')
  getHomeLayerProgress(@Query('projectId') projectId: string) {
    return this.projectionService.getHomeLayerProgress(projectId);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({
    name: 'projectId',
    required: false,
    description:
      'When supplied, calculate from project-scoped indr tables. Omit for the existing legacy projection calculation.',
  })
  @ApiQuery({
    name: 'dailyPainters',
    required: false,
    example: 5,
    description: 'Number of painters available per day',
  })
  @ApiQuery({
    name: 'workMode',
    required: false,
    example: 'Machine',
    description: 'Machine, Manual, or Both',
  })
  @Get('layers')
  getProjectionLayers(
    @Query('projectId') projectId?: string,
    @Query('dailyPainters') dailyPainters?: string,
    @Query('workMode') workMode?: string,
  ) {
    return this.projectionService.getProjectionLayersFromDbCalculation({
      projectId,
      dailyPainters,
      workMode,
    });
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'projectId', required: false })
  @Get('flats')
  getProjectionFlats(@Query('projectId') projectId?: string) {
    return this.projectionService.getFlatCompletionFromDbCalculation(projectId);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'projectId', required: false })
  @Get('flats/applications')
  getFlatApplications(@Query('projectId') projectId?: string) {
    return this.projectionService.getDistinctFlatApplications(projectId);
  }
}

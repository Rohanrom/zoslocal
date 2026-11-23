import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'manager', 'viewer')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  listProjects() {
    return this.projectsService.listProjects();
  }

  // Read-only Dimensions table, always scoped to the selected project.
  @Get(':projectId/dimensions/filters')
  getDimensionFilters(@Param('projectId') projectId: string) {
    return this.projectsService.getDimensionFilters(projectId);
  }

  @Get(':projectId/dimensions')
  getDimensions(
    @Param('projectId') projectId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('block') block?: string,
    @Query('application') application?: string,
    @Query('surfaceType') surfaceType?: string,
  ) {
    return this.projectsService.getDimensions(projectId, {
      page,
      pageSize,
      search,
      block,
      application,
      surfaceType,
    });
  }

  @Get(':projectId')
  getProject(@Param('projectId') projectId: string) {
    return this.projectsService.getProject(projectId);
  }
}

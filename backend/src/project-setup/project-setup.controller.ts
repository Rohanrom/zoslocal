import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectSetupService } from './project-setup.service';

@ApiTags('Admin Project Setup')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/project-setup')
export class ProjectSetupController {
  constructor(private readonly projectSetupService: ProjectSetupService) {}

  @Get('projects')
  listProjects() {
    return this.projectSetupService.listProjects();
  }

  @Post('projects')
  createProject(@Body() dto: CreateProjectDto) {
    return this.projectSetupService.createProject(dto);
  }

  @Get('projects/:projectId/status')
  getProjectStatus(@Param('projectId') projectId: string) {
    return this.projectSetupService.getProjectStatus(projectId);
  }

  @Post('projects/:projectId/import/layers')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  importLayers(
    @Param('projectId') projectId: string,
    @UploadedFile() file: any,
  ) {
    return this.projectSetupService.importLayers(projectId, file);
  }

  @Post('projects/:projectId/import/surfaces')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  importSurfaces(
    @Param('projectId') projectId: string,
    @UploadedFile() file: any,
  ) {
    return this.projectSetupService.importSurfaces(projectId, file);
  }

  @Post('projects/:projectId/import/cost-boq')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  importCostBoq(
    @Param('projectId') projectId: string,
    @UploadedFile() file: any,
  ) {
    return this.projectSetupService.importCostBoq(projectId, file);
  }

}
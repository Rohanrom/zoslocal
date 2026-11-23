import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UpdateRecommendationScopeDto } from './dto/update-recommendation-scope.dto';
import { AssignmentService } from './assignment.service';
import { CreateAssignmentRunDto } from './dto/create-assignment-run.dto';
import { SubmitReportingDto } from './dto/submit-reporting.dto';
import { UpdateWorkModeDto } from './dto/update-work-mode.dto';
import { AddDemandToRecommendationDto } from './dto/add-demand-to-recommendation.dto';
import { RemoveRecommendationDto } from './dto/remove-recommendation.dto';
import { UpdateRecommendationPaintersDto } from './dto/update-recommendation-painters.dto';
import { UpdateReportedBackendRowDto } from './dto/update-reported-backend-row.dto';
import { FinalizeAssignmentRunDto } from './dto/finalize-assignment-run.dto';
import { BulkSubmitAssignedReportingDto } from './dto/bulk-submit-assigned-reporting.dto';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Assignment Engine')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId/assignment')
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  @ApiParam({ name: 'projectId', example: 'indradhanush' })
  @Get('health')
  @Roles('admin', 'manager', 'viewer')
  getHealth(@Param('projectId') projectId: string) {
    return this.assignmentService.getHealth(projectId);
  }

  // -------------------------------------------------------
  // Dropdowns
  // -------------------------------------------------------

  @Get('dropdowns/blocks')
  @Roles('admin', 'manager', 'viewer')
  getBlocks(@Param('projectId') projectId: string) {
    return this.assignmentService.getBlocks(projectId);
  }

  @Get('dropdowns/applications')
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'block', required: false, example: 'Block-A' })
  getApplications(
    @Param('projectId') projectId: string,
    @Query('block') block?: string,
  ) {
    return this.assignmentService.getApplications(projectId, block);
  }

  @Get('dropdowns/flats')
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'block', required: false, example: 'Block-A' })
  @ApiQuery({ name: 'application', required: false, example: 'FLAT-A' })
  getFlats(
    @Param('projectId') projectId: string,
    @Query('block') block?: string,
    @Query('application') application?: string,
  ) {
    return this.assignmentService.getFlats(projectId, block, application);
  }

  @Get('dropdowns/layers')
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'application', required: false, example: 'FLAT-A' })
  @ApiQuery({ name: 'flat', required: false, example: 'FA-0418' })
  getLayers(
    @Param('projectId') projectId: string,
    @Query('application') application?: string,
    @Query('flat') flat?: string,
  ) {
    return this.assignmentService.getLayers(projectId, application, flat);
  }

  @Get('dropdowns/walls')
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'application', required: false, example: 'FLAT-A' })
  @ApiQuery({ name: 'flat', required: false, example: 'FA-0418' })
  @ApiQuery({ name: 'layerId', required: false, example: 'AF-0418-1' })
  getWalls(
    @Param('projectId') projectId: string,
    @Query('application') application?: string,
    @Query('flat') flat?: string,
    @Query('layerId') layerId?: string,
  ) {
    return this.assignmentService.getWalls(
      projectId,
      application,
      flat,
      layerId,
    );
  }

  @Get('dropdowns/painters')
  @Roles('admin', 'manager', 'viewer')
  getPainters(@Param('projectId') projectId: string) {
    return this.assignmentService.getPainters(projectId);
  }

  @Get('dropdowns/productivity-options')
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'application', required: false, example: 'FLAT-A' })
  @ApiQuery({ name: 'layerName', required: false, example: '1st Coat Paint' })
  getProductivityOptions(
    @Param('projectId') projectId: string,
    @Query('application') application?: string,
    @Query('layerName') layerName?: string,
  ) {
    return this.assignmentService.getProductivityOptions(
      projectId,
      application,
      layerName,
    );
  }
  @Get('dropdowns/material-suggestion')
@Roles('admin', 'manager', 'viewer')
getMaterialSuggestion(
  @Param('projectId') projectId: string,
  @Query('application') application?: string,
  @Query('layerName') layerName?: string,
) {
  return this.assignmentService.getMaterialSuggestion(
    projectId,
    application,
    layerName,
  );
}

  // -------------------------------------------------------
  // Live demand views
  // -------------------------------------------------------

  @Get('views/layer-status')
  @Roles('admin', 'manager', 'viewer')
  getLayerStatus(@Param('projectId') projectId: string) {
    return this.assignmentService.getLayerStatus(projectId);
  }

  @Get('views/rollover')
  @Roles('admin', 'manager', 'viewer')
  getRollover(
    @Param('projectId') projectId: string,
    @Query('assignmentDate') assignmentDate?: string,
  ) {
    return this.assignmentService.getRollover(projectId, assignmentDate);
  }

  @Get('views/qc-rework')
  @Roles('admin', 'manager', 'viewer')
  getQcRework(@Param('projectId') projectId: string) {
    return this.assignmentService.getQcRework(projectId);
  }

  @Get('views/ongoing')
  @Roles('admin', 'manager', 'viewer')
  getOngoing(@Param('projectId') projectId: string) {
    return this.assignmentService.getOngoing(projectId);
  }

  @Get('views/new-layer')
  @Roles('admin', 'manager', 'viewer')
  getNewLayer(@Param('projectId') projectId: string) {
    return this.assignmentService.getNewLayer(projectId);
  }

  @Get('views/live-demand')
  @Roles('admin', 'manager', 'viewer')
  getLiveDemand(@Param('projectId') projectId: string) {
    return this.assignmentService.getLiveDemand(projectId);
  }

  // -------------------------------------------------------
  // Runs and demand snapshots
  // -------------------------------------------------------

  @Get('floor-restrictions')
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'runId', required: false })
  getFloorRestrictions(
    @Param('projectId') projectId: string,
    @Query('runId') runId?: string,
  ) {
    return this.assignmentService.getFloorRestrictions(projectId, runId);
  }

  @Post('runs')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'Create assignment run and fill work_demand_item / work_demand_wall',
  })
  createAssignmentRun(
    @Param('projectId') projectId: string,
    @Body() dto: CreateAssignmentRunDto,
  ) {
    return this.assignmentService.createAssignmentRun(projectId, dto);
  }

  @Get('runs')
  @Roles('admin', 'manager', 'viewer')
  getAssignmentRuns(@Param('projectId') projectId: string) {
    return this.assignmentService.getAssignmentRuns(projectId);
  }

  @Get('runs/:runId')
  @Roles('admin', 'manager', 'viewer')
  getAssignmentRunById(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.assignmentService.getAssignmentRunById(projectId, runId);
  }

  @Get('runs/:runId/demand-items')
  @Roles('admin', 'manager', 'viewer')
  getDemandItems(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.assignmentService.getDemandItems(projectId, runId);
  }

  @Get('runs/:runId/demand-walls')
  @Roles('admin', 'manager', 'viewer')
  getDemandWalls(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.assignmentService.getDemandWalls(projectId, runId);
  }

  @Get('demand/:demandId/walls')
  @Roles('admin', 'manager', 'viewer')
  getDemandWallsForDemand(
    @Param('projectId') projectId: string,
    @Param('demandId') demandId: string,
  ) {
    return this.assignmentService.getDemandWallsForDemand(projectId, demandId);
  }

  @Post('demand/:demandId/work-mode')
  @Roles('admin', 'manager')
  updateDemandWorkMode(
    @Param('projectId') projectId: string,
    @Param('demandId') demandId: string,
    @Body() dto: UpdateWorkModeDto,
  ) {
    return this.assignmentService.updateDemandWorkMode(
      projectId,
      demandId,
      dto.machineOrManual,
    );
  }

@Get('runs/:runId/recommendation-scope')
@Roles('admin', 'manager', 'viewer')
getRecommendationScope(
  @Param('projectId') projectId: string,
  @Param('runId') runId: string,
) {
  return this.assignmentService.getRecommendationScope(projectId, runId);
}

@Patch('runs/:runId/recommendation-scope')
@Roles('admin', 'manager')
updateRecommendationScope(
  @Param('projectId') projectId: string,
  @Param('runId') runId: string,
  @Body() dto: UpdateRecommendationScopeDto,
) {
  return this.assignmentService.updateRecommendationScope(projectId, runId, dto);
}

/**
 * POST fallback for environments/proxies where PATCH is not reaching the
 * Nest route correctly. The frontend can call either PATCH or POST; both
 * update the same run-wise recommendation scope.
 */
@Post('runs/:runId/recommendation-scope')
@Roles('admin', 'manager')
updateRecommendationScopePost(
  @Param('projectId') projectId: string,
  @Param('runId') runId: string,
  @Body() dto: UpdateRecommendationScopeDto,
) {
  return this.assignmentService.updateRecommendationScope(projectId, runId, dto);
}

  // -------------------------------------------------------
  // Recommended assignment
  // -------------------------------------------------------

  @Post('runs/:runId/recommendations/generate')
  @Roles('admin', 'manager')
  generateRecommendations(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
    @Body() dto: GenerateRecommendationsDto,
  ) {
    return this.assignmentService.generateRecommendations(projectId, runId, dto);
  }

  @Get('runs/:runId/recommendations')
  @Roles('admin', 'manager', 'viewer')
  getRecommendations(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.assignmentService.getRecommendations(projectId, runId);
  }

  @Get('runs/:runId/recommendation-walls')
  @Roles('admin', 'manager', 'viewer')
  getRecommendationWalls(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.assignmentService.getRecommendationWalls(projectId, runId);
  }

  @Post('recommendations/:recommendationId/work-mode')
  @Roles('admin', 'manager')
  updateRecommendationWorkMode(
    @Param('projectId') projectId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() dto: UpdateWorkModeDto,
  ) {
    return this.assignmentService.updateRecommendationWorkMode(
      projectId,
      recommendationId,
      dto.machineOrManual,
    );
  }

  // -------------------------------------------------------
  // Final assignment
  // -------------------------------------------------------

  @Post('runs/:runId/finalize')
  @Roles('admin', 'manager')
  finalizeRun(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
    @Body() dto: FinalizeAssignmentRunDto,
  ) {
    return this.assignmentService.finalizeRun(
      projectId,
      runId,
      dto.finalizedBy ?? 'system',
      dto.overrideReason,
    );
  }

  @Get('runs/:runId/final-assignments')
  @Roles('admin', 'manager', 'viewer')
  getFinalAssignments(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.assignmentService.getFinalAssignments(projectId, runId);
  }

  @Get('runs/:runId/final-assignment-walls')
  @Roles('admin', 'manager', 'viewer')
  getFinalAssignmentWalls(
    @Param('projectId') projectId: string,
    @Param('runId') runId: string,
  ) {
    return this.assignmentService.getFinalAssignmentWalls(projectId, runId);
  }

  @Get('attendance/today')
  @Roles('admin', 'manager', 'viewer')
  @ApiOperation({
    summary:
      'Get today\'s Jibble attendance for Member-role painters at the selected project',
  })
  getTodayPainterAttendance(@Param('projectId') projectId: string) {
    return this.assignmentService.getTodayPainterAttendance(projectId);
  }

  // -------------------------------------------------------
  // Reporting
  // -------------------------------------------------------

  @Get('reporting/default-assignment-date')
  @Roles('admin', 'manager', 'viewer')
  getDefaultReportingAssignmentDate(
    @Param('projectId') projectId: string,
  ) {
    return this.assignmentService.getDefaultReportingAssignmentDate(projectId);
  }

  @Get('reporting/today-assigned')
  @Roles('admin', 'manager', 'viewer')
  getTodayAssignedReporting(@Param('projectId') projectId: string) {
    return this.assignmentService.getTodayAssignedReporting(projectId);
  }

  @Post('reporting/submit')
  @Roles('admin', 'manager')
  submitReporting(
    @Param('projectId') projectId: string,
    @Body() dto: SubmitReportingDto,
  ) {
    return this.assignmentService.submitReporting(projectId, dto);
  }

  @Post('reporting/bulk-submit-assigned')
  @Roles('admin', 'manager')
  @ApiOperation({
    summary:
      'Bulk report selected assigned rows directly into backend without painter/hour input',
  })
  bulkSubmitAssignedReporting(
    @Param('projectId') projectId: string,
    @Body() dto: BulkSubmitAssignedReportingDto,
  ) {
    return this.assignmentService.bulkSubmitAssignedReporting(projectId, dto);
  }

  @Get('capacity')
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'assignmentDate', required: true, example: '2026-07-22' })
  getCapacity(
    @Param('projectId') projectId: string,
    @Query('assignmentDate') assignmentDate: string,
  ) {
    return this.assignmentService.getCapacity(projectId, assignmentDate);
  }

  @Get('views/planned-vs-done')
  @Roles('admin', 'manager', 'viewer')
  getPlannedVsDone(@Param('projectId') projectId: string) {
    return this.assignmentService.getPlannedVsDone(projectId);
  }

  @Get('change-log')
  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'runId', required: false })
  getChangeLog(
    @Param('projectId') projectId: string,
    @Query('runId') runId?: string,
  ) {
    return this.assignmentService.getChangeLog(projectId, runId);
  }

  @Post('demand/:demandId/add-full')
  @Roles('admin', 'manager')
  addFullDemandToRecommendation(
    @Param('projectId') projectId: string,
    @Param('demandId') demandId: string,
    @Body() dto: AddDemandToRecommendationDto,
  ) {
    return this.assignmentService.addDemandToRecommendation(
      projectId,
      demandId,
      dto,
      false,
    );
  }

  @Post('demand/:demandId/add-partial')
  @Roles('admin', 'manager')
  addPartialDemandToRecommendation(
    @Param('projectId') projectId: string,
    @Param('demandId') demandId: string,
    @Body() dto: AddDemandToRecommendationDto,
  ) {
    return this.assignmentService.addDemandToRecommendation(
      projectId,
      demandId,
      dto,
      true,
    );
  }

  @Post('recommendations/:recommendationId/remove')
  @Roles('admin', 'manager')
  removeRecommendation(
    @Param('projectId') projectId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() dto: RemoveRecommendationDto,
  ) {
    return this.assignmentService.removeRecommendation(
      projectId,
      recommendationId,
      dto,
    );
  }

  @Post('recommendations/:recommendationId/restore')
  @Roles('admin', 'manager')
  restoreRecommendation(
    @Param('projectId') projectId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() dto: RemoveRecommendationDto,
  ) {
    return this.assignmentService.restoreRecommendation(
      projectId,
      recommendationId,
      dto,
    );
  }

  @Patch('recommendations/:recommendationId/painters')
  @Roles('admin', 'manager')
  updateRecommendationPainters(
    @Param('projectId') projectId: string,
    @Param('recommendationId') recommendationId: string,
    @Body() dto: UpdateRecommendationPaintersDto,
  ) {
    return this.assignmentService.updateRecommendationPainters(
      projectId,
      recommendationId,
      dto,
    );
  }
  @Get('reporting/reported')
@Roles('admin', 'manager', 'viewer')
@ApiQuery({ name: 'workDate', required: true, example: '2026-07-22' })
getReportedBackendRows(
  @Param('projectId') projectId: string,
  @Query('workDate') workDate: string,
) {
  return this.assignmentService.getReportedBackendRows(projectId, workDate);
}


  @Patch('reporting/backend/:backendId')
  @Roles('admin', 'manager')
  updateReportedBackendRow(
    @Param('projectId') projectId: string,
    @Param('backendId') backendId: string,
    @Body() dto: UpdateReportedBackendRowDto,
  ) {
    return this.assignmentService.updateReportedBackendRow(
      projectId,
      backendId,
      dto,
    );
  }

@Get('reporting/assigned')
@Roles('admin', 'manager', 'viewer')
@ApiQuery({ name: 'assignmentDate', required: true, example: '2026-07-22' })
getAssignedRowsByDate(
  @Param('projectId') projectId: string,
  @Query('assignmentDate') assignmentDate: string,
) {
  return this.assignmentService.getAssignedRowsByDate(projectId, assignmentDate);
}
@Get('layer-progress')
@Roles('admin', 'manager', 'viewer')
getLayerProgressTree(@Param('projectId') projectId: string) {
  return this.assignmentService.getLayerProgressTree(projectId);
}

@Get('layer-progress/details')
@Roles('admin', 'manager', 'viewer')
@ApiQuery({ name: 'application', required: true })
@ApiQuery({ name: 'flat', required: true })
@ApiQuery({ name: 'layerId', required: true })
@ApiQuery({ name: 'layerName', required: true })
getLayerProgressDetails(
  @Param('projectId') projectId: string,
  @Query('application') application: string,
  @Query('flat') flat: string,
  @Query('layerId') layerId: string,
  @Query('layerName') layerName: string,
) {
  return this.assignmentService.getLayerProgressDetails(projectId, {
    application,
    flat,
    layerId,
    layerName,
  });
}

@Get('reporting/pending-assigned')
@Roles('admin', 'manager', 'viewer')
@ApiQuery({ name: 'assignmentDate', required: true, example: '2026-07-24' })
getPendingAssignedRowsByDate(
  @Param('projectId') projectId: string,
  @Query('assignmentDate') assignmentDate: string,
) {
  return this.assignmentService.getPendingAssignedRowsByDate(
    projectId,
    assignmentDate,
  );
}


}
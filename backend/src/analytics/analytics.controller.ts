import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Analytics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Roles('admin', 'manager', 'viewer')
  @Get('options')
  getOptions(@Param('projectId') projectId: string) {
    return this.analyticsService.getOptions(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('executive-summary')
  getExecutiveSummary(
    @Param('projectId') projectId: string,
    @Query('section') section?: string,
    @Query('filters') filtersJson?: string,
    @Query('application') application?: string,
    @Query('block') block?: string,
    @Query('flat') flat?: string,
    @Query('workLayer') workLayer?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('profitability') profitability?: string,
    @Query('billing') billing?: string,
    @Query('search') search?: string,
  ) {
    let atomicFilters: Record<string, unknown> = {};

    if (filtersJson) {
      try {
        const parsed = JSON.parse(filtersJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          atomicFilters = parsed as Record<string, unknown>;
        }
      } catch {
        // Fall back to the original individual query parameters below.
      }
    }

    const asText = (value: unknown, fallback?: string) =>
      typeof value === 'string' ? value : fallback;

    return this.analyticsService.getExecutiveSummary(
      projectId,
      {
        application: asText(atomicFilters.application, application),
        block: asText(atomicFilters.block, block),
        flat: asText(atomicFilters.flat, flat),
        workLayer: asText(atomicFilters.workLayer, workLayer),
        from: asText(atomicFilters.from, from),
        to: asText(atomicFilters.to, to),
        profitability: asText(atomicFilters.profitability, profitability),
        billing: asText(atomicFilters.billing, billing),
        search: asText(atomicFilters.search, search),
      },
      section || 'all',
    );
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('report')
  getReport(
    @Param('projectId') projectId: string,
    @Query('filters') filtersJson?: string,
    @Query('application') application?: string,
    @Query('block') block?: string,
    @Query('flat') flat?: string,
    @Query('workLayer') workLayer?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('profitability') profitability?: string,
    @Query('billing') billing?: string,
    @Query('search') search?: string,
  ) {
    let atomicFilters: Record<string, unknown> = {};

    if (filtersJson) {
      try {
        const parsed = JSON.parse(filtersJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          atomicFilters = parsed as Record<string, unknown>;
        }
      } catch {
        // Fall back to the original individual query parameters below.
      }
    }

    const asText = (value: unknown, fallback?: string) =>
      typeof value === 'string' ? value : fallback;

    return this.analyticsService.getReport(projectId, {
      application: asText(atomicFilters.application, application),
      block: asText(atomicFilters.block, block),
      flat: asText(atomicFilters.flat, flat),
      workLayer: asText(atomicFilters.workLayer, workLayer),
      from: asText(atomicFilters.from, from),
      to: asText(atomicFilters.to, to),
      profitability: asText(atomicFilters.profitability, profitability),
      billing: asText(atomicFilters.billing, billing),
      search: asText(atomicFilters.search, search),
    });
  }

  @Roles('admin', 'manager')
  @Post('refresh')
  refresh(@Param('projectId') projectId: string) {
    return this.analyticsService.refresh(projectId);
  }
}
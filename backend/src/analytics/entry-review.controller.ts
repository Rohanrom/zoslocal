import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateEntryReviewDto } from './dto/update-entry-review.dto';
import { EntryReviewService } from './entry-review.service';

type AuthenticatedRequest = Request & {
  user?: {
    sub?: string;
    username?: string;
    role?: string;
    projectId?: string | null;
  };
};

function parseObject(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

@ApiTags('Analytics Entry Review')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('projects/:projectId/analytics/entry-review')
export class EntryReviewController {
  constructor(private readonly entryReviewService: EntryReviewService) {}

  @Get()
  getEntryReview(
    @Param('projectId') projectId: string,
    @Query('filters') filtersJson?: string,
    @Query('reviewFilters') reviewFiltersJson?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.entryReviewService.getEntryReview(projectId, {
      filters: parseObject(filtersJson),
      reviewFilters: parseObject(reviewFiltersJson),
      limit: Number(limit || 400),
      offset: Number(offset || 0),
    });
  }

  @Patch(':backendId')
  updateEntryReview(
    @Param('projectId') projectId: string,
    @Param('backendId') backendId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateEntryReviewDto,
  ) {
    return this.entryReviewService.updateEntryReview(
      projectId,
      backendId,
      request.user?.username || request.user?.sub || 'admin',
      dto || {},
    );
  }

  @Delete(':backendId')
  clearEntryReview(
    @Param('projectId') projectId: string,
    @Param('backendId') backendId: string,
  ) {
    return this.entryReviewService.clearEntryReview(projectId, backendId);
  }
}

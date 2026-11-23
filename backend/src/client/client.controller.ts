import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientService } from './client.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SubmitWorkApprovalDto } from './dto/submit-work-approval.dto';

@ApiTags('Client Workspace')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('client')
@Controller('client')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Get('overview')
  getOverview(@Req() request: any) {
    const projectId = this.getClientProjectId(request);
    return this.clientService.getOverview(projectId);
  }

  @Get('boq')
  getBoq(@Req() request: any) {
    const projectId = this.getClientProjectId(request);
    return this.clientService.getBoq(projectId);
  }

  @Get('work-approval')
  getWorkApproval(@Req() request: any) {
    const projectId = this.getClientProjectId(request);
    return this.clientService.getWorkApproval(projectId);
  }

  @Post('work-approval')
  submitWorkApproval(
    @Req() request: any,
    @Body() dto: SubmitWorkApprovalDto,
  ) {
    const projectId = this.getClientProjectId(request);
    const userId = String(request?.user?.sub || '').trim();
    const username = String(request?.user?.username || '').trim();

    return this.clientService.submitWorkApproval(
      projectId,
      userId,
      username,
      dto?.approvals || [],
    );
  }

  private getClientProjectId(request: any): string {
    const projectId = String(request?.user?.projectId || '').trim();

    if (!projectId) {
      throw new ForbiddenException(
        'This client account is not assigned to a project',
      );
    }

    return projectId;
  }
}
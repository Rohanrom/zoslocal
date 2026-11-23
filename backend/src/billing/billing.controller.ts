import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  MarkBilledDto,
  RejectBillingDto,
  UpsertFlatAreaDto,
} from './dto/billing-action.dto';

@ApiTags('Billing')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Roles('admin', 'manager', 'viewer')
  @Get('readiness')
  getBillingReadiness(@Param('projectId') projectId: string) {
    return this.billingService.getBillingReadiness(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('overall')
  getOverallBilling(@Param('projectId') projectId: string) {
    return this.billingService.getOverallBilling(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('pending')
  getPendingBilling(@Param('projectId') projectId: string) {
    return this.billingService.getPendingBilling(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('sent-for-approval')
  getSentForApproval(@Param('projectId') projectId: string) {
    return this.billingService.getSentForApproval(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('already-billed')
  getAlreadyBilled(@Param('projectId') projectId: string) {
    return this.billingService.getAlreadyBilled(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('latest')
  getLatestBilling(@Param('projectId') projectId: string) {
    return this.billingService.getLatestBilling(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('batch-data')
  getBillingBatchData(@Param('projectId') projectId: string) {
    return this.billingService.getBillingBatchData(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('batch-view')
  getBillingBatchView(@Param('projectId') projectId: string) {
    return this.billingService.getBillingBatchView(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({
    name: 'batchNo',
    required: true,
    example: 5,
    description: 'Selected billing batch number. Example: 5 means B5.',
  })
  @Get('invoice')
  getInvoiceTable(
    @Param('projectId') projectId: string,
    @Query('batchNo') batchNo: string,
  ) {
    return this.billingService.getInvoiceTable(projectId, batchNo);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('flat-area')
  getFlatArea(@Param('projectId') projectId: string) {
    return this.billingService.getFlatArea(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('floor-layer/layers')
  getFloorLayerList(@Param('projectId') projectId: string) {
    return this.billingService.getFloorLayerList(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'layerName', required: false, example: '1st Coat Paint' })
  @ApiQuery({ name: 'floorNo', required: false, example: 4 })
  @ApiQuery({ name: 'rowType', required: false, example: 'FLAT' })
  @ApiQuery({ name: 'latestOnly', required: false, example: false })
  @Get('floor-layer/detail')
  getFloorLayerDetail(
    @Param('projectId') projectId: string,
    @Query('layerName') layerName?: string,
    @Query('floorNo') floorNo?: string,
    @Query('rowType') rowType?: string,
    @Query('latestOnly') latestOnly?: string,
  ) {
    return this.billingService.getFloorLayerDetail(projectId, {
      layerName,
      floorNo,
      rowType,
      latestOnly,
    });
  }

  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'layerName', required: false, example: '1st Coat Paint' })
  @ApiQuery({ name: 'floorNo', required: false, example: 4 })
  @ApiQuery({ name: 'rowType', required: false, example: 'CORRIDOR' })
  @Get('floor-layer/totals')
  getFloorLayerTotals(
    @Param('projectId') projectId: string,
    @Query('layerName') layerName?: string,
    @Query('floorNo') floorNo?: string,
    @Query('rowType') rowType?: string,
  ) {
    return this.billingService.getFloorLayerTotals(projectId, {
      layerName,
      floorNo,
      rowType,
    });
  }

  @Roles('admin', 'manager', 'viewer')
  @Get('floor-layer/latest')
  getFloorLayerLatest(@Param('projectId') projectId: string) {
    return this.billingService.getFloorLayerLatest(projectId);
  }

  @Roles('admin', 'manager', 'viewer')
  @ApiQuery({ name: 'layerName', required: false, example: '1st Coat Paint' })
  @Get('floor-layer/report')
  getFloorLayerReport(
    @Param('projectId') projectId: string,
    @Query('layerName') layerName?: string,
  ) {
    return this.billingService.getFloorLayerReport(projectId, layerName);
  }

  @Roles('admin', 'manager')
  @Patch(':id/send-for-approval')
  sendForApproval(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.billingService.sendForApproval(projectId, id);
  }

  @Roles('admin', 'manager')
  @Patch(':id/approve')
  approveBilling(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ) {
    return this.billingService.approveBilling(projectId, id);
  }

  @Roles('admin', 'manager')
  @Patch(':id/reject')
  rejectBilling(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() dto: RejectBillingDto,
  ) {
    return this.billingService.rejectBilling(projectId, id, dto);
  }

  @Roles('admin', 'manager')
  @Patch(':id/mark-billed')
  markAsBilled(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() dto: MarkBilledDto,
  ) {
    return this.billingService.markAsBilled(projectId, id, dto);
  }

  @Roles('admin', 'manager')
  @Post('refresh-batch-data')
  refreshBillingBatchData(@Param('projectId') projectId: string) {
    return this.billingService.refreshBillingBatchData(projectId);
  }

  @Roles('admin', 'manager')
  @Patch('flat-area/:flat')
  upsertFlatArea(
    @Param('projectId') projectId: string,
    @Param('flat') flat: string,
    @Body() dto: UpsertFlatAreaDto,
  ) {
    return this.billingService.upsertFlatArea(projectId, flat, dto);
  }
}
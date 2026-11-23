import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PreContractBoqService } from './pre-contract-boq.service';

@ApiTags('Pre-Contract BOQ')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pre-contract-boq')
export class PreContractBoqController {
  constructor(private readonly service: PreContractBoqService) {}

  @Get('projects')
  @Roles('admin','viewer')
  list() {return this.service.list();}

  @Post('projects')
  @Roles('admin')
  create(@Body() body:Record<string,unknown>, @Req() request:{user?:{username?:string}}) {
    return this.service.create(body,request.user?.username);
  }

  @Get('materials')
  @Roles('admin','viewer')
  materials() {return this.service.materials();}

  @Get('projects/:projectId')
  @Roles('admin','viewer')
  get(@Param('projectId') id:string) {return this.service.get(id);}

  @Delete('projects/:projectId')
  @Roles('admin')
  remove(@Param('projectId') id:string) {return this.service.delete(id);}

  @Post('projects/:projectId/import')
  @Roles('admin')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024}}))
  importCsv(@Param('projectId') id:string,@UploadedFile() file?:{buffer:Buffer;originalname:string}) {
    return this.service.importCsv(id,file);
  }

  @Patch('projects/:projectId/materials/bulk')
  @Roles('admin')
  bulkMaterials(@Param('projectId') id:string,@Body() body:Record<string,unknown>) {
    return this.service.bulkAssignMaterial(id,body);
  }

  // Apply explicit row-wise BOQ Analysis edits in a single project-scoped transaction.
  // Existing percentage scenario endpoint remains unchanged for compatibility.
  @Patch('projects/:projectId/analysis/layers')
  @Roles('admin')
  applyLayerAnalysis(@Param('projectId') id:string,@Body() body:Record<string,unknown>) {
    return this.service.applyLayerAnalysis(id,body);
  }

  @Post('projects/:projectId/scenario/apply')
  @Roles('admin')
  applyScenario(@Param('projectId') id:string,@Body() body:Record<string,unknown>) {
    return this.service.applyScenario(id,body);
  }

  @Post('projects/:projectId/layers')
  @Roles('admin')
  addLayer(@Param('projectId') id:string,@Body() body:Record<string,unknown>) {
    return this.service.addLayer(id,body);
  }

  @Patch('projects/:projectId/layers/:layerId')
  @Roles('admin')
  editLayer(@Param('projectId') id:string,@Param('layerId') layerId:string,@Body() body:Record<string,unknown>) {
    return this.service.updateLayer(id,layerId,body);
  }

  @Delete('projects/:projectId/layers/:layerId')
  @Roles('admin')
  deleteLayer(@Param('projectId') id:string,@Param('layerId') layerId:string) {
    return this.service.deleteLayer(id,layerId);
  }

  @Patch('projects/:projectId/layers/:layerId/pricing')
  @Roles('admin')
  priceLayer(@Param('projectId') id:string,@Param('layerId') layerId:string,@Body() body:{field:string;value:number}) {
    return this.service.setLayerPricing(id,layerId,body.field,body.value);
  }

  @Patch('projects/:projectId/applications/:application/consumables')
  @Roles('admin')
  updateConsumables(@Param('projectId') id:string,@Param('application') application:string,@Body() body:{cost:number}) {
    return this.service.consumables(id,application,body.cost);
  }

  @Patch('projects/:projectId/applications/:application/pricing')
  @Roles('admin')
  priceApplication(@Param('projectId') id:string,@Param('application') application:string,@Body() body:{field:string;value:number}) {
    return this.service.setApplicationPricing(id,application,body.field,body.value);
  }
}
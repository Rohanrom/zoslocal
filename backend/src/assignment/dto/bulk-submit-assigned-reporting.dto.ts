import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class BulkSubmitAssignedReportingItemDto {
  @ApiProperty({
    example: '8b2a3a51-62df-4b2c-b6c4-3c4fdc04d911',
    description: 'Final assignment row being reported.',
  })
  @IsUUID()
  assignmentId: string;

  @ApiPropertyOptional({ example: 'Block-A' })
  @IsOptional()
  @IsString()
  block?: string;

  @ApiProperty({ example: 'FLAT-A' })
  @IsString()
  application: string;

  @ApiProperty({ example: 'FA-0418' })
  @IsString()
  flat: string;

  @ApiProperty({ example: 'AF-0418-1' })
  @IsString()
  layerId: string;

  @ApiProperty({ example: '1st Coat Paint' })
  @IsString()
  layerName: string;

  @ApiPropertyOptional({
    example: ['WL-1', 'WL-2'],
    description:
      'Assigned/pending wall names. Empty for hour-based/helper work.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wallNames?: string[];

  @ApiPropertyOptional({ example: 'Manual' })
  @IsOptional()
  @IsString()
  machineOrManual?: string;

  @ApiPropertyOptional({
    example: ['Ajith(ZOB000696)', 'Kumar(ZOB000721)'],
    description:
      'Painter display values to store against this reported backend row. Bulk reporting sends these directly without extra database lookups.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  painterNames?: string[];

  @ApiPropertyOptional({
    example: 4,
    description:
      'Per-painter working hours for this reported row. For grouped reporting the frontend distributes the group hours proportionally before bulk submit.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  workingHours?: number;

  @ApiPropertyOptional({
    example: 124.5,
    description:
      'Pending area already shown in Assigned Work. Used only to avoid recalculating area during bulk assigned reporting.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pendingArea?: number;

  @ApiPropertyOptional({ example: '2026-08-13' })
  @IsOptional()
  @IsDateString()
  workDate?: string;

  @ApiPropertyOptional({
    example: 'Asian Paints Trucare Wall Putty Suprema 40KG',
  })
  @IsOptional()
  @IsString()
  materialName?: string | null;

  @ApiPropertyOptional({ example: 5.25 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  materialUsedLKg?: number;

  @ApiPropertyOptional({ example: 'Bulk assigned reporting' })
  @IsOptional()
  @IsString()
  remark?: string | null;
}

export class BulkSubmitAssignedReportingDto {
  @ApiProperty({ type: [BulkSubmitAssignedReportingItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkSubmitAssignedReportingItemDto)
  items: BulkSubmitAssignedReportingItemDto[];

  @ApiPropertyOptional({ example: 'admin' })
  @IsOptional()
  @IsString()
  changedBy?: string;
}
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class SubmitReportingDto {
  @ApiProperty({ example: 'Block-A' })
  @IsString()
  block: string;

  @ApiProperty({ example: 'FLAT-A' })
  @IsString()
  application: string;

  @ApiProperty({ example: 'FA-0418' })
  @IsString()
  flat: string;

  @ApiProperty({ example: 'AF-0418-1' })
  @IsString()
  layerId: string;

  @ApiPropertyOptional({
    example: ['WL-1', 'WL-2'],
    description:
      'Selected wall names from surface_number. Empty array is allowed for hour-based layers like Cleaning/Helping.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wallNames?: string[];

  @ApiPropertyOptional({
    example: ['Ramesh', 'Suresh'],
    description:
      'Optional for reporting. Painter/helper selection belongs to assignment generation.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  painterNames?: string[];

  @ApiProperty({
    example: 'Manual',
    enum: ['Machine', 'Manual', 'Both'],
  })
  @IsString()
  machineOrManual: string;

  @ApiPropertyOptional({
    example: 3,
    description:
      'Optional. Area-based reporting stores 0 hours; assigned hour-based bulk reporting reuses the hours already assigned.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  workingHours?: number;

  @ApiPropertyOptional({
    example: '2026-07-22',
  })
  @IsOptional()
  @IsDateString()
  workDate?: string;

  @ApiPropertyOptional({
    example: '8b2a3a51-62df-4b2c-b6c4-3c4fdc04d911',
    description:
      'Final assignment ID. Send this when reporting assigned work. Keep null/empty for unassigned reporting.',
  })
  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @ApiPropertyOptional({
    example: 'Asian Paints Trucare Wall Putty Suprema 40KG',
    description:
      'Auto-filled from material master based on project + application + layer. Stored in backend.material_name.',
  })
  @IsOptional()
  @IsString()
  materialName?: string | null;

  @ApiPropertyOptional({
    example: 50,
    description:
      'Suggested material quantity from selected area / coverage. User can edit before submit. Stored in backend.material_used_l_kg.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  materialUsedLKg?: number;

  @ApiPropertyOptional({ example: 'Reported from assignment module' })
  @IsOptional()
  @IsString()
  remark?: string;
}
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateReportedBackendRowDto {
  @ApiPropertyOptional({
    example: ['CB1-1', 'CB2-1'],
    description:
      'Selected walls. Empty array is allowed only for hour-based layers.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wallNames?: string[];

  @ApiPropertyOptional({
    example: ['Abul Sekh(ZOB000020)'],
    description: 'Optional. Reporting no longer requires painter selection.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  painterNames?: string[];

  @ApiPropertyOptional({
    example: 'Machine',
  })
  @IsString()
  machineOrManual: string;

  @ApiPropertyOptional({
    example: 0.09,
    description: 'Optional. Existing reported hours are preserved when omitted.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  workingHours?: number;

  @ApiPropertyOptional({
    example: 'Asian Paints Trucare Wall Putty Suprema 40KG',
  })
  @IsOptional()
  @IsString()
  materialName?: string | null;

  @ApiPropertyOptional({
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  materialUsedLKg?: number;

  @ApiPropertyOptional({
    example: 'Edited reported row',
  })
  @IsOptional()
  @IsString()
  remark?: string | null;

  @ApiPropertyOptional({
    example: 'admin',
  })
  @IsOptional()
  @IsString()
  changedBy?: string;
}
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class RecommendationModeOverrideDto {
  @ApiPropertyOptional({ example: 'Balcony-J Ceiling' })
  @IsString()
  application: string;

  @ApiPropertyOptional({ example: '1st Coat Primer' })
  @IsString()
  layerName: string;

  @ApiPropertyOptional({
    example: 'Machine',
    enum: ['Machine', 'Manual', 'Both'],
  })
  @IsIn(['Machine', 'Manual', 'Both'])
  machineOrManual: 'Machine' | 'Manual' | 'Both';
}


export class RecommendationFloorRestrictionDto {
  @ApiPropertyOptional({ example: 'Block-J' })
  @IsString()
  block: string;

  @ApiPropertyOptional({
    example: [3, 4, 5, 6, 7, 8],
    type: [Number],
    description:
      'Zero-based floor numbers blocked for this block. Ground floor is 0.',
  })
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(99, { each: true })
  blockedFloors: number[];
}

export class GenerateRecommendationsDto {
  @ApiPropertyOptional({
    example: true,
    default: true,
    description:
      'When false, rollover demand remains visible but is excluded from auto recommendation for this generation.',
  })
  @IsOptional()
  @IsBoolean()
  includeRollover?: boolean;

  @ApiPropertyOptional({ type: [RecommendationModeOverrideDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecommendationModeOverrideDto)
  modeOverrides?: RecommendationModeOverrideDto[];

  @ApiPropertyOptional({ type: [RecommendationFloorRestrictionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecommendationFloorRestrictionDto)
  floorRestrictions?: RecommendationFloorRestrictionDto[];
}
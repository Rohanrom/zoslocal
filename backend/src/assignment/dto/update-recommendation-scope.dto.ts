import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RecommendationApplicationScopeItemDto {
  @ApiPropertyOptional({ example: 'BALCONY-A' })
  @IsString()
  application: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  is_allowed: boolean;
}

export class RecommendationLayerScopeItemDto {
  @ApiPropertyOptional({ example: 'BALCONY-A' })
  @IsString()
  application: string;

  @ApiPropertyOptional({ example: '2nd Coat Paint' })
  @IsString()
  layer_name: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  is_allowed: boolean;
}

export class UpdateRecommendationScopeDto {
  @ApiPropertyOptional({
    type: [RecommendationApplicationScopeItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecommendationApplicationScopeItemDto)
  applications?: RecommendationApplicationScopeItemDto[];

  @ApiPropertyOptional({
    type: [RecommendationLayerScopeItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecommendationLayerScopeItemDto)
  layers?: RecommendationLayerScopeItemDto[];
}
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RemoveRecommendationDto {
  @ApiPropertyOptional({ example: 'shreyansh' })
  @IsOptional()
  @IsString()
  changedBy?: string;

  @ApiPropertyOptional({
    example: 'Material not available, shifting to tomorrow',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
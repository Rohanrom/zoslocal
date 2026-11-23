import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateRecommendationPaintersDto {
  @ApiProperty({
    example: ['Ramesh', 'Suresh'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  painterNames: string[];

  @ApiPropertyOptional({
    example: ['P001', 'P002'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  painterIds?: string[];

  @ApiPropertyOptional({ example: 'shreyansh' })
  @IsOptional()
  @IsString()
  changedBy?: string;

  @ApiPropertyOptional({
    example: 'Supervisor requested painter change',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
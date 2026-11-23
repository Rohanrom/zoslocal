import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class AddDemandToRecommendationDto {
  @ApiProperty({
    example: '8b2a3a51-62df-4b2c-b6c4-3c4fdc04d911',
  })
  @IsUUID()
  runId: string;

  @ApiPropertyOptional({
    example: 450,
    description:
      'Use only for partial add. If empty, backend adds full remaining demand area.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  assignedArea?: number;

  @ApiPropertyOptional({ example: 'shreyansh' })
  @IsOptional()
  @IsString()
  changedBy?: string;

  @ApiPropertyOptional({
    example: 'Manual add from Ongoing section',
  })
  @IsOptional()
  @IsString()
  reason?: string;
 
 @ApiPropertyOptional({
  example: ['CK-1', 'CL-1'],
  description: 'Used for partial assignment by selected walls.',
})
@IsOptional()
@IsArray()
@IsString({ each: true })
wallNames?: string[];
}
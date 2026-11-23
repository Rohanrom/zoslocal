import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class FinalizeAssignmentRunDto {
  @ApiPropertyOptional({ example: 'shreyansh' })
  @IsOptional()
  @IsString()
  finalizedBy?: string;

  @ApiPropertyOptional({
    example: 'Extra painters arranged from another site',
    description: 'Required if selected assignment exceeds available capacity.',
  })
  @IsOptional()
  @IsString()
  overrideReason?: string;
}
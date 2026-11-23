import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateAssignmentRunDto {
  @ApiProperty({
    example: '2026-07-22',
    description: 'Date for which assignment is being generated',
  })
  @IsDateString()
  assignmentDate: string;

  @ApiPropertyOptional({
    example: 'shreyansh',
    description: 'User who generated the assignment run',
  })
  @IsOptional()
  @IsString()
  generatedBy?: string;
}
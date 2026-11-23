import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateWorkModeDto {
  @ApiProperty({
    example: 'Machine',
    enum: ['Machine', 'Manual', 'Both'],
  })
  @IsIn(['Machine', 'Manual', 'Both'])
  machineOrManual: 'Machine' | 'Manual' | 'Both';
}
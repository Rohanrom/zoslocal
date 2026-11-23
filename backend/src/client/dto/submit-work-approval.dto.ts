import { ApiProperty } from '@nestjs/swagger';

export class WorkApprovalItemDto {
  @ApiProperty({ example: 'Block-G' })
  block!: string;

  @ApiProperty({ example: 'Flat-G' })
  application!: string;

  @ApiProperty({ example: 'FG-0601' })
  flat!: string;

  @ApiProperty({ example: 'flat', enum: ['flat', 'floor'] })
  source!: 'flat' | 'floor';
}

export class SubmitWorkApprovalDto {
  @ApiProperty({ type: [WorkApprovalItemDto] })
  approvals!: WorkApprovalItemDto[];
}
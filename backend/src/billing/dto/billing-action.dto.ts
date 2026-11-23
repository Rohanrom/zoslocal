import { ApiPropertyOptional } from '@nestjs/swagger';

export class RejectBillingDto {
  @ApiPropertyOptional({
    example: 'Wrong area entered',
  })
  remarks?: string;
}

export class MarkBilledDto {
  @ApiPropertyOptional({
    example: 4,
    description: 'Billing batch number. If empty, backend will use next batch.',
  })
  batchNo?: number;

  @ApiPropertyOptional({
    example: '2026-06-03',
    description: 'Billing date. If empty, today will be used.',
  })
  billingDate?: string;
}

export class UpsertFlatAreaDto {
  @ApiPropertyOptional({
    example: 203.5,
  })
  ceilingArea?: number;

  @ApiPropertyOptional({
    example: 812.25,
  })
  wallArea?: number;
}
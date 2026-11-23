import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEntryReviewDto {
  @ApiPropertyOptional({
    enum: ['open', 'approved', 'rejected'],
    example: 'approved',
    description:
      'Review decision. Comment is independent, so an approved/rejected entry can still carry a comment.',
  })
  status?: 'open' | 'approved' | 'rejected';

  @ApiPropertyOptional({
    example: 'Area checked with site PM.',
    nullable: true,
    description:
      'Review comment. Send an empty string or null to remove the existing comment.',
  })
  comment?: string | null;
}

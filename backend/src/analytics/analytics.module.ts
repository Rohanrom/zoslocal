import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsController } from './analytics.controller';
import { EntryReviewController } from './entry-review.controller';
import { AnalyticsService } from './analytics.service';
import { EntryReviewService } from './entry-review.service';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController, EntryReviewController],
  providers: [AnalyticsService, EntryReviewService],
})
export class AnalyticsModule {}

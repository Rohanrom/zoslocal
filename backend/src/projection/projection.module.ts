import { Module } from '@nestjs/common';
import { ProjectionController } from './projection.controller';
import { ProjectionService } from './projection.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectionController],
  providers: [ProjectionService],
})
export class ProjectionModule {}
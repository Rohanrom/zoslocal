import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { BoqController } from './boq.controller';
import { BoqService } from './boq.service';

@Module({
  imports: [PrismaModule],
  controllers: [BoqController],
  providers: [BoqService],
})
export class BoqModule {}
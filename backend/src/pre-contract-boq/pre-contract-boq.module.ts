import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PreContractBoqController } from './pre-contract-boq.controller';
import { PreContractBoqService } from './pre-contract-boq.service';

@Module({
  imports: [PrismaModule],
  controllers: [PreContractBoqController],
  providers: [PreContractBoqService],
})
export class PreContractBoqModule {}

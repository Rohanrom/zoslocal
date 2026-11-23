import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OemController } from './oem.controller';
import { OemService } from './oem.service';

@Module({
  imports: [PrismaModule],
  controllers: [OemController],
  providers: [OemService],
})
export class OemModule {}
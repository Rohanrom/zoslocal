import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectSetupController } from './project-setup.controller';
import { ProjectSetupService } from './project-setup.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectSetupController],
  providers: [ProjectSetupService],
})
export class ProjectSetupModule {}

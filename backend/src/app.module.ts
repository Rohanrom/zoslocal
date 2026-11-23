
import { Module } from '@nestjs/common';

import { AnalyticsModule } from './analytics/analytics.module';
import { ProjectionModule } from './projection/projection.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { HealthModule } from './health/health.module';
import { AssignmentModule } from './assignment/assignment.module';
import { BoqModule } from './boq/boq.module';
import { ClientModule } from './client/client.module';
import { UsersModule } from './users/users.module';
import { ProjectSetupModule } from './project-setup/project-setup.module';
import { ProjectsModule } from './projects/projects.module';

// Register the new Pre-Contract BOQ module
import { PreContractBoqModule } from './pre-contract-boq/pre-contract-boq.module';
import { OemModule } from './oem/oem.module';

@Module({
  imports: [
    ProjectionModule,
    AuthModule,
    BillingModule,
    HealthModule,
    AssignmentModule,
    BoqModule,
    AnalyticsModule,
    ClientModule,
    UsersModule,
    ProjectSetupModule,
    ProjectsModule,

    // Enables the Pre-Contract BOQ API endpoints
    PreContractBoqModule,
    OemModule,
  ],
})
export class AppModule {}
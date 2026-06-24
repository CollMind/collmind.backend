import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { FinanceReportingModule } from '../finance-reporting/finance-reporting.module';
import { ApprovalModule } from '../approval/approval.module';
import { Agreement } from '../../../database/entities/agreement.entity';
import { UserScope } from '../../../database/entities/user-scope.entity';
import { Cpl } from '../../../database/entities/cpl.entity';
import { ApprovalRequest } from '../../../database/entities/approval-request.entity';

/**
 * DashboardModule — shared read-only orchestration module.
 *
 * Only imports services from sub-modules; never imports their repositories directly.
 * - FinanceReportingModule: exports FinanceReportingService (budget utilization delegation)
 * - ApprovalModule: exports ApprovalService (available if future delegation needed)
 * - TypeOrmModule.forFeature: Agreement, UserScope, Cpl, ApprovalRequest (for count queries)
 *
 * No entity migrations: this is a read-only aggregation layer.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Agreement, UserScope, Cpl, ApprovalRequest]),
    FinanceReportingModule,
    ApprovalModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}

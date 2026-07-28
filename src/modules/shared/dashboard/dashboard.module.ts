import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { FinanceReportingModule } from '../finance-reporting/finance-reporting.module';
import { ApprovalModule } from '../approval/approval.module';
import { AccessScopeModule } from '../access-scope/access-scope.module';
import { Agreement } from '../../../database/entities/agreement.entity';
import { Cpl } from '../../../database/entities/cpl.entity';
import { ApprovalRequest } from '../../../database/entities/approval-request.entity';

/**
 * DashboardModule — shared read-only orchestration module.
 *
 * Only imports services from sub-modules; never imports their repositories directly.
 * - FinanceReportingModule: exports FinanceReportingService (budget utilization delegation)
 * - ApprovalModule: exports ApprovalService (available if future delegation needed)
 * - AccessScopeModule: exports AccessScopeService (T-028d — CPL scope resolution,
 *   replaces the former local `resolveCplScope`/UserScope query)
 * - TypeOrmModule.forFeature: Agreement, Cpl, ApprovalRequest (for count queries)
 *
 * No entity migrations: this is a read-only aggregation layer.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Agreement, Cpl, ApprovalRequest]),
    FinanceReportingModule,
    ApprovalModule,
    AccessScopeModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}

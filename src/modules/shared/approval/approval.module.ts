import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRequest } from '../../../database/entities/approval-request.entity';
import { ApprovalPolicy } from '../../../database/entities/approval-policy.entity';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { ApprovalRepository } from './approval.repository';
import { ApprovalPolicyService } from './approval-policy.service';
import { ApprovalPolicyController } from './approval-policy.controller';
import { ApprovalPolicyRepository } from './approval-policy.repository';

/**
 * Shared Approval Module
 *
 * Provides approval workflow functionality for both Actuals-First and Planning-First modes.
 *
 * Key Features:
 * - Multi-level approval workflows
 * - Policy-driven approval routing
 * - Approval request management
 * - Self-approval prevention (EA-001)
 * - T-214: `approval_policies` yazma yolu (şablon + eşik tek uçta)
 */
@Module({
  imports: [TypeOrmModule.forFeature([ApprovalRequest, ApprovalPolicy])],
  controllers: [ApprovalController, ApprovalPolicyController],
  providers: [
    ApprovalService,
    ApprovalRepository,
    ApprovalPolicyService,
    ApprovalPolicyRepository,
  ],
  exports: [ApprovalService, ApprovalRepository, ApprovalPolicyService],
})
export class ApprovalModule {}

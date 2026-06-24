import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRequest } from '../../../database/entities/approval-request.entity';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { ApprovalRepository } from './approval.repository';

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
 */
@Module({
  imports: [TypeOrmModule.forFeature([ApprovalRequest])],
  controllers: [ApprovalController],
  providers: [ApprovalService, ApprovalRepository],
  exports: [ApprovalService, ApprovalRepository],
})
export class ApprovalModule {}

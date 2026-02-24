import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetController } from './budget.controller';
import { BudgetAllocationController } from './budget-allocation.controller';
import { BudgetService } from './budget.service';
import { BudgetAllocationService } from './budget-allocation.service';
import { BudgetRepository } from './budget.repository';
import { BudgetEnvelope } from '../../../database/entities/budget-envelope.entity';
import { BudgetTransaction } from '../../../database/entities/budget-transaction.entity';
import { BudgetAllocation } from '../../../database/entities/budget-allocation.entity';
import { BudgetTransactionLog } from '../../../database/entities/budget-transaction-log.entity';
import { BudgetAlertConfiguration } from '../../../database/entities/budget-alert-configuration.entity';
import { Plan } from '../../../database/entities/plan.entity';

/**
 * Shared Budget Module
 * 
 * Provides budget envelope management and budget transaction (event-sourced) operations.
 * Used by both Actuals-First and Planning-First modes.
 * 
 * Key Features:
 * - Budget envelope CRUD
 * - Budget reservation (RESERVE transaction)
 * - Budget release (RELEASE transaction)
 * - Computed reserved/available amounts (via transactions)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BudgetEnvelope,
      BudgetTransaction,
      BudgetAllocation,
      BudgetTransactionLog,
      BudgetAlertConfiguration,
      Plan,
    ]),
  ],
  controllers: [BudgetController, BudgetAllocationController],
  providers: [BudgetService, BudgetAllocationService, BudgetRepository],
  exports: [BudgetService, BudgetAllocationService, BudgetRepository],
})
export class BudgetModule {}


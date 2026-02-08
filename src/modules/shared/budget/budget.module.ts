import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { BudgetRepository } from './budget.repository';
import { BudgetEnvelope } from '../../../database/entities/budget-envelope.entity';
import { BudgetTransaction } from '../../../database/entities/budget-transaction.entity';

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
  imports: [TypeOrmModule.forFeature([BudgetEnvelope, BudgetTransaction])],
  controllers: [BudgetController],
  providers: [BudgetService, BudgetRepository],
  exports: [BudgetService, BudgetRepository],
})
export class BudgetModule {}


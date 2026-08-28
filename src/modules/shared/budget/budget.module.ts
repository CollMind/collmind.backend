import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { BudgetReservationService } from './budget-reservation.service';
import { BudgetThresholdService } from './budget-threshold.service';
import { BudgetPolicyService } from './budget-policy.service';
import { BudgetTierNotificationService } from './budget-tier-notification.service';
import { BudgetRepository } from './budget.repository';
import { BudgetEnvelope } from '../../../database/entities/budget-envelope.entity';
import { BudgetTransaction } from '../../../database/entities/budget-transaction.entity';
import { BudgetAlertConfiguration } from '../../../database/entities/budget-alert-configuration.entity';
import { BudgetPolicy } from '../../../database/entities/budget-policy.entity';
import { Plan } from '../../../database/entities/plan.entity';
import { NotificationModule } from '../../notification/notification.module';
import { UserModule } from '../../user/user.module';
// T-270/Z21/Z24: `BudgetAllocation`/`BudgetTransactionLog` (+ their controller/
// service) REMOVED — `K-2.2.3` ihlali olarak doğan model, zarf modeline
// (`BudgetEnvelope`/`BudgetTransaction`, yukarısı) taşındı ve tüketicisi kalmadı
// (`Z24` migration 1811000000000, `.claude/backlog/tasks/T-265.md`).

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
      BudgetAlertConfiguration,
      BudgetPolicy,
      Plan,
    ]),
    // T-318 (Z57 §3): BudgetTierNotificationService — bildirim yazımı için
    // NotificationModule, FINANCE rolü çözümlemesi için UserModule. Döngüsel
    // bağımlılık YOK: ikisi de BudgetModule'e (doğrudan ya da transitif)
    // bağımlı DEĞİL (ölçüldü — `grep -rl BudgetModule` çıktısında ne
    // NotificationModule ne UserModule/CommonModule/AccessScopeModule var).
    NotificationModule,
    UserModule,
  ],
  controllers: [BudgetController],
  providers: [
    BudgetService,
    BudgetReservationService,
    BudgetThresholdService,
    BudgetPolicyService,
    BudgetTierNotificationService,
    BudgetRepository,
  ],
  exports: [
    BudgetService,
    BudgetReservationService,
    BudgetThresholdService,
    BudgetPolicyService,
    BudgetTierNotificationService,
    BudgetRepository,
  ],
})
export class BudgetModule {}

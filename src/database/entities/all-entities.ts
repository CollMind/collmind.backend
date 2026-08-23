// T-224 / K-2.6.13 (B4) — uygulamanın entity kaynağı için TEK KAYNAK.
// CLI migration (`src/config/typeorm.config.ts`'in `dataSourceOptions.entities`'i)
// VE runtime (`src/database/database.module.ts`) ikisi de buradan okur.
//
// K-2.6.13(B4): bu liste BİLEREK `typeorm.config.ts`'İN DIŞINDA, yan etkisiz
// (side-effect-free) bir dosyada tutulur. `typeorm.config.ts` modül
// seviyesinde, CLI/seed'in `app_migrate` (DDL-yetkili) rol kimliğini
// eksikse AÇIK hata ile durdurmak için bir kimlik-çözümleme çağrısı
// çalıştırır (K-2.6.13d, `migrateDbCredentials()`). Bu dosyayı import eden
// HERKES (yalnız CLI değil) o modülü baştan sona çalıştırır — JS/TS modül
// sistemi "yalnız kullandığım export'u çalıştır" yapmaz, TÜM dosyayı
// değerlendirir. `ALL_ENTITIES` önceden `typeorm.config.ts`'te tanımlıydı
// ve `database.module.ts` (NestJS RUNTIME süreci) onu oradan import
// ediyordu — yani üretim uygulaması, kendi bağlantısında hiç kullanmadığı
// `app_migrate` kimlik bilgilerini yalnızca bu import zinciri yüzünden
// ortamında taşımak ZORUNDAYDI (ölçüldü: K-2.6.13(B4) task raporu —
// ampirik komut + çıktı orada).
//
// Bu dosya entity sınıflarını import etmek dışında HİÇBİR ŞEY yapmaz —
// env okumaz, kimlik doğrulamaz, dotenv çağırmaz. `database.module.ts`
// artık `typeorm.config.ts`'e HİÇ dokunmaz; runtime grafiği CLI'ın
// kimlik-çözümleme yan etkisinden tamamen ayrıştı.
//
// M-3(a) (2026-08-16): önceden bu dosyaya `app_migrate`/
// `migrateDbCredentials` adlarını LİTERAL yazmama talimatı vardı — eski
// guard (`db-role-sessiz-fallback.e2e-spec.ts`) HAM METİN tarıyordu ve
// bir açıklayıcı yorumu koddan ayırt edemiyordu. Guard artık `test/
// helpers/privileged-connection-scan.ts` ile "bu kimlik bir bağlantı
// yapılandırmasına BESLENİYOR mu" soruyor, "bu metin geçiyor mu" değil —
// bu dosya hiçbir bağlantı kurmadığı için (yalnız entity import eder)
// isimleri açıkça yazmak artık güvenli.
import { User } from './user.entity';
import { Tenant } from './tenant.entity';
import { Customer } from './customer.entity';
import { BudgetEnvelope } from './budget-envelope.entity';
import { BudgetTransaction } from './budget-transaction.entity';
import { Notification } from './notification.entity';
import { AdminAuditLog } from './admin-audit-log.entity';
import { Agreement } from './agreement.entity';
import { ApprovalRequest } from './approval-request.entity';
import { LedgerEntry } from './ledger-entry.entity';
import { AgreementTransaction } from './agreement-transaction.entity';
import { OnInvoiceEntry } from './on-invoice-entry.entity';
import { OnInvoiceBatch } from './on-invoice-batch.entity';
import { SalesActual } from './sales-actual.entity';
import { SalesActualBatch } from './sales-actual-batch.entity';
import { BudgetSummaryView } from './budget-summary.view-entity';
import { Brand } from './brand.entity';
import { Category } from './category.entity';
import { Channel } from './channel.entity';
import { Cpl } from './cpl.entity';
import { ForecastingUnit } from './forecasting-unit.entity';
import { GenericUnit } from './generic-unit.entity';
import { Mechanic } from './mechanic.entity';
import { Region } from './region.entity';
import { Sku } from './sku.entity';
import { Tactic } from './tactic.entity';
// B dalgası (T-211)
import { BudgetPolicy } from './budget-policy.entity';
import { ApprovalPolicy } from './approval-policy.entity';
import { Role, UserRoleAssignment } from './role.entity';
import { Claim } from './claim.entity';
import { ClaimMatch } from './claim-match.entity';
import { TacticRealization } from './tactic-realization.entity';
import { FiscalPeriod } from './fiscal-period.entity';
import { Kpi } from './kpi.entity';
import { UserScope } from './user-scope.entity';
import { Plan, PlanFu, PlanSku } from './plan.entity';
import { PlanMechanicValue } from './plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from './mechanic-spend-breakdown.entity';
import { LTAAgreement } from './lta-agreement.entity';
import { LTARate } from './lta-rate.entity';
import { LTAPlanOverride } from './lta-plan-override.entity';
// T-270/Z21/Z24: `BudgetAllocation`/`BudgetTransactionLog` entity'leri KALDIRILDI —
// bkz. `budget.module.ts` başlığındaki not, migration `1811000000000`.
import { BudgetAlertConfiguration } from './budget-alert-configuration.entity';
import { PlanApprovalHistory } from './plan-approval-history.entity';

export const ALL_ENTITIES = [
  // Shared entities
  User,
  Tenant,
  Customer,
  BudgetEnvelope,
  BudgetTransaction,
  Notification,
  AdminAuditLog,
  // View entities
  BudgetSummaryView,
  // Actuals-First entities
  Agreement,
  ApprovalRequest,
  LedgerEntry,
  AgreementTransaction,
  OnInvoiceEntry,
  OnInvoiceBatch,
  SalesActual,
  SalesActualBatch,
  // Master Data entities
  Brand,
  Category,
  Channel,
  Cpl,
  ForecastingUnit,
  GenericUnit,
  Mechanic,
  Region,
  Sku,
  Tactic,
  // KPI and User Scope entities
  Kpi,
  UserScope,
  // Planning-First entities
  Plan,
  PlanFu,
  PlanSku,
  PlanMechanicValue,
  MechanicSpendBreakdown,
  LTAAgreement,
  LTARate,
  LTAPlanOverride,
  BudgetAlertConfiguration,
  PlanApprovalHistory,
  // B dalgası (T-211)
  BudgetPolicy,
  ApprovalPolicy,
  Role,
  UserRoleAssignment,
  Claim,
  ClaimMatch,
  TacticRealization,
  FiscalPeriod,
];

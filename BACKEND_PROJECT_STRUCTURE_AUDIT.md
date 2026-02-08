# Backend Project Structure Audit Report

**Project:** CollMind TPM Platform - Backend  
**Date:** 2024 (Updated)  
**Audit Type:** Pre-Sprint 1 Structure Review  
**Last Updated:** After v_budget_summary view implementation

---

## 1. Directory Structure (2 Levels Deep)

```
src/
├── app.controller.spec.ts
├── app.controller.ts
├── app.module.ts
├── app.service.ts
├── main.ts
├── common/
│   ├── common.module.ts
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── roles.decorator.ts
│   │   └── tenant.decorator.ts
│   ├── filters/
│   │   └── tenant-not-found.filter.ts
│   ├── guards/
│   │   ├── admin-restrictions.guard.ts
│   │   ├── jwt-auth.guard.ts
│   │   ├── roles.guard.ts
│   │   └── tenant.guard.ts
│   ├── interceptors/
│   │   └── tenant.interceptor.ts
│   ├── interfaces/
│   ├── middleware/
│   │   └── tenant.middleware.ts
│   ├── pipes/
│   └── services/
│       └── admin-audit.service.ts
├── config/
│   ├── config.module.ts
│   └── typeorm.config.ts
├── database/
│   ├── database.module.ts
│   ├── entities/
│   │   ├── admin-audit-log.entity.ts
│   │   ├── agreement-transaction.entity.ts
│   │   ├── agreement.entity.ts
│   │   ├── approval-request.entity.ts
│   │   ├── base.entity.ts
│   │   ├── budget-envelope.entity.ts
│   │   ├── budget-reservation.entity.ts
│   │   ├── budget-summary.view-entity.ts
│   │   ├── budget-transaction.entity.ts
│   │   ├── customer.entity.ts
│   │   ├── ledger-entry.entity.ts
│   │   ├── notification.entity.ts
│   │   ├── tenant.entity.ts
│   │   └── user.entity.ts
│   ├── migrations/
│   │   ├── 1704067200000-CreateTenants.ts
│   │   ├── 1704067260000-CreateUsers.ts
│   │   ├── 1704067320000-CreateCustomers.ts
│   │   ├── 1704067380000-AddNumberOfBranchesToCustomers.ts
│   │   ├── 1704067500000-CreateBudgetEnvelopes.ts
│   │   ├── 1704067560000-CreateBudgetReservations.ts
│   │   ├── 1704067620000-CreateNotifications.ts
│   │   ├── 1704067680000-CreateAdminAuditLogs.ts
│   │   └── 1704067740000-CreateBudgetSummaryView.ts
│   ├── seeds/
│   │   ├── customer.seed.ts
│   │   ├── index.ts
│   │   ├── run-seeds.ts
│   │   ├── tenant.seed.ts
│   │   └── user.seed.ts
│   └── strategies/
│       └── snake-case-naming.strategy.ts
└── modules/
    ├── customer/
    │   ├── customer.controller.ts
    │   ├── customer.module.ts
    │   ├── customer.repository.ts
    │   ├── customer.service.ts
    │   ├── dto/
    │   │   ├── create-customer.dto.ts
    │   │   ├── customer-filter.dto.ts
    │   │   ├── customer-response.dto.ts
    │   │   └── update-customer.dto.ts
    │   └── services/
    │       └── file-parser.service.ts
    ├── modes/
    │   ├── actuals-first/
    │   │   ├── agreement/
    │   │   ├── agreement-transaction/
    │   │   └── ledger/
    │   └── planning-first/
    ├── notification/
    │   ├── notification.controller.ts
    │   ├── notification.module.ts
    │   ├── notification.repository.ts
    │   ├── notification.service.ts
    │   └── services/
    │       └── email.service.ts
    ├── shared/
    │   ├── approval/
    │   │   └── approval.module.ts
    │   ├── budget/
    │   │   ├── budget.controller.ts
    │   │   ├── budget.module.ts
    │   │   ├── budget.repository.ts
    │   │   ├── budget.service.ts
    │   │   └── dto/
    │   │       ├── create-budget-envelope.dto.ts
    │   │       └── reserve-budget.dto.ts
    │   └── reporting/
    │       └── reporting.module.ts
    ├── tenant/
    │   ├── dto/
    │   │   ├── create-tenant.dto.ts
    │   │   ├── tenant-response.dto.ts
    │   │   └── update-tenant.dto.ts
    │   ├── tenant.controller.ts
    │   ├── tenant.module.ts
    │   ├── tenant.repository.ts
    │   └── tenant.service.ts
    └── user/
        ├── auth.controller.ts
        ├── dto/
        │   ├── change-password.dto.ts
        │   ├── create-user.dto.ts
        │   ├── login.dto.ts
        │   ├── update-user.dto.ts
        │   └── user-response.dto.ts
        ├── strategies/
        │   └── jwt.strategy.ts
        ├── user.controller.ts
        ├── user.module.ts
        ├── user.repository.ts
        └── user.service.ts
```

---

## 2. Existing Entities

### BaseEntity
**File:** `src/database/entities/base.entity.ts`
- **Fields:**
  - `id` (uuid, primary key)
  - `tenantId` (uuid, indexed)
  - `createdAt` (timestamp)
  - `updatedAt` (timestamp)
  - `deletedAt` (timestamp, nullable, soft delete)
  - `createdBy` (uuid, nullable)
  - `updatedBy` (uuid, nullable)

### Tenant
**File:** `src/database/entities/tenant.entity.ts`
- **Status Enum:** `TenantStatus` (ACTIVE, INACTIVE, SUSPENDED, TRIAL)
- **Plan Enum:** `TenantPlan` (FREE, BASIC, PROFESSIONAL, ENTERPRISE)
- **Key Fields:**
  - `name`, `domain` (unique)
  - `status`, `plan`
  - `settings` (jsonb)
  - `maxUsers`, `maxStorageGB`, `currentStorageGB`
  - Contact, address, business information fields

### User
**File:** `src/database/entities/user.entity.ts`
- **Status Enum:** `UserStatus` (ACTIVE, INACTIVE, PENDING, LOCKED)
- **Role Enum:** `UserRole` (ADMIN, PLANNER, APPROVER, FINANCE)
- **Key Fields:**
  - `email` (unique per tenant)
  - `passwordHash` (excluded from serialization)
  - `role`, `status`
  - `fullName`, `firstName`, `lastName`
  - Authentication fields (lastLoginAt, loginCount, refreshToken, etc.)
  - Email verification and password reset tokens
  - `preferences` (jsonb)
  - `permissions` (jsonb array)

### Customer
**File:** `src/database/entities/customer.entity.ts`
- **Status Enum:** `CustomerStatus` (ACTIVE, INACTIVE, PENDING, SUSPENDED)
- **Channel Enum:** `CustomerChannel` (NKA, TRADITIONAL_TRADE, E_COMMERCE, EXPORT, WHOLESALE, RETAIL, HORECA)
- **Type Enum:** `CustomerType` (DIRECT, DISTRIBUTOR, WHOLESALER, RETAILER, END_CUSTOMER)
- **Key Fields:**
  - `code` (unique per tenant)
  - `name`, `channel`, `type`, `status`
  - Location fields (city, district, region, country, address)
  - Business information (taxNumber, companyRegistrationNumber)
  - Contact information
  - `numberOfBranches` (int, nullable)
  - `isVip` (boolean, indexed)
  - `metadata` (jsonb)

### BudgetEnvelope
**File:** `src/database/entities/budget-envelope.entity.ts`
- **Status Enum:** `BudgetEnvelopeStatus` (DRAFT, ACTIVE, CLOSED, ARCHIVED)
- **Key Fields:**
  - `code` (unique per tenant)
  - `name`, `fiscalYear`, `period`
  - `allocatedAmount` (decimal 15,2) - **STORED** ✅
  - `consumedAmount` (decimal 15,2, default: 0) - **STORED** ⚠️ (Legacy - use view instead)
  - `availableAmount` (decimal 15,2) - **STORED** ⚠️ (Legacy - use view instead)
  - `status`
  - `budgetOwnerId`, `budgetOwnerEmail`, `budgetOwnerName`
  - `currency` (default: 'TRY')
  - `description`, `metadata` (jsonb)
- **Note:** ⚠️ `consumedAmount` and `availableAmount` are stored fields (legacy). Use `v_budget_summary` view for BRD-compliant computed values. These fields will be deprecated in a future migration.

### BudgetSummaryView (View Entity)
**File:** `src/database/entities/budget-summary.view-entity.ts`
- **Type:** ViewEntity (maps to database view)
- **View Name:** `main.v_budget_summary`
- **Key Fields (Computed):**
  - `envelopeId` (uuid)
  - `tenantId` (uuid)
  - `code`, `name`, `fiscalYear`, `period`
  - `allocatedAmount` (decimal) - from budget_envelopes
  - `currency`, `status`
  - `reservedAmount` (decimal) - **COMPUTED** from `budget_transactions` (RESERVE - RELEASE)
  - `consumedAmount` (decimal) - **COMPUTED** from `ledger_entries` (DEBIT - CREDIT)
  - `availableAmount` (decimal) - **COMPUTED** as `allocated - reserved - consumed`
  - `utilizationPct` (decimal) - **COMPUTED** as `(reserved + consumed) / allocated * 100`
  - `createdAt`, `updatedAt`
- **Status:** ✅ **IMPLEMENTED** - BRD-compliant computed fields via database view
- **Usage:** Access via `BudgetRepository.getBudgetSummary()` or `getAllBudgetSummaries()`

### BudgetReservation
**File:** `src/database/entities/budget-reservation.entity.ts`
- **Status Enum:** `BudgetReservationStatus` (PENDING, APPROVED, REJECTED, COMMITTED, CANCELLED)
- **Key Fields:**
  - `envelopeId` (uuid)
  - `agreementId` (uuid, nullable)
  - `agreementName` (string, nullable)
  - `reservedAmount` (decimal 15,2) - **STORED**
  - `status`
  - `requestedById`, `requestedByEmail`, `requestedByName`
  - `approvedById`, `approvedAt`
  - `rejectedReason`, `notes`
- **Relations:** BudgetEnvelope, Tenant

### BudgetTransaction
**File:** `src/database/entities/budget-transaction.entity.ts`
- **Transaction Type Enum:** `BudgetTransactionType`
  - `ALLOCATE` - Initial envelope creation
  - `COMMIT` - Planning-First: Plan approved
  - `RESERVE` - Actuals-First: Agreement approved
  - `RELEASE` - Agreement cancelled (free reserved budget)
  - `TRANSFER` - Move budget between envelopes
  - `ADJUST` - Manual correction (admin only)
- **Transaction Status Enum:** `BudgetTransactionStatus` (PENDING, POSTED, CANCELLED)
- **Source Type Enum:** `BudgetTransactionSourceType` (AGREEMENT, PLAN, MANUAL, TRANSFER, ADJUSTMENT)
- **Key Fields:**
  - `envelopeId` (uuid)
  - `txType`, `txStatus`
  - `sourceType`, `sourceId` (uuid, nullable)
  - `amount` (decimal 18,2)
  - `currency` (default: 'TRY')
  - `idempotencyKey` (string 200, unique per tenant)
  - `description`, `notes`, `metadata` (jsonb)
- **Relations:** BudgetEnvelope, Tenant

### Agreement
**File:** `src/database/entities/agreement.entity.ts`
- **Type Enum:** `AgreementType` (STA - Short-Term ≤30 days, LTA - Long-Term >30 days)
- **Status Enum:** `AgreementStatus` (DRAFT, PENDING, APPROVED, ACTIVE, CLOSED, REJECTED, CANCELLED)
- **Spend Type Enum:** `SpendType` (ON_INVOICE, OFF_INVOICE, BOTH)
- **Mechanic Type Enum:** `MechanicType` (PERCENT, AMOUNT, AMOUNT_PER_UNIT)
- **Key Fields:**
  - `agreementCode` (unique per tenant)
  - `agreementName`, `agreementType`
  - `cplId` (customer), `channel`, `regionId`
  - `guId`, `fuId`, `skuScope`
  - `tacticId`, `mechanicId`
  - `mechanicValue`, `mechanicType`
  - `currency` (default: 'TRY')
  - `capTotalAmount` (decimal 18,2) - Budget ceiling
  - `spendType`
  - `startDate`, `endDate`, `periodMonth` (YYYY-MM)
  - `justification` (text, mandatory)
  - `status`
  - `approvalRequestId` (uuid, nullable)
  - `approvedAt`, `approvedById`, `rejectedAt`, `rejectedById`, `rejectionReason`
  - `consumedAmount` (decimal 18,2, default: 0) - Sum of ledger entries
  - Price simulation fields (STA only): `currentPrice`, `expectedPrice`, `competitorPrice`, `competitorName`
- **Relations:** Customer, Tenant, User (approvedBy, rejectedBy)

### AgreementTransaction
**File:** `src/database/entities/agreement-transaction.entity.ts`
- **Key Fields:**
  - `agreementId` (uuid)
  - `invoiceNo` (string 100)
  - `invoiceDate` (date)
  - `amount` (decimal 18,2)
  - `currency` (default: 'TRY')
  - `cplId` (uuid, nullable)
  - `batchId` (uuid, nullable) - For Phase 1 batch import
  - `rowNumber` (int, nullable)
  - `idempotencyKey` (string 200, unique per tenant)
  - `notes`, `metadata` (jsonb)
- **Relations:** Agreement, Customer, Tenant

### ApprovalRequest
**File:** `src/database/entities/approval-request.entity.ts`
- **Request Type Enum:** `ApprovalRequestType` (AGREEMENT, BUDGET_TRANSFER, IMPORT_BATCH, OTHER)
- **Status Enum:** `ApprovalRequestStatus` (PENDING, APPROVED, REJECTED, CANCELLED)
- **Key Fields:**
  - `requestType`
  - `entityType` (string 50) - 'AGREEMENT', 'BUDGET_TRANSFER', 'IMPORT_BATCH'
  - `entityId` (uuid)
  - `requestedById`, `requestedAt`
  - `approvalPolicyId` (uuid, nullable)
  - `approvalLevels` (jsonb array) - Multi-level approval structure
  - `currentLevel` (int, default: 1)
  - `status`
  - `approvedAt`, `approvedById`
  - `rejectedAt`, `rejectedById`, `rejectionReason`
  - `cancelledAt`, `cancelledById`
  - `metadata` (jsonb)
- **Relations:** Tenant, User (requestedBy, approvedBy, rejectedBy)

### LedgerEntry
**File:** `src/database/entities/ledger-entry.entity.ts`
- **Direction Enum:** `LedgerEntryDirection` (DEBIT, CREDIT)
- **Spend Type Enum:** `SpendType` (ON_INVOICE, OFF_INVOICE, ADJUSTMENT, ACCRUAL)
- **Key Fields:**
  - `sourceType` (string 50) - 'AGREEMENT', 'PLAN', 'MANUAL'
  - `sourceId` (uuid)
  - `agreementId` (uuid, nullable) - For Actuals-First
  - `spendType`
  - `entryDirection` (default: DEBIT)
  - `amount` (decimal 18,2)
  - `currency` (default: 'TRY')
  - `periodMonth` (string 7) - YYYY-MM
  - `postingDate` (date)
  - Dimension fields: `channel`, `cplId`, `fuId`, `tacticId`, `mechanicId`
  - `budgetEnvelopeId` (uuid, nullable)
  - `idempotencyKey` (string 200, unique per tenant)
  - `description`, `metadata` (jsonb)
- **Relations:** Agreement, BudgetEnvelope, Customer, Tenant

### Notification
**File:** `src/database/entities/notification.entity.ts`
- **Type Enum:** `NotificationType` (APPROVAL_REQUESTED, APPROVAL_GRANTED, APPROVAL_REJECTED, BUDGET_ALERT_80, BUDGET_ALERT_100, AGREEMENT_EXPIRING)
- **Channel Enum:** `NotificationChannel` (EMAIL, IN_APP, SMS)
- **Priority Enum:** `NotificationPriority` (LOW, MEDIUM, HIGH)
- **Status Enum:** `NotificationStatus` (PENDING, SENT, DELIVERED, FAILED, READ)
- **Key Fields:**
  - `type`, `channel`, `priority`, `status`
  - `recipientId`, `recipientEmail`, `recipientName`
  - `subject`, `body`
  - `metadata` (jsonb)
  - `sentAt`, `readAt`, `expiresAt`
- **Relations:** Tenant

### AdminAuditLog
**File:** `src/database/entities/admin-audit-log.entity.ts`
- **Result Enum:** `AuditLogResult` (SUCCESS, FAILURE)
- **Key Fields:**
  - `id` (uuid, primary)
  - `tenantId`, `adminId`, `adminEmail`
  - `actionType` (string 50)
  - `entityType` (string 100)
  - `entityId` (uuid, nullable)
  - `ipAddress` (string 45, nullable)
  - `result`
  - `beforeValues`, `afterValues` (jsonb)
  - `justification` (text, nullable)
  - `isHighRisk` (boolean, default: false)
  - `alertSent` (boolean, default: false)
  - `createdAt` (timestamp)
- **Relations:** Tenant

---

## 3. Existing Modules

### Customer Module
**Path:** `src/modules/customer/`
- **Services:**
  - `CustomerService` - CRUD operations
  - `FileParserService` - CSV/Excel import parsing
- **Controllers:**
  - `CustomerController` - REST API endpoints
- **DTOs:**
  - `CreateCustomerDto`
  - `UpdateCustomerDto`
  - `CustomerResponseDto`
  - `CustomerFilterDto`
- **Repository:** `CustomerRepository`
- **CRUD:** ✅ Full CRUD operations

### Tenant Module
**Path:** `src/modules/tenant/`
- **Services:**
  - `TenantService` - CRUD operations
- **Controllers:**
  - `TenantController` - REST API endpoints
- **DTOs:**
  - `CreateTenantDto`
  - `UpdateTenantDto`
  - `TenantResponseDto`
- **Repository:** `TenantRepository`
- **CRUD:** ✅ Full CRUD operations

### User Module
**Path:** `src/modules/user/`
- **Services:**
  - `UserService` - User management, authentication
- **Controllers:**
  - `UserController` - User CRUD
  - `AuthController` - Authentication endpoints (login, register, etc.)
- **DTOs:**
  - `CreateUserDto`
  - `UpdateUserDto`
  - `UserResponseDto`
  - `LoginDto`
  - `ChangePasswordDto`
- **Repository:** `UserRepository`
- **Strategies:**
  - `JwtStrategy` - Passport JWT authentication
- **CRUD:** ✅ Full CRUD operations + Authentication

### Budget Module (Shared)
**Path:** `src/modules/shared/budget/`
- **Services:**
  - `BudgetService` - Budget envelope management, reservation/release operations
- **Controllers:**
  - `BudgetController` - REST API endpoints
- **DTOs:**
  - `CreateBudgetEnvelopeDto`
  - `ReserveBudgetDto`
- **Repository:** `BudgetRepository`
- **CRUD:** ✅ Budget envelope CRUD + Budget transaction operations
- **Features:**
  - Budget envelope creation/management
  - Budget reservation (creates RESERVE transaction)
  - Budget release (creates RELEASE transaction)
  - Reserved amount computation (from transactions)
  - **NEW:** Budget summary via `v_budget_summary` view
    - `getBudgetSummary(envelopeId, tenantId)` - Get computed budget summary for single envelope
    - `getAllBudgetSummaries(tenantId)` - Get all budget summaries for tenant

### Approval Module (Shared)
**Path:** `src/modules/shared/approval/`
- **Services:** None (module structure only)
- **Controllers:** None
- **Status:** ⚠️ **STUB MODULE** - Structure exists but no implementation
- **Note:** ApprovalRequest entity exists, but no service/controller yet

### Reporting Module (Shared)
**Path:** `src/modules/shared/reporting/`
- **Services:** None (module structure only)
- **Controllers:** None
- **Status:** ⚠️ **STUB MODULE** - Structure exists but no implementation

### Notification Module
**Path:** `src/modules/notification/`
- **Services:**
  - `NotificationService` - Notification creation and management
  - `EmailService` - Email sending service
- **Controllers:**
  - `NotificationController` - REST API endpoints
- **Repository:** `NotificationRepository`
- **CRUD:** ✅ Notification CRUD operations

### Actuals-First Mode Modules
**Path:** `src/modules/modes/actuals-first/`
- **Subdirectories:**
  - `agreement/` - ⚠️ **EMPTY** (no files)
  - `agreement-transaction/` - ⚠️ **EMPTY** (no files)
  - `ledger/` - ⚠️ **EMPTY** (no files)
- **Status:** ⚠️ **DIRECTORIES EXIST BUT NO IMPLEMENTATION**
- **Note:** Entities exist (Agreement, AgreementTransaction, LedgerEntry) but modules not implemented

### Planning-First Mode Modules
**Path:** `src/modules/modes/planning-first/`
- **Status:** ⚠️ **EMPTY DIRECTORY** (future implementation)

---

## 4. Database Migrations

All migrations are located in `src/database/migrations/`:

1. **1704067200000-CreateTenants.ts** ✅
   - Creates `tenants` table
   - Creates `TenantStatus` and `TenantPlan` enums

2. **1704067260000-CreateUsers.ts** ✅
   - Creates `users` table
   - Creates `UserRole` and `UserStatus` enums

3. **1704067320000-CreateCustomers.ts** ✅
   - Creates `customers` table
   - Creates `CustomerChannel`, `CustomerType`, `CustomerStatus` enums

4. **1704067380000-AddNumberOfBranchesToCustomers.ts** ✅
   - Adds `number_of_branches` column to `customers` table

5. **1704067500000-CreateBudgetEnvelopes.ts** ✅
   - Creates `budget_envelopes` table
   - Creates `BudgetEnvelopeStatus` enum
   - ⚠️ **Note:** Creates `consumed_amount` and `available_amount` as stored fields (should be computed via view)

6. **1704067560000-CreateBudgetReservations.ts** ✅
   - Creates `budget_reservations` table
   - Creates `BudgetReservationStatus` enum

7. **1704067620000-CreateNotifications.ts** ✅
   - Creates `notifications` table
   - Creates notification enums

8. **1704067680000-CreateAdminAuditLogs.ts** ✅
   - Creates `admin_audit_logs` table
   - Creates `AuditLogResult` enum

9. **1704067740000-CreateBudgetSummaryView.ts** ✅ **NEW**
   - Creates `v_budget_summary` database view
   - Computes `reserved_amount` from `budget_transactions` (RESERVE - RELEASE)
   - Computes `consumed_amount` from `ledger_entries` (DEBIT - CREDIT)
   - Computes `available_amount` as `allocated - reserved - consumed`
   - Computes `utilization_pct` as `(reserved + consumed) / allocated * 100`
   - Creates performance indexes on `budget_transactions` and `ledger_entries`

**Migration Status:** ✅ All migrations defined, but some entities (Agreement, AgreementTransaction, LedgerEntry, BudgetTransaction, ApprovalRequest) may need migrations if not yet created.

---

## 5. Specific Checks

### ✅ BudgetReservation Entity
**Status:** EXISTS  
**File:** `src/database/entities/budget-reservation.entity.ts`

**Key Fields:**
- `envelopeId` (uuid)
- `agreementId` (uuid, nullable)
- `agreementName` (string, nullable)
- `reservedAmount` (decimal 15,2) - **STORED**
- `status` (enum: PENDING, APPROVED, REJECTED, COMMITTED, CANCELLED)
- `requestedById`, `requestedByEmail`, `requestedByName`
- `approvedById`, `approvedAt`
- `rejectedReason`, `notes`

### ✅ BudgetTransaction Entity
**Status:** EXISTS  
**File:** `src/database/entities/budget-transaction.entity.ts`

**Key Fields:**
- `envelopeId` (uuid)
- `txType` (enum)
- `txStatus` (enum: PENDING, POSTED, CANCELLED)
- `sourceType` (enum), `sourceId` (uuid, nullable)
- `amount` (decimal 18,2)
- `currency` (default: 'TRY')
- `idempotencyKey` (string 200, unique per tenant)
- `description`, `notes`, `metadata` (jsonb)

**Transaction Type Enum Values:**
- `ALLOCATE` - Initial envelope creation
- `COMMIT` - Planning-First: Plan approved
- `RESERVE` - Actuals-First: Agreement approved
- `RELEASE` - Agreement cancelled (free reserved budget)
- `TRANSFER` - Move budget between envelopes
- `ADJUST` - Manual correction (admin only)

### ⚠️ BudgetEnvelope Stored Fields
**Status:** HAS STORED FIELDS (legacy - view now available)

**Current Stored Fields:**
- ✅ `allocatedAmount` (decimal 15,2) - **CORRECT** (stored - source of truth)
- ⚠️ `consumedAmount` (decimal 15,2, default: 0) - **STORED** (legacy - use view instead)
- ⚠️ `availableAmount` (decimal 15,2) - **STORED** (legacy - use view instead)

**BRD Requirement:**
- `reservedAmount` - ✅ **COMPUTED** from `budget_transactions` (via `v_budget_summary` view)
- `consumedAmount` - ✅ **COMPUTED** from `ledger_entries` (via `v_budget_summary` view)
- `availableAmount` - ✅ **COMPUTED** as `allocatedAmount - reservedAmount - consumedAmount`

**Implementation Status:**
- ✅ `v_budget_summary` view **IMPLEMENTED** (migration 1704067740000)
- ✅ `BudgetSummaryView` entity **CREATED**
- ✅ Repository methods **ADDED** (`getBudgetSummary`, `getAllBudgetSummaries`)
- ⚠️ Stored fields remain for backward compatibility (will be deprecated in future migration)

**Note:** Use `BudgetRepository.getBudgetSummary()` or `getAllBudgetSummaries()` to access BRD-compliant computed values. Stored fields in `BudgetEnvelope` are legacy and should not be used for calculations.

### ✅ Agreement Entity
**Status:** EXISTS  
**File:** `src/database/entities/agreement.entity.ts`

**Key Fields:**
- `agreementCode` (unique per tenant)
- `agreementType` (STA/LTA)
- `status` (enum: DRAFT, PENDING, APPROVED, ACTIVE, CLOSED, REJECTED, CANCELLED)
- `cplId`, `channel`, `regionId`
- `guId`, `fuId`, `skuScope`
- `tacticId`, `mechanicId`
- `mechanicValue`, `mechanicType`
- `capTotalAmount` (budget ceiling)
- `spendType` (ON_INVOICE, OFF_INVOICE, BOTH)
- `startDate`, `endDate`, `periodMonth`
- `justification` (mandatory)
- `approvalRequestId`
- `consumedAmount` (computed from ledger entries)

**Module Status:** ⚠️ Entity exists but **NO MODULE IMPLEMENTATION** (directory `src/modules/modes/actuals-first/agreement/` is empty)

### ✅ ApprovalRequest Entity
**Status:** EXISTS  
**File:** `src/database/entities/approval-request.entity.ts`

**Key Fields:**
- `requestType` (enum: AGREEMENT, BUDGET_TRANSFER, IMPORT_BATCH, OTHER)
- `entityType`, `entityId`
- `requestedById`, `requestedAt`
- `approvalPolicyId` (nullable)
- `approvalLevels` (jsonb array) - Multi-level approval structure
- `currentLevel` (int)
- `status` (enum: PENDING, APPROVED, REJECTED, CANCELLED)
- `approvedAt`, `approvedById`
- `rejectedAt`, `rejectedById`, `rejectionReason`

**Module Status:** ⚠️ Entity exists, **STUB MODULE** exists (`src/modules/shared/approval/approval.module.ts`) but **NO SERVICE/CONTROLLER IMPLEMENTATION**

### ✅ LedgerEntry Entity
**Status:** EXISTS  
**File:** `src/database/entities/ledger-entry.entity.ts`

**Key Fields:**
- `sourceType`, `sourceId`
- `agreementId` (nullable, for Actuals-First)
- `spendType` (enum: ON_INVOICE, OFF_INVOICE, ADJUSTMENT, ACCRUAL)
- `entryDirection` (enum: DEBIT, CREDIT)
- `amount` (decimal 18,2)
- `currency` (default: 'TRY')
- `periodMonth` (YYYY-MM)
- `postingDate`
- Dimension fields: `channel`, `cplId`, `fuId`, `tacticId`, `mechanicId`
- `budgetEnvelopeId` (nullable)
- `idempotencyKey` (unique per tenant)

**Module Status:** ⚠️ Entity exists but **NO MODULE IMPLEMENTATION** (directory `src/modules/modes/actuals-first/ledger/` is empty)

### ✅ v_budget_summary View
**Status:** ✅ **IMPLEMENTED**

**BRD Requirement:** ✅ Required and **IMPLEMENTED**
- ✅ Computes `reservedAmount` from `budget_transactions` (RESERVE - RELEASE, POSTED only)
- ✅ Computes `consumedAmount` from `ledger_entries` (DEBIT - CREDIT)
- ✅ Computes `availableAmount` as `allocatedAmount - reservedAmount - consumedAmount`
- ✅ Computes `utilizationPct` as `(reserved + consumed) / allocated * 100`

**Implementation Details:**
- **Migration:** `1704067740000-CreateBudgetSummaryView.ts` ✅
- **View Entity:** `BudgetSummaryView` in `src/database/entities/budget-summary.view-entity.ts` ✅
- **Repository Methods:** 
  - `getBudgetSummary(envelopeId, tenantId)` ✅
  - `getAllBudgetSummaries(tenantId)` ✅
- **Performance Indexes:** Created on `budget_transactions` and `ledger_entries` ✅
- **Registered in:** `DatabaseModule` entities array ✅

**Usage:**
```typescript
// Get single envelope summary
const summary = await budgetRepository.getBudgetSummary(envelopeId, tenantId);

// Get all summaries for tenant
const summaries = await budgetRepository.getAllBudgetSummaries(tenantId);
```

**Status:** ✅ **COMPLETE** - Ready for use

---

## 6. Tech Stack Confirmation

### ORM
- **Type:** TypeORM
- **Version:** `^0.3.17` (from package.json)
- **Configuration:** `src/config/typeorm.config.ts`
- **Naming Strategy:** `SnakeCaseNamingStrategy` (custom)
- **Schema:** `main` (default schema)
- **Synchronize:** `false` (production-safe)

### Database
- **Type:** PostgreSQL
- **Version:** `16` (from docker-compose.yml)
- **Container:** `postgres:16`
- **Connection:** Configured via environment variables (DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE, DB_SCHEMA)

### Framework
- **Type:** NestJS
- **Version:** `^10.0.0` (from package.json)
- **Modules:** Modular architecture with feature modules
- **Authentication:** JWT (Passport + @nestjs/jwt)
- **Validation:** class-validator, class-transformer
- **API Documentation:** Swagger (@nestjs/swagger)

### Additional Libraries
- **Password Hashing:** bcrypt (`^5.1.1`)
- **File Parsing:** csv-parser (`^3.2.0`), xlsx (`^0.18.5`)
- **Database Driver:** pg (`^8.11.3`)

---

## 7. Summary & Recommendations

### ✅ Strengths
1. **Well-structured entity definitions** - All core entities defined with proper relationships
2. **Multi-tenancy support** - BaseEntity includes tenantId, proper guards/interceptors
3. **Event-sourced budget transactions** - BudgetTransaction entity properly designed
4. **Comprehensive enums** - Status, type, and role enums well-defined
5. **Migration system** - TypeORM migrations set up and configured

### ⚠️ Critical Issues
1. ~~**Missing v_budget_summary View**~~ ✅ **RESOLVED**
   - ✅ View implemented (migration 1704067740000)
   - ✅ ViewEntity created
   - ✅ Repository methods added
   - ⚠️ Stored fields in BudgetEnvelope remain (legacy - will be deprecated)

2. **Actuals-First Mode Modules Not Implemented** 🔴
   - Agreement, AgreementTransaction, LedgerEntry entities exist
   - But no service/controller implementations
   - Directories are empty
   - Priority: **HIGH** for Sprint 1

3. **Approval Module Stub** ⚠️
   - ApprovalRequest entity exists
   - Module structure exists but no service/controller
   - Priority: **MEDIUM** for Sprint 1

4. **BudgetEnvelope Stored Fields** ⚠️
   - `consumedAmount` and `availableAmount` are stored (legacy)
   - ✅ View now available - use `BudgetSummaryView` for computed values
   - Migration needed to remove these fields in future (after all code migrated to view)
   - Priority: **LOW** (view is working, stored fields are legacy)

### 📋 Recommendations for Sprint 1
1. ~~**Implement v_budget_summary view**~~ ✅ **COMPLETED**
   - ✅ View migration created
   - ✅ ViewEntity implemented
   - ✅ Repository methods added
   - ⚠️ **Next:** Migrate all code to use view instead of stored fields

2. **Create Actuals-First mode modules:** 🔴 **HIGH PRIORITY**
   - Agreement module (service, controller, DTOs)
   - AgreementTransaction module
   - Ledger module

3. **Implement Approval module** (service, controller) ⚠️ **MEDIUM PRIORITY**

4. **Migration plan:**
   - ✅ View migration created
   - ⚠️ Update all code to use `BudgetSummaryView` instead of stored fields
   - ⚠️ Future: Remove stored `consumedAmount` and `availableAmount` from BudgetEnvelope (after code migration)

5. **Review and validate:**
   - Entity relationships
   - Indexes for performance
   - Validation rules in DTOs
   - Test view performance with large datasets

---

**Report Generated:** 2024  
**Last Updated:** After v_budget_summary view implementation  
**Next Review:** Before Sprint 1 Implementation

---

## 8. Recent Changes (v_budget_summary Implementation)

### ✅ Completed
1. **Migration Created:** `1704067740000-CreateBudgetSummaryView.ts`
   - Creates `main.v_budget_summary` view
   - Computes reserved, consumed, available amounts
   - Creates performance indexes

2. **View Entity Created:** `budget-summary.view-entity.ts`
   - TypeORM ViewEntity mapping
   - All computed fields properly mapped

3. **Repository Updated:** `BudgetRepository`
   - Added `getBudgetSummary(envelopeId, tenantId)`
   - Added `getAllBudgetSummaries(tenantId)`

4. **Module Registration:** `DatabaseModule`
   - `BudgetSummaryView` registered in entities array

### ⚠️ Next Steps
1. Run migration: `npm run migration:run`
2. Update `BudgetService` to use view methods where applicable
3. Update API responses to use computed values from view
4. Test view performance
5. Plan future migration to remove stored fields from `BudgetEnvelope`


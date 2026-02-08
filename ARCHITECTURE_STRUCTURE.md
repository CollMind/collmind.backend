# Architecture Structure
## CollMind TPM Backend

**Last Updated:** January 2026  
**Status:** ✅ Mode separation structure created

---

## Directory Structure

```
src/
├── modules/
│   ├── modes/
│   │   ├── actuals-first/          # Actuals-First Mode modules
│   │   │   ├── agreement/          # Agreement management (STA/LTA)
│   │   │   ├── agreement-transaction/  # Off-invoice transactions
│   │   │   └── ledger/            # Ledger entry management
│   │   └── planning-first/         # Planning-First Mode modules (future)
│   │       └── (empty for now)
│   ├── shared/                     # Shared core modules
│   │   ├── approval/              # Approval workflow (shared)
│   │   ├── budget/                # Budget management (shared)
│   │   └── reporting/             # Reporting & analytics (shared)
│   ├── tenant/                     # Tenant management
│   ├── user/                       # User & authentication
│   ├── customer/                   # Customer (CPL) management
│   └── notification/               # Notification service
├── database/
│   ├── entities/                   # TypeORM entities
│   │   ├── agreement.entity.ts
│   │   ├── approval-request.entity.ts
│   │   ├── budget-transaction.entity.ts
│   │   ├── ledger-entry.entity.ts
│   │   ├── agreement-transaction.entity.ts
│   │   └── ... (other entities)
│   ├── migrations/
│   └── seeds/
└── common/                         # Shared utilities
    ├── guards/
    ├── decorators/
    ├── filters/
    └── services/
```

---

## Mode Separation

### Actuals-First Mode
**Location:** `src/modules/modes/actuals-first/`

**Modules:**
- `agreement/` - Agreement (STA/LTA) management
- `agreement-transaction/` - Off-invoice transaction processing
- `ledger/` - Ledger entry creation and management

**Key Entities:**
- `Agreement` - Core commercial contract
- `AgreementTransaction` - Off-invoice transactions
- `LedgerEntry` - Unified spend log

### Planning-First Mode
**Location:** `src/modules/modes/planning-first/`

**Status:** Empty (to be implemented in future sprints)

**Planned Modules:**
- `plan/` - Plan management
- `plan-transaction/` - Planned spend tracking

---

## Shared Core Modules

### Budget Module
**Location:** `src/modules/shared/budget/`

**Purpose:** Budget envelope and transaction management (event-sourced)

**Key Features:**
- Budget envelope CRUD
- Budget reservation (RESERVE transaction)
- Budget release (RELEASE transaction)
- Computed reserved/available amounts

**Key Entity:** `BudgetTransaction` (event-sourced, replaces BudgetReservation)

### Approval Module
**Location:** `src/modules/shared/approval/`

**Purpose:** Approval workflow for both modes

**Key Features:**
- Multi-level approval workflows
- Policy-driven routing
- Self-approval prevention

**Key Entity:** `ApprovalRequest`

### Reporting Module
**Location:** `src/modules/shared/reporting/`

**Purpose:** Reporting and analytics

**Status:** Placeholder (to be implemented)

---

## Entity Relationships

### Actuals-First Flow
```
Agreement
  ├─→ ApprovalRequest (One-to-One)
  ├─→ BudgetTransaction (RESERVE) (One-to-Many)
  ├─→ AgreementTransaction (One-to-Many)
  └─→ LedgerEntry (One-to-Many)

AgreementTransaction
  └─→ LedgerEntry (One-to-One)

LedgerEntry
  └─→ BudgetEnvelope (Many-to-One)
```

### Budget Flow (Event-Sourced)
```
BudgetEnvelope
  └─→ BudgetTransaction (One-to-Many)
      ├─ RESERVE (Agreement approved)
      ├─ RELEASE (Agreement cancelled)
      ├─ COMMIT (Plan approved - Planning-First)
      └─ TRANSFER/ADJUST (Manual operations)
```

---

## Key Architectural Decisions

### 1. Mode Separation
- **Decision:** Separate `modes/actuals-first/` and `modes/planning-first/` directories
- **Rationale:** Enables Planning-First addition without refactoring Actuals-First
- **Status:** ✅ Structure created

### 2. Event-Sourced Budget
- **Decision:** Use `BudgetTransaction` instead of `BudgetReservation`
- **Rationale:** BRD compliance, eliminates dual-write issues, ensures consistency
- **Status:** ✅ Entity created, module updated

### 3. Shared Core
- **Decision:** Budget, Approval, Reporting as shared modules
- **Rationale:** Both modes need these capabilities
- **Status:** ✅ Structure created

### 4. Computed Budget Fields
- **Decision:** Reserved/Consumed amounts computed via `v_budget_summary` view
- **Rationale:** BRD compliance, eliminates dual-write issues
- **Status:** ⚠️ View to be implemented in Sprint 1

---

## Next Steps (Sprint 1)

1. **Implement Actuals-First Modules:**
   - `agreement/` module (CRUD, state machine)
   - `agreement-transaction/` module (off-invoice processing)
   - `ledger/` module (ledger entry creation)

2. **Implement Shared Approval Module:**
   - Approval workflow service
   - Policy engine
   - Multi-level approval logic

3. **Create Database View:**
   - `v_budget_summary` view for computed budget fields

4. **Migration:**
   - Remove `BudgetReservation` entity (if exists in DB)
   - Add `BudgetTransaction` entity
   - Add other missing entities

---

**Last Updated:** January 2026



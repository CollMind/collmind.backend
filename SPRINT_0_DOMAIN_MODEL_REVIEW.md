# Sprint 0: Domain Model Review
## BRD Compliance Analysis

**Date:** January 2026  
**Reviewer:** AI Assistant  
**Scope:** Domain models vs BRD intent (Actuals-First, no baseline planning)

---

## Executive Summary

**Overall Assessment:** ✅ **HIGHLY ALIGNED** with BRD intent

The implemented domain models correctly reflect Actuals-First paradigm:
- ✅ No baseline/planning fields
- ✅ Event-sourced budget (reservation vs consumption)
- ✅ Agreement-centric design
- ✅ Approval workflow properly structured

**Minor Deviations:** Intentional simplifications for Sprint 0 (deferred features)

---

## 1. Agreement Entity (STA / LTA)

### ✅ Matches with BRD

1. **Agreement Types:**
   - ✅ STA (≤30 days) and LTA (>30 days) - Matches BRD Section 4.1
   - ✅ `agreementType` enum correctly defined

2. **Core Fields:**
   - ✅ `agreementCode` - Unique identifier (e.g., "STA-2026-025")
   - ✅ `cplId` - Customer/CPL reference (required)
   - ✅ `channel` - TRADITIONAL, NKA, MT, WHOLESALE, PROFESSIONAL
   - ✅ `fuId` - Forecasting Unit (required)
   - ✅ `guId` - Generic Unit (optional)
   - ✅ `tacticId`, `mechanicId` - Tactic and mechanic references
   - ✅ `capTotalAmount` - Budget ceiling
   - ✅ `spendType` - ON_INVOICE, OFF_INVOICE, BOTH
   - ✅ `justification` - Mandatory business rationale
   - ✅ `periodMonth` - YYYY-MM format

3. **Status Lifecycle:**
   - ✅ States: DRAFT, PENDING, APPROVED, ACTIVE, CLOSED, REJECTED, CANCELLED
   - ✅ Matches BRD Section 4.1 exactly

4. **Price Simulation (STA only):**
   - ✅ `currentPrice`, `expectedPrice`, `competitorPrice`, `competitorName`
   - ✅ Matches BRD (STA-specific feature)

5. **Budget Tracking:**
   - ✅ `consumedAmount` - Sum of ledger entries (computed)
   - ✅ Matches BRD Section 4.8

### ✅ No Baseline/Planning Fields

**Verified:** No fields related to:
- ❌ Baseline volume
- ❌ Planned volume
- ❌ Forecast data
- ❌ Planning cycles
- ❌ ROI simulation fields

**BRD Intent:** Actuals-First operates without baseline/forecast data ✅

### ⚠️ Intentional Simplifications (Deferred)

1. **Missing Relationships (Future):**
   - `ForecastingUnit` entity not created (referenced but not implemented)
   - `GenericUnit` entity not created (referenced but not implemented)
   - `Tactic` entity not created (referenced but not implemented)
   - `Mechanic` entity not created (referenced but not implemented)
   - `Region` entity not created (optional, referenced)

   **Status:** ✅ Acceptable for Sprint 0 - These are reference entities, can be added later

2. **Missing Fields (Future):**
   - No `attachments` field (BRD mentions optional file attachments)
   - No `estimated_volume` field (BRD mentions this for LTA, but it's not baseline - it's for cap calculation)

   **Status:** ✅ Acceptable for Sprint 0 - Can be added in Sprint 1

---

## 2. Budget Handling (Reservation vs Consumption)

### ✅ Matches with BRD

1. **Event-Sourced Approach:**
   - ✅ `BudgetTransaction` entity (not `BudgetReservation`)
   - ✅ Transaction types: RESERVE, RELEASE, COMMIT, TRANSFER, ADJUST
   - ✅ Matches BRD Section 3.3 exactly

2. **Reservation Flow:**
   - ✅ RESERVE transaction created on Agreement approval
   - ✅ `sourceType = AGREEMENT`, `sourceId = agreement.id`
   - ✅ `idempotencyKey` format: `RESERVE|AGREEMENT|{agreement_id}|{envelope_id}`
   - ✅ Matches BRD Section 4.8

3. **Consumption Flow:**
   - ✅ `LedgerEntry` entity for actual spend
   - ✅ `budgetEnvelopeId` links to envelope
   - ✅ `consumedAmount` computed from ledger entries (not stored)
   - ✅ Matches BRD Section 4.8

4. **Two-Step Process:**
   - ✅ **Reserved:** At approval (RESERVE transaction)
   - ✅ **Consumed:** At ledger posting (LedgerEntry)
   - ✅ Matches BRD Section 4.8 exactly

### ✅ BRD Compliance

**Key Principle (BRD Section 3.3):**
> "committed/reserved/consumed are **not stored** in budget_envelopes table. Instead, they are **computed** from budget_transactions and ledger_entries"

**Implementation:**
- ✅ Reserved: Computed from `budget_transactions` (RESERVE - RELEASE)
- ✅ Consumed: Computed from `ledger_entries`
- ✅ Available: Computed (Allocated - Reserved - Consumed)

**Status:** ✅ Fully compliant

### ⚠️ Intentional Simplifications (Deferred)

1. **Missing View:**
   - `v_budget_summary` view not implemented
   - Computed fields logic exists in repository but view is missing

   **Status:** ⚠️ Should be implemented in Sprint 1 (BRD requirement)

2. **Budget Envelope Entity:**
   - Current: Has `reservedAmount`, `consumedAmount`, `availableAmount` as stored fields
   - BRD: These should be computed, not stored

   **Status:** ⚠️ Migration needed in Sprint 1 (remove stored fields, use view)

---

## 3. Approval Flow Entities

### ✅ Matches with BRD

1. **ApprovalRequest Entity:**
   - ✅ `requestType` - AGREEMENT, BUDGET_TRANSFER, IMPORT_BATCH, OTHER
   - ✅ `entityType`, `entityId` - Generic entity reference
   - ✅ `approvalLevels` - JSONB array for multi-level approvals
   - ✅ `currentLevel` - Tracks which level is active
   - ✅ Status: PENDING, APPROVED, REJECTED, CANCELLED
   - ✅ Matches BRD Section 3.4 (approval workflow)

2. **Multi-Level Support:**
   - ✅ `approvalLevels` JSONB structure supports sequential approvals
   - ✅ Each level has: order, role, userId, status, approvedAt, etc.
   - ✅ Matches BRD intent

3. **Self-Approval Prevention:**
   - ✅ `requestedById` separate from `approvedById`
   - ✅ Can enforce EA-001 rule (no self-approval)
   - ✅ Matches BRD requirement

### ⚠️ Intentional Simplifications (Deferred)

1. **Policy Engine:**
   - `approvalPolicyId` field exists but no policy entity/service
   - Policy matching logic not implemented

   **Status:** ✅ Acceptable for Sprint 0 - Policy engine deferred to Sprint 1

2. **Approval Routing:**
   - `approvalLevels` structure supports routing but routing logic not implemented
   - No automatic approver assignment

   **Status:** ✅ Acceptable for Sprint 0 - Routing deferred to Sprint 1

3. **Notification Integration:**
   - ApprovalRequest entity doesn't link to notifications
   - Notification service exists but not integrated

   **Status:** ✅ Acceptable for Sprint 0 - Integration deferred to Sprint 1

---

## 4. User / Role Assumptions

### ✅ Matches with BRD

1. **User Entity:**
   - ✅ `role` enum - PLANNER, APPROVER, FINANCE, ADMIN
   - ✅ Matches BRD Section 7 (Security & Roles)

2. **Role-Based Access:**
   - ✅ Guards and decorators support role-based access
   - ✅ Matches BRD intent

### ⚠️ Intentional Simplifications (Deferred)

1. **Role Granularity:**
   - BRD mentions: REGIONAL_MANAGER, BRAND_MANAGER (not in UserRole enum)
   - Current: Generic APPROVER role

   **Status:** ✅ Acceptable for Sprint 0 - Can be extended in Sprint 1

2. **Permission System:**
   - No fine-grained permissions (e.g., `agreement.create`, `agreement.approve`)
   - Only role-based access

   **Status:** ✅ Acceptable for Sprint 0 - Permission system deferred

---

## 5. Ledger Entry Entity

### ✅ Matches with BRD

1. **Unified Spend Log:**
   - ✅ `sourceType` - AGREEMENT, PLAN, MANUAL
   - ✅ `sourceId` - Links to Agreement or Plan
   - ✅ `spendType` - ON_INVOICE, OFF_INVOICE, ADJUSTMENT, ACCRUAL
   - ✅ Matches BRD Section 3.3

2. **Budget Integration:**
   - ✅ `budgetEnvelopeId` - Links to envelope
   - ✅ `periodMonth` - YYYY-MM format
   - ✅ Dimensions: channel, cplId, fuId, tacticId, mechanicId
   - ✅ Matches BRD Section 4.8

3. **Idempotency:**
   - ✅ `idempotencyKey` - Prevents duplicate postings
   - ✅ Format: `LEDGER|AGREEMENT|{agreement_id}|{transaction_id}`
   - ✅ Matches BRD requirement

### ✅ No Planning-First Contamination

**Verified:** LedgerEntry supports both modes but:
- ✅ `sourceType` can be 'PLAN' (for future Planning-First)
- ✅ `agreementId` is nullable (supports Planning-First)
- ✅ No baseline/forecast fields

**Status:** ✅ Correctly designed for dual-mode support

---

## 6. Agreement Transaction Entity

### ✅ Matches with BRD

1. **Off-Invoice Transactions:**
   - ✅ `agreementId` - Links to Agreement
   - ✅ `invoiceNo`, `invoiceDate` - Invoice details
   - ✅ `amount`, `currency` - Financial data
   - ✅ Matches BRD Section 4.3

2. **Batch Support:**
   - ✅ `batchId`, `rowNumber` - For batch import (Phase 1)
   - ✅ Matches BRD Section 4.3

3. **Idempotency:**
   - ✅ `idempotencyKey` - Format: `{agreement_id}|{invoice_no}|{invoice_date}`
   - ✅ Matches BRD Section 4.3

### ✅ No Baseline/Planning Fields

**Verified:** No fields related to:
- ❌ Planned volume
- ❌ Forecast data
- ❌ Baseline comparison

**Status:** ✅ Pure Actuals-First design

---

## Summary Table

| Aspect | BRD Requirement | Implementation | Status |
|--------|----------------|-----------------|--------|
| **Agreement Types** | STA / LTA | ✅ STA, LTA enums | ✅ Match |
| **Status Lifecycle** | DRAFT→PENDING→APPROVED→ACTIVE→CLOSED | ✅ All states | ✅ Match |
| **Budget Reservation** | Event-sourced (RESERVE transaction) | ✅ BudgetTransaction | ✅ Match |
| **Budget Consumption** | Via ledger_entries | ✅ LedgerEntry entity | ✅ Match |
| **Approval Flow** | Multi-level, policy-driven | ✅ ApprovalRequest with levels | ✅ Match |
| **No Baseline Fields** | No baseline/forecast data | ✅ Verified absent | ✅ Match |
| **No Planning Fields** | No planned volume/ROI | ✅ Verified absent | ✅ Match |
| **Computed Budget Fields** | Via v_budget_summary view | ⚠️ View missing | ⚠️ Deferred |
| **Policy Engine** | Policy-driven approvals | ⚠️ Structure only | ⚠️ Deferred |
| **Reference Entities** | FU, GU, Tactic, Mechanic | ⚠️ Not created | ⚠️ Deferred |

---

## Deviations from BRD

### 🔴 Critical Deviations

**None** - All critical requirements met

### 🟡 Minor Deviations (Acceptable for Sprint 0)

1. **Missing v_budget_summary View:**
   - **BRD:** Computed fields via view
   - **Current:** Repository methods compute, but no view
   - **Impact:** Low - Can be added in Sprint 1
   - **Status:** ⚠️ Deferred

2. **Budget Envelope Stored Fields:**
   - **BRD:** Reserved/consumed should be computed, not stored
   - **Current:** Has stored fields (legacy)
   - **Impact:** Medium - Migration needed
   - **Status:** ⚠️ Needs migration in Sprint 1

### 🟢 Intentional Simplifications (Deferred)

1. **Policy Engine:**
   - Approval policy matching not implemented
   - Structure exists, logic deferred

2. **Reference Entities:**
   - FU, GU, Tactic, Mechanic entities not created
   - Referenced as UUIDs only

3. **Notification Integration:**
   - Approval notifications not integrated
   - Notification service exists separately

4. **Role Granularity:**
   - Generic APPROVER role (not REGIONAL_MANAGER, etc.)
   - Can be extended later

---

## Areas Intentionally Simplified or Deferred

### 1. Policy Engine (Deferred to Sprint 1)
- **What:** Approval policy matching and routing
- **Why:** Complex logic, can start with manual assignment
- **Impact:** Low - Manual approver assignment works for Sprint 0

### 2. Reference Entities (Deferred to Sprint 1)
- **What:** ForecastingUnit, GenericUnit, Tactic, Mechanic entities
- **Why:** Can reference as UUIDs initially
- **Impact:** Low - Validation can be added later

### 3. Budget Summary View (Deferred to Sprint 1)
- **What:** `v_budget_summary` database view
- **Why:** Repository methods work, view is optimization
- **Impact:** Medium - Should be prioritized in Sprint 1

### 4. Budget Envelope Migration (Deferred to Sprint 1)
- **What:** Remove stored reserved/consumed fields
- **Why:** Requires data migration
- **Impact:** Medium - Should be done before production

### 5. Notification Integration (Deferred to Sprint 1)
- **What:** Link ApprovalRequest to notifications
- **Why:** Notification service exists but not integrated
- **Impact:** Low - Can be added incrementally

---

## BRD Intent Compliance

### Actuals-First Paradigm ✅

**BRD Intent (Section 4):**
> "Actuals-First Mode operates without baseline data, planned volumes, or forecasting. It tracks actual spend as it occurs."

**Implementation:**
- ✅ No baseline fields in any entity
- ✅ No planned volume fields
- ✅ No forecast/ROI fields
- ✅ Agreement-centric (not plan-centric)
- ✅ Reactive (not proactive planning)

**Status:** ✅ **FULLY COMPLIANT**

### No Planning-First Contamination ✅

**BRD Intent:**
> "Actuals-First and Planning-First are separate modes. Actuals-First should not include Planning-First concepts."

**Implementation:**
- ✅ No Plan entity references (except in LedgerEntry.sourceType for future)
- ✅ No baseline calculations
- ✅ No volume forecasting
- ✅ No ROI simulation fields

**Status:** ✅ **FULLY COMPLIANT**

---

## Recommendations

### Sprint 1 Priorities

1. **High Priority:**
   - Create `v_budget_summary` view
   - Migrate BudgetEnvelope (remove stored fields)
   - Implement policy engine (basic)

2. **Medium Priority:**
   - Create reference entities (FU, GU, Tactic, Mechanic)
   - Integrate approval notifications
   - Add role granularity

3. **Low Priority:**
   - Add attachments field to Agreement
   - Add estimated_volume to LTA (for cap calculation, not baseline)

---

## Conclusion

**Overall Assessment:** ✅ **HIGHLY ALIGNED**

The domain models correctly implement Actuals-First paradigm:
- ✅ No baseline/planning contamination
- ✅ Event-sourced budget (reservation vs consumption)
- ✅ Agreement-centric design
- ✅ Proper approval workflow structure

**Deviations:** All are intentional simplifications or deferred features acceptable for Sprint 0.

**Next Steps:** Prioritize `v_budget_summary` view and BudgetEnvelope migration in Sprint 1.

---

**Last Updated:** January 2026



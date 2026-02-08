# Sprint 04: Budget Reservation Concept Design
## Actuals-First TPM System

**Purpose:** Design the budget reservation concept for Actuals-First Mode  
**Status:** 📝 Conceptual Design Phase  
**Reference:** Section 4.8 - Budget Integration (BRD), Sprint 01-03

---

## Overview

This document defines the **budget reservation concept** for Actuals-First TPM. Budget reservation is the mechanism that ensures budget is set aside when an Agreement is approved, preventing over-commitment and maintaining real-time budget visibility.

**Key Principles:**
- Budget is reserved **at Agreement approval** (not at submission)
- Reservation is **mandatory** for all approved agreements
- Reservation prevents budget from being used by other agreements
- No concurrency handling in Sprint 0 (simple sequential processing)
- No budget overrun logic (validation only, no blocking)

---

## What Is Reserved

### Reserved Amount

**Definition:** The amount reserved equals the Agreement's **cap_total_amount** (budget ceiling).

**Formula:**
```
Reserved Amount = Agreement.cap_total_amount
```

**Example:**
- Agreement: STA-2026-025
- Cap Total Amount: 15,000 TL
- Reserved Amount: 15,000 TL

### What Gets Reserved

**Budget Envelope:**
- Budget is reserved from a specific **BudgetEnvelope**
- Envelope is determined by matching:
  - Channel (from Agreement.channel)
  - Category (derived from Agreement.fu_id → FU.category)
  - Period (from Agreement.period_month, format: YYYY-MM)

**Example Matching:**
```
Agreement:
  - Channel: TRADITIONAL
  - FU Category: Hair Care
  - Period: 2026-01

Matches BudgetEnvelope:
  - Code: "TRADITIONAL/HairCare/2026-01"
  - Channel: TRADITIONAL
  - Category: Hair Care
  - Period: 2026-01
```

### Reservation Scope

**Single Envelope:**
- Each Agreement reserves budget from **one** BudgetEnvelope
- No cross-envelope reservations
- No partial reservations across multiple envelopes

**Full Amount:**
- Entire `cap_total_amount` is reserved
- No partial reservations
- Reservation is all-or-nothing

---

## When It Is Reserved

### Reservation Trigger

**Event:** Agreement status transition from `PENDING` → `APPROVED`

**Timing:**
- Reservation occurs **immediately** when Agreement is approved
- Synchronous operation (not async)
- Part of the approval workflow

**Sequence:**
```
1. Approver approves Agreement
   ↓
2. ApprovalRequest.status = APPROVED
   ↓
3. Agreement.status = PENDING → APPROVED
   ↓
4. Budget Reservation Created (synchronous)
   ↓
5. BudgetTransaction (RESERVE) created
   ↓
6. BudgetEnvelope state updated (reserved/available computed via v_budget_summary)
```

### Reservation Timing Details

**Before Approval:**
- Agreement status: `PENDING`
- Budget: **NOT reserved**
- BudgetEnvelope: No change
- Budget availability: Checked (validation only)

**At Approval:**
- Agreement status: `PENDING` → `APPROVED`
- Budget: **RESERVED** (immediate)
- BudgetTransaction (RESERVE) created
- BudgetEnvelope: `reserved` computed (increases by cap_total_amount via v_budget_summary)
- BudgetEnvelope: `available` computed (decreases by cap_total_amount via v_budget_summary)

**After Approval:**
- Agreement status: `APPROVED`
- Budget: Reserved (locked)
- BudgetEnvelope: Reflects reserved amount
- Agreement can proceed to `ACTIVE` when start_date reached

### Reservation Validation

**Pre-Reservation Check (At Submission):**
- System validates budget availability
- Checks: `envelope.available_amount >= agreement.cap_total_amount`
- **Validation only** (does not reserve)
- If insufficient: Submission blocked with error

**Reservation Check (At Approval):**
- System verifies budget still available
- Checks: `envelope.available >= agreement.cap_total_amount` (computed via v_budget_summary)
- If insufficient: Approval fails, Agreement remains `PENDING`
- If sufficient: Reservation proceeds (create BudgetTransaction)

**Note:** In Sprint 0, no concurrency handling. Assumes sequential processing.

---

## How Reservation Relates to Agreement

### Relationship Model

**One-to-One Relationship:**
- Each Agreement has **exactly one** budget reservation
- Each budget reservation belongs to **exactly one** Agreement
- Reservation is created when Agreement is approved

**Relationship Diagram (BRD Event-Sourced Approach):**
```
┌─────────────┐         ┌──────────────────────┐
│  Agreement  │────────│ BudgetTransaction    │
│             │ 1    N │                      │
│ - id        │◄────────│ - source_id (FK)      │
│ - cap_total │         │ - tx_type = 'RESERVE'│
│   _amount   │         │ - amount             │
│ - status    │         │ - envelope_id (FK)   │
└─────────────┘         │ - tx_status = 'POSTED'│
                        └──────────────────────┘
                              │
                              │ Many-to-One
                              ↓
                        ┌──────────────────┐
                        │ BudgetEnvelope   │
                        │                  │
                        │ - total_allocated │
                        │                  │
                        │ (reserved computed│
                        │  via v_budget_    │
                        │  summary view)   │
                        └──────────────────┘
```

**Note:** There is NO separate `BudgetReservation` entity. Reservations are `BudgetTransaction` records with `tx_type = 'RESERVE'` (BRD Section 3.3).

### Reservation Entity Concept

**BRD Compliance Note:** Budget reservations are NOT stored in a separate `budget_reservations` table. Instead, they are represented as `BudgetTransaction` records with `tx_type = 'RESERVE'` (event-sourced approach).

**BudgetTransaction Record (RESERVE type):**
- `envelope_id` (FK to BudgetEnvelope)
- `tx_type` = 'RESERVE'
- `tx_status` = 'POSTED' (immediate)
- `source_type` = 'AGREEMENT'
- `source_id` = Agreement.id
- `amount` = Agreement.cap_total_amount
- `idempotency_key` = `RESERVE|AGREEMENT|{agreement_id}|{envelope_id}`
- `created_at` (timestamp when reserved)
- `created_by` (user who approved, from ApprovalRequest)

**Denormalized Fields (for performance - optional):**
- Can be added to Agreement entity for quick lookup:
  - `budget_reservation_tx_id` (FK to budget_transactions.id)
  - `budget_reserved_at` (denormalized timestamp)

### Reservation Lifecycle

**Creation:**
- Created when Agreement approved
- Record: `BudgetTransaction` with `tx_type = 'RESERVE'`, `tx_status = 'POSTED'`
- Amount: `agreement.cap_total_amount`
- Envelope: Matched via channel/category/period
- Immutable record (event-sourced)

**Active:**
- Reservation transaction remains in `budget_transactions` table
- Budget is locked (cannot be used by other agreements)
- Budget consumption occurs separately (via LedgerEntry)
- Reserved amount computed via `v_budget_summary` view

**Release (Future):**
- If Agreement cancelled early: Create `BudgetTransaction` with `tx_type = 'RELEASE'`
- Amount: Released back to envelope
- Both RESERVE and RELEASE transactions remain in history (immutable)

**Note:** In Sprint 0, no release logic. RESERVE transactions remain until Agreement closes. All transactions are immutable (event-sourced approach per BRD Section 3.3).

---

## What Happens on Approval vs Rejection

### On Approval

**Agreement Approval Flow:**
```
1. Approver approves Agreement
   ↓
2. ApprovalRequest.status = APPROVED
   ↓
3. Agreement.status = PENDING → APPROVED
   ↓
4. Budget Reservation Created (BudgetTransaction)
   ├─ Find BudgetEnvelope (channel/category/period match)
   ├─ Validate: envelope.available >= cap_total_amount
   │   (computed via v_budget_summary view)
   ├─ Create BudgetTransaction (RESERVE)
   │   - tx_type = 'RESERVE'
   │   - tx_status = 'POSTED' (immediate)
   │   - source_type = 'AGREEMENT'
   │   - source_id = Agreement.id
   │   - amount = Agreement.cap_total_amount
   │   - envelope_id = matched envelope
   │   - idempotency_key = 'RESERVE|AGREEMENT|{agreement_id}|{envelope_id}'
   ├─ BudgetEnvelope state updated (via v_budget_summary view)
   │   - reserved computed from transactions
   │   - available computed: allocated - reserved - consumed
   └─ Update Agreement
       - status = APPROVED
       - approved_at = now()
       - approved_by_id = approver.id
```

**Budget Impact:**
- ✅ **Budget Reserved**
- `BudgetTransaction` (RESERVE) created in `budget_transactions` table
- `envelope.reserved` increases by `cap_total_amount` (computed via v_budget_summary)
- `envelope.available` decreases by `cap_total_amount` (computed)
- Budget is locked for this Agreement
- Other agreements cannot use this reserved budget

**Agreement Impact:**
- Agreement status: `APPROVED`
- Agreement can proceed to `ACTIVE` when start_date reached
- Budget reservation prevents over-commitment

### On Rejection

**Agreement Rejection Flow:**
```
1. Approver rejects Agreement
   ↓
2. ApprovalRequest.status = REJECTED
   ↓
3. Agreement.status = PENDING → REJECTED
   ↓
4. No Budget Reservation Created
   ├─ No BudgetTransaction (RESERVE) created
   ├─ BudgetEnvelope unchanged
   │   - reserved: no change (computed)
   │   - available: no change (computed)
   └─ Update Agreement
       - approval_status = REJECTED
       - rejected_at = now()
       - rejected_by_id = approver.id
       - rejection_reason = reason provided
```

**Budget Impact:**
- ❌ **No Budget Reserved**
- No `BudgetTransaction` created
- `envelope.reserved`: No change (computed)
- `envelope.available`: No change (computed)
- Budget remains available for other agreements

**Agreement Impact:**
- Agreement status: `REJECTED`
- Agreement cannot proceed
- Budget not locked
- Can be resubmitted (creates new Agreement)

### Comparison Table

| Aspect | Approval | Rejection |
|--------|----------|-----------|
| **Agreement Status** | `APPROVED` | `REJECTED` |
| **Budget Reserved** | ✅ Yes | ❌ No |
| **BudgetEnvelope Change** | `BudgetTransaction (RESERVE)` created<br>`reserved` computed (increases)<br>`available` computed (decreases) | No change |
| **BudgetTransaction (RESERVE) Created** | ✅ Yes | ❌ No |
| **Agreement Can Proceed** | ✅ Yes (to ACTIVE) | ❌ No |
| **Budget Available for Others** | ❌ No (reserved) | ✅ Yes |

---

## Reservation Calculation

### Envelope State Calculation

**Budget Envelope State (BRD Computed Approach):**
```
total_allocated = Total budget allocated to envelope (stored)
reserved = SUM(budget_transactions WHERE tx_type='RESERVE' AND tx_status='POSTED') (computed)
consumed = SUM(ledger_entries WHERE budget_envelope_id=id) (computed)
available = total_allocated - reserved - consumed (computed)

All computed via v_budget_summary view (BRD Section 3.3)
```

**Reservation Impact:**
```
Before Reservation:
  available = total_allocated - reserved - consumed
  (all computed via v_budget_summary view)

After Reservation (on approval):
  - Create BudgetTransaction (RESERVE, amount)
  - reserved_new = reserved_old + amount (computed from transactions)
  - available_new = available_old - amount (computed)

After Rejection:
  - No BudgetTransaction created
  - reserved_new = reserved_old (no change, computed)
  - available_new = available_old (no change, computed)
```

### Example Calculation

**Initial State:**
```
BudgetEnvelope: TRADITIONAL/HairCare/2026-01
  total_allocated: 100,000 TL (stored)
  reserved: 30,000 TL (computed from budget_transactions)
  consumed: 10,000 TL (computed from ledger_entries)
  available: 60,000 TL (computed: allocated - reserved - consumed)
```

**Agreement Submitted:**
```
Agreement: STA-2026-025
  cap_total_amount: 15,000 TL
  Status: PENDING
  
Envelope: No change (validation only)
  available: 60,000 TL (computed, still available)
```

**Agreement Approved:**
```
Agreement: STA-2026-025
  Status: APPROVED
  
BudgetTransaction Created:
  tx_type: 'RESERVE'
  amount: 15,000 TL
  tx_status: 'POSTED'
  
Envelope State (computed via v_budget_summary):
  reserved: 30,000 + 15,000 = 45,000 TL (computed)
  available: 60,000 - 15,000 = 45,000 TL (computed)
```

**Agreement Rejected (Alternative):**
```
Agreement: STA-2026-025
  Status: REJECTED
  
No BudgetTransaction Created
  
Envelope: No change
  reserved: 30,000 TL (unchanged, computed)
  available: 60,000 TL (unchanged, computed)
```

**Note:** All amounts are computed from `budget_transactions` and `ledger_entries` via `v_budget_summary` view. No direct updates to envelope amounts (BRD Section 3.3).

---

## Reservation Constraints (Sprint 0)

### No Concurrency Handling

**Constraint:** No concurrency handling in Sprint 0

**Implication:**
- Assumes sequential processing
- No pessimistic locking
- No optimistic locking
- No transaction isolation checks
- Simple read-update-write pattern

**Future:** Concurrency handling will be added in later sprints (MC-001).

### No Budget Overrun Logic

**Constraint:** No budget overrun logic

**Implication:**
- System validates budget availability at approval
- If insufficient: Approval fails
- No "soft overrun" or "approval required for overrun"
- Hard block: Cannot approve if insufficient budget

**Validation:**
```
if (envelope.available < agreement.cap_total_amount) {
  // available computed via v_budget_summary view
  throw new InsufficientBudgetError(
    `Insufficient budget. Available: ${available}, Required: ${required}`
  );
}
```

**Future:** Overrun logic may be added in later sprints (Finance approval for overruns).

---

## Reservation Data Model

### Conceptual Schema (BRD Event-Sourced Approach)

**BudgetTransaction Entity (RESERVE type):**
```typescript
class BudgetTransaction {
  id: UUID;
  tenantId: UUID;
  
  // Envelope Reference
  envelopeId: UUID;
  
  // Transaction Type
  txType: 'RESERVE' | 'RELEASE' | 'COMMIT' | 'TRANSFER' | 'ADJUST';
  txStatus: 'PENDING' | 'POSTED';
  
  // Source Reference
  sourceType: 'AGREEMENT' | 'PLAN' | 'MANUAL';
  sourceId: UUID;  // Agreement.id for RESERVE type
  
  // Amount
  amount: Decimal;  // = Agreement.cap_total_amount for RESERVE
  
  // Idempotency
  idempotencyKey: string;  // Format: 'RESERVE|AGREEMENT|{agreement_id}|{envelope_id}'
  
  // Audit
  createdAt: Timestamp;
  createdBy: UUID;  // User who approved
}
```

**Note:** There is NO separate `BudgetReservation` entity. Reservations are `BudgetTransaction` records with `tx_type = 'RESERVE'` (BRD Section 3.3 - Event-Sourced Approach).

**BudgetEnvelope State (BRD Compliance):**
```typescript
class BudgetEnvelope {
  // ... existing fields ...
  
  // Stored fields
  totalAllocated: Decimal;  // Total budget allocated (stored)
  
  // Computed fields (NOT stored, computed via v_budget_summary view)
  reserved: Decimal;  // SUM(budget_transactions WHERE tx_type='RESERVE' AND tx_status='POSTED')
  consumed: Decimal;  // SUM(ledger_entries WHERE budget_envelope_id=id)
  available: Decimal;  // total_allocated - reserved - consumed
}
```

**Note:** Reserved and Consumed amounts are computed from `budget_transactions` and `ledger_entries` tables via `v_budget_summary` view. They are NOT stored in `budget_envelopes` table to avoid dual-write issues and ensure consistency (BRD Section 3.3).

### Relationship Constraints (BRD Compliance)

**Unique Constraint:**
- `UNIQUE(tenant_id, idempotency_key)` - Prevents duplicate reservations
- Idempotency key format: `RESERVE|AGREEMENT|{agreement_id}|{envelope_id}`

**Foreign Keys:**
- `source_id` → `agreements.id` (when source_type = 'AGREEMENT')
- `envelope_id` → `budget_envelopes.id`

**Indexes:**
- `(tenant_id, source_id, source_type)` - Fast lookup by agreement
- `(tenant_id, envelope_id, tx_type)` - Fast lookup by envelope
- `(tenant_id, tx_type, tx_status)` - Fast lookup of active reservations

**Note:** Budget reservations are tracked via `budget_transactions` table, not a separate `budget_reservations` table (BRD Section 3.3).

---

## Reservation Workflow Integration

### Agreement Submission → Approval Flow

```
┌─────────────────────────────────────────────────────────┐
│           AGREEMENT APPROVAL & RESERVATION FLOW         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ① AGREEMENT SUBMITTED (Status: PENDING)                │
│     ├─ Agreement.status = PENDING                      │
│     ├─ Budget availability checked (validation)       │
│     └─ Budget NOT reserved                              │
│                                                         │
│  ② APPROVER REVIEWS                                     │
│     ├─ ApprovalRequest.status = PENDING                │
│     └─ Budget still available (no reservation)         │
│                                                         │
│  ③ APPROVER DECISION                                    │
│     ├─ Decision: APPROVE or REJECT                     │
│     └─ If APPROVE: Continue to step 4                    │
│     └─ If REJECT: Skip to step 6                        │
│                                                         │
│  ④ AGREEMENT APPROVED                                   │
│     ├─ ApprovalRequest.status = APPROVED               │
│     ├─ Agreement.status = PENDING → APPROVED           │
│     └─ Trigger: Budget Reservation                      │
│                                                         │
│  ⑤ BUDGET RESERVATION CREATED                          │
│     ├─ Find BudgetEnvelope (channel/category/period)   │
│     ├─ Validate: available >= cap_total_amount       │
│     │   (computed via v_budget_summary view)          │
│     ├─ Create BudgetTransaction (RESERVE)             │
│     │   - tx_type = 'RESERVE'                         │
│     │   - tx_status = 'POSTED' (immediate)            │
│     │   - source_type = 'AGREEMENT'                    │
│     │   - source_id = Agreement.id                     │
│     │   - amount = cap_total_amount                   │
│     │   - envelope_id = matched envelope              │
│     │   - idempotency_key = 'RESERVE|AGREEMENT|...'  │
│     ├─ BudgetEnvelope state updated (via view)        │
│     │   - reserved computed from transactions          │
│     │   - available computed: allocated - reserved    │
│     └─ Update Agreement                                │
│         - approved_at, approved_by_id set              │
│                                                         │
│  ⑥ AGREEMENT REJECTED (Alternative)                    │
│     ├─ ApprovalRequest.status = REJECTED               │
│     ├─ Agreement.status = PENDING → REJECTED           │
│     ├─ No Budget Reservation Created                   │
│     ├─ BudgetEnvelope: No change                      │
│     └─ Update Agreement                                │
│         - rejected_at, rejected_by_id, rejection_reason│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Error Scenarios

### Insufficient Budget at Approval

**Scenario:** Agreement approved, but budget no longer available

**Flow:**
```
1. Agreement submitted (budget available: 60,000 TL)
2. Another agreement approved (reserved 50,000 TL)
3. First agreement approval attempted
4. Available budget now: 10,000 TL
5. Required: 15,000 TL
6. Approval fails
```

**System Behavior:**
- Approval fails with error: "Insufficient budget available"
- Agreement status remains `PENDING`
- ApprovalRequest status remains `PENDING`
- No budget reservation created
- Approver notified of failure

**Error Message:**
```
"Insufficient budget available. 
 Available: 10,000 TL
 Required: 15,000 TL
 Please contact Finance to allocate additional budget."
```

### Envelope Not Found

**Scenario:** No BudgetEnvelope matches Agreement's channel/category/period

**System Behavior:**
- Approval fails with error: "No budget envelope found"
- Agreement status remains `PENDING`
- No budget reservation created
- Requires Finance to create appropriate envelope

**Error Message:**
```
"No budget envelope found for channel/category/period: 
 TRADITIONAL/HairCare/2026-01
 Please create budget envelope before approving agreement."
```

---

## Summary

### What Is Reserved
- **Amount:** Agreement's `cap_total_amount` (budget ceiling)
- **Source:** BudgetEnvelope matched by channel/category/period
- **Scope:** Full amount from single envelope

### When It Is Reserved
- **Trigger:** Agreement status transition `PENDING` → `APPROVED`
- **Timing:** Immediate, synchronous operation
- **Validation:** Budget availability checked at approval

### How Reservation Relates to Agreement
- **Relationship:** One-to-Many (each Agreement can have multiple RESERVE transactions, but typically one)
- **Entity:** BudgetTransaction with `tx_type = 'RESERVE'` links Agreement to BudgetEnvelope
- **Lifecycle:** Created on approval (immutable record), remains in history even if Agreement cancelled
- **BRD Compliance:** Event-sourced approach - reservations are transactions, not separate entities

### What Happens on Approval vs Rejection
- **Approval:** Budget reserved, envelope updated, Agreement proceeds
- **Rejection:** No reservation, envelope unchanged, Agreement blocked

### Constraints (Sprint 0)
- **No Concurrency:** Sequential processing assumed
- **No Overrun:** Hard block if insufficient budget

---

**Status:** 📝 Conceptual Design Complete  
**Last Updated:** January 2026  
**Next Review:** Before Sprint 05 (Implementation)


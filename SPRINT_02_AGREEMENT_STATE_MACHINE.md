# Sprint 02: Agreement Lifecycle & State Machine
## Actuals-First TPM System

**Purpose:** Define the complete lifecycle and state machine for Agreements (STA and LTA)  
**Status:** 📝 Definition Phase  
**Reference:** Section 4.2 - Agreement Management (BRD), Sprint 01 Domain Entities

---

## Overview

This document defines the state machine that governs Agreement lifecycle transitions in Actuals-First Mode. The state machine applies to both **STA** (Short-Term Agreement, ≤30 days) and **LTA** (Long-Term Agreement, >30 days) types.

**Key Principles:**
- All state transitions are audited
- Budget operations are tied to specific state transitions
- State transitions enforce business rules and guard conditions
- No state can be skipped (must follow valid path)

---

## State Machine Diagram

```
                    ┌─────────┐
                    │  DRAFT  │
                    └────┬────┘
                         │ submit()
                         ↓
                    ┌─────────┐
                    │ PENDING │
                    └────┬────┘
                         │
            ┌────────────┼────────────┐
            │                          │
            │ approve()                │ reject()
            ↓                          ↓
      ┌──────────┐              ┌──────────┐
      │ APPROVED │              │ REJECTED │
      └────┬─────┘              └──────────┘
           │
           │ activate() [start_date reached]
           ↓
      ┌────────┐
      │ ACTIVE │
      └────┬───┘
           │
    ┌──────┼──────┐
    │              │
    │ close()      │ cancel()
    │ [end_date]   │ [manual]
    ↓              ↓
┌────────┐    ┌──────────┐
│ CLOSED │    │CANCELLED │
└────────┘    └──────────┘
```

---

## State Definitions

### 1. DRAFT

**Purpose:** Initial state when an agreement is being created by a Planner. The agreement is not yet submitted for approval and can be freely edited.

**Characteristics:**
- Agreement exists in the system but is not yet active
- All fields can be modified
- No budget impact
- No approval workflow initiated
- Can be saved and edited multiple times
- Can be deleted (soft delete)

**Who Can Access:**
- Creator (Planner who created it)
- Admin (can view/edit any draft)
- Other users: No access

**Business Rules:**
- Agreement must pass validation before submission
- Required fields: CPL, FU, Tactic, Mechanic, Start Date, End Date, Cap Amount, Justification
- STA duration validation: Must be ≤30 days
- Budget availability check: System validates but doesn't reserve

**Budget Impact:** ❌ **NO BUDGET IMPACT**
- No budget reservation
- No budget consumption
- Budget availability is checked for validation only

**Next Possible States:**
- `SUBMITTED` (via `submit()` action)
- `DELETED` (via `delete()` action - soft delete)

---

### 2. PENDING

**Purpose:** Agreement has been submitted for approval and is awaiting approval workflow completion. The agreement is locked from editing (except by Admin).

**Characteristics:**
- Agreement submitted for approval
- Approval workflow initiated
- Cannot be edited (except by Admin with override)
- Budget not yet reserved
- Awaiting approver decisions
- Can be cancelled by creator (before any approvals)

**Who Can Access:**
- Creator (read-only, can cancel)
- Approvers (can approve/reject)
- Admin (can view/edit/cancel)

**Business Rules:**
- Cannot be edited (except Admin override)
- Can be cancelled by creator (returns to DRAFT or creates new draft)
- Approval workflow is policy-driven (based on amount, channel, tactic)
- Multi-level sequential approvals required
- Target turnaround: <24 hours

**Budget Impact:** ❌ **NO BUDGET IMPACT**
- No budget reservation yet
- Budget availability was checked during submission
- Budget remains available for other agreements

**Next Possible States:**
- `APPROVED` (via `approve()` action - all levels complete)
- `REJECTED` (via `reject()` action - any approver rejects)
- `DRAFT` (via `cancel()` action - creator cancels before approval)

**State Transition Details:**
- `DRAFT → PENDING`: 
  - Trigger: Planner clicks "Submit for Approval"
  - Guard: All required fields valid, budget available, justification provided
  - Action: Create ApprovalRequest, notify first approver
  - Budget: No change

---

### 3. APPROVED

**Purpose:** All required approval levels have been completed. The agreement is approved and ready for execution. Budget is reserved at this point.

**Characteristics:**
- All approval levels completed
- Budget reserved (BudgetTransaction.RESERVE created)
- Ready for execution
- Cannot be edited (except Admin override)
- Can transition to ACTIVE when start_date reached
- Can be cancelled by Admin/Finance (releases budget)

**Who Can Access:**
- Creator (read-only)
- Admin/Finance (can view/cancel)
- All users (read-only for reporting)

**Business Rules:**
- Budget is reserved (cannot be used by other agreements)
- Agreement terms are locked
- Can be cancelled by Admin/Finance (releases budget)
- Automatic transition to ACTIVE when start_date reached
- Can manually activate if start_date is in the past

**Budget Impact:** ✅ **BUDGET RESERVED**
- **BudgetTransaction.RESERVE** created
- Amount: `agreement.cap_total_amount`
- Envelope: Matched via channel/category/period
- Status: POSTED immediately
- Effect: `envelope.reserved_amount += cap_total_amount`
- Effect: `envelope.available_amount -= cap_total_amount`

**Next Possible States:**
- `ACTIVE` (via `activate()` action - automatic when start_date reached)
- `DRAFT` (via `cancel()` action - Admin/Finance cancels, releases budget)

**State Transition Details:**
- `PENDING → APPROVED`:
  - Trigger: Last required approver approves
  - Guard: All approval levels complete, cannot be self-approval (EA-001)
  - Action: Create BudgetTransaction.RESERVE, update agreement status
  - Budget: **RESERVE budget** (see above)

---

### 4. REJECTED

**Purpose:** Agreement approval was denied by an approver. The agreement cannot proceed and budget is not reserved.

**Characteristics:**
- Approval denied at any level
- Budget not reserved
- Cannot be edited (except Admin override)
- Can be resubmitted (creates new agreement)
- Rejection reason recorded
- Historical record maintained

**Who Can Access:**
- Creator (read-only, can create new agreement)
- Approver who rejected (read-only)
- Admin (can view/edit)

**Business Rules:**
- Rejection reason is mandatory
- Cannot be resubmitted (must create new agreement)
- Budget remains available
- Historical record for audit

**Budget Impact:** ❌ **NO BUDGET IMPACT**
- No budget reservation
- Budget remains available

**Next Possible States:**
- `DRAFT` (via `resubmit()` action - creates new agreement, not state change)
- No other transitions (terminal state for this agreement)

**State Transition Details:**
- `PENDING → REJECTED`:
  - Trigger: Any approver rejects
  - Guard: Approver has APPROVER or ADMIN role
  - Action: Record rejection reason, notify creator
  - Budget: No change

---

### 5. ACTIVE

**Purpose:** Agreement is in effect and promotion is running. Transactions are posting to the ledger and budget is being consumed.

**Characteristics:**
- Agreement in effect (start_date reached)
- Promotion running
- Transactions posting to ledger
- Budget being consumed
- Cannot be edited (except Admin override)
- Can be manually closed or terminated

**Who Can Access:**
- Creator (read-only)
- Admin/Finance (can view/close/terminate)
- All users (read-only for reporting)

**Business Rules:**
- Transactions can be posted (Off-Invoice entries, Ledger entries)
- Budget consumption tracked in real-time
- Can be manually closed if end_date not reached
- Can be terminated early (requires Admin/Finance)
- Automatic transition to CLOSED when end_date reached

**Budget Impact:** ✅ **BUDGET CONSUMED**
- Budget was already reserved in APPROVED state
- Budget consumption occurs via LedgerEntry creation
- Each transaction: `envelope.consumed_amount += transaction.amount`
- Each transaction: `envelope.available_amount -= transaction.amount`
- Agreement: `consumed_amount` updated (sum of all ledger entries)

**Next Possible States:**
- `CLOSED` (via `close()` action - automatic when end_date reached OR manual)
- `TERMINATED` (via `terminate()` action - Admin/Finance terminates early)

**State Transition Details:**
- `APPROVED → ACTIVE`:
  - Trigger: Automatic when `start_date` reached OR manual activation
  - Guard: Agreement is APPROVED, start_date is today or past
  - Action: Update status to ACTIVE, enable transaction posting
  - Budget: No change (already reserved)

---

### 6. CLOSED

**Purpose:** Agreement has reached its end date or was manually closed. This is the final state for completed agreements. No further transactions can be posted.

**Characteristics:**
- End date reached or manually closed
- Final state, no further transactions
- Historical record
- Budget consumption complete
- Read-only

**Who Can Access:**
- All users (read-only)

**Business Rules:**
- No new transactions can be posted
- Historical transactions remain
- Budget consumption is final
- Can be archived for reporting

**Budget Impact:** ✅ **BUDGET CONSUMED (FINAL)**
- Budget consumption is complete
- Reserved budget may be fully consumed or partially consumed
- No further budget impact

**Next Possible States:**
- None (terminal state)

**State Transition Details:**
- `ACTIVE → CLOSED`:
  - Trigger: Automatic when `end_date` reached OR manual close by Admin/Finance
  - Guard: Agreement is ACTIVE
  - Action: Update status to CLOSED, disable transaction posting
  - Budget: No change (consumption already occurred)

---

### 7. CANCELLED

**Purpose:** Agreement was cancelled early before its end date. This is an exceptional state requiring Admin/Finance intervention.

**Characteristics:**
- Agreement cancelled early (before end_date)
- Requires Admin or Finance role
- Remaining budget released
- Cancellation reason recorded
- Historical record maintained

**Who Can Access:**
- Admin/Finance (can view)
- Creator (read-only)
- All users (read-only for reporting)

**Business Rules:**
- Cancellation reason is mandatory
- Remaining reserved budget is released
- No further transactions can be posted
- Historical transactions remain

**Budget Impact:** ✅ **BUDGET RELEASED**
- **BudgetTransaction.RELEASE** created
- Amount: `cap_total_amount - consumed_amount` (remaining reserved)
- Effect: `envelope.reserved_amount -= remaining_amount`
- Effect: `envelope.available_amount += remaining_amount`

**Next Possible States:**
- None (terminal state)

**State Transition Details:**
- `ACTIVE → CANCELLED`:
  - Trigger: Admin/Finance cancels early
  - Guard: Agreement is ACTIVE, user has ADMIN or FINANCE role
  - Action: Create BudgetTransaction.RELEASE for remaining budget, update status
  - Budget: **RELEASE remaining reserved budget** (see above)

---

## State Transition Summary

### Complete Transition List

| From State | To State | Action | Triggered By | Budget Impact |
|------------|----------|--------|--------------|---------------|
| DRAFT | PENDING | `submit()` | Planner | ❌ None |
| PENDING | APPROVED | `approve()` | Approver (all levels) | ✅ **RESERVE** |
| PENDING | REJECTED | `reject()` | Approver | ❌ None |
| PENDING | DRAFT | `cancel()` | Creator | ❌ None |
| APPROVED | ACTIVE | `activate()` | System (start_date) or Manual | ❌ None (already reserved) |
| APPROVED | DRAFT | `cancel()` | Admin/Finance | ✅ **RELEASE** |
| ACTIVE | CLOSED | `close()` | System (end_date) or Manual | ❌ None (consumption complete) |
| ACTIVE | CANCELLED | `cancel()` | Admin/Finance | ✅ **RELEASE** remaining |

### Budget-Affecting Transitions

**Transitions that CREATE budget transactions:**

1. **PENDING → APPROVED**
   - Creates: `BudgetTransaction.RESERVE`
   - Amount: `agreement.cap_total_amount`
   - Effect: Reserves budget

2. **APPROVED → DRAFT** (cancellation)
   - Creates: `BudgetTransaction.RELEASE`
   - Amount: `agreement.cap_total_amount`
   - Effect: Releases reserved budget

3. **ACTIVE → CANCELLED**
   - Creates: `BudgetTransaction.RELEASE`
   - Amount: `cap_total_amount - consumed_amount` (remaining)
   - Effect: Releases remaining reserved budget

**Transitions that CONSUME budget:**

- Budget consumption occurs **during ACTIVE state** via LedgerEntry creation
- Not a state transition, but a continuous process
- Each Off-Invoice entry or transaction creates a LedgerEntry
- LedgerEntry links to BudgetEnvelope and consumes budget

---

## Guard Conditions

### Submit (DRAFT → SUBMITTED)

**Required:**
- User role: PLANNER or ADMIN
- All required fields valid
- Budget availability check passes
- Justification provided (min 20 chars)
- STA duration ≤30 days (if STA type)

**Validation:**
- CPL exists and is ACTIVE
- FU exists and is ACTIVE
- Tactic and Mechanic valid
- Start date < End date
- Cap amount > 0

### Approve (PENDING → APPROVED)

**Required:**
- User role: APPROVER or ADMIN
- Cannot be self-approval (EA-001): `approver_id != agreement.created_by`
- All approval levels completed
- Approval policy matched

**Validation:**
- Agreement status is PENDING
- Approval request exists
- All previous approval levels completed

### Reject (PENDING → REJECTED)

**Required:**
- User role: APPROVER or ADMIN
- Rejection reason provided (mandatory)

**Validation:**
- Agreement status is PENDING
- Approval request exists
- User is assigned approver for current level

### Activate (APPROVED → ACTIVE)

**Required:**
- Agreement status is APPROVED
- Start date is today or in the past
- Budget reservation exists (BudgetTransaction.RESERVE)

**Validation:**
- Automatic when start_date reached
- Can be manually triggered by Admin/Finance

### Close (ACTIVE → CLOSED)

**Required:**
- Agreement status is ACTIVE
- End date reached OR manual close by Admin/Finance

**Validation:**
- Automatic when end_date reached
- Manual close requires ADMIN or FINANCE role

### Cancel (ACTIVE → CANCELLED)

**Required:**
- User role: ADMIN or FINANCE
- Cancellation reason provided (mandatory)
- Agreement status is ACTIVE

**Validation:**
- End date not yet reached
- Agreement has remaining reserved budget

---

## State-Specific Behaviors

### STA vs LTA Differences

**STA (Short-Term Agreement, ≤30 days):**
- Fast approval (1-2 levels typically)
- Immediate consumption (consumed as spend occurs)
- Simple justification required
- Price simulation available
- Typically single period

**LTA (Long-Term Agreement, >30 days):**
- Multi-level approval (including Finance pre-approval)
- Periodic consumption (monthly/quarterly settlements)
- Detailed contractual terms
- Higher budget thresholds
- Multi-period tracking

**State Machine:** Same for both STA and LTA
**Differences:** Approval policy, consumption pattern, not state transitions

---

## Error Handling

### Invalid State Transitions

**System Behavior:**
- Invalid transitions are rejected with error message
- Current state is preserved
- User is notified of the error

**Common Errors:**
- Attempting to submit invalid agreement → Validation errors returned
- Attempting to approve already approved agreement → "Already approved" error
- Attempting to activate before start_date → "Start date not reached" error
- Attempting to close terminated agreement → "Already terminated" error

### Budget Unavailable

**Scenario:** Agreement submitted but budget becomes unavailable before approval

**System Behavior:**
- Budget check occurs at submission (validation only)
- Budget check occurs at approval (reservation)
- If budget unavailable at approval: Approval fails, agreement remains SUBMITTED
- Approver notified: "Insufficient budget available"

---

## Audit Trail

### State Change Logging

**Every state transition records:**
- Previous state
- New state
- Transition action
- User who triggered transition
- Timestamp
- Additional context (rejection reason, termination reason, etc.)

**Audit Fields:**
- `status` (current state)
- `status_changed_at` (timestamp)
- `status_changed_by` (user ID)
- `previous_status` (for history)
- `status_change_reason` (optional)

---

## Implementation Notes

### State Enum

```typescript
enum AgreementStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  TERMINATED = 'TERMINATED',
}
```

### State Transition Service

**Responsibilities:**
- Validate guard conditions
- Execute state transition
- Create budget transactions (when applicable)
- Update approval workflow
- Send notifications
- Log audit trail

### Database Considerations

**State Storage:**
- `status` column (enum type)
- `status_changed_at` timestamp
- `status_changed_by` user reference
- `previous_status` (optional, for history)

**Indexes:**
- Index on `status` for filtering
- Index on `status_changed_at` for reporting
- Composite index on `tenant_id, status` for multi-tenant queries

---

## Summary

### States (7 total)
1. **DRAFT** - Being created, editable
2. **PENDING** - Awaiting approval
3. **APPROVED** - Approved, budget reserved
4. **REJECTED** - Approval denied
5. **ACTIVE** - Running, consuming budget
6. **CLOSED** - Completed normally
7. **CANCELLED** - Cancelled early

### Budget-Affecting Transitions (3)
1. **PENDING → APPROVED**: Reserves budget
2. **APPROVED → DRAFT** (cancel): Releases budget
3. **ACTIVE → CANCELLED**: Releases remaining budget

### Terminal States (3)
- **REJECTED**: Cannot proceed
- **CLOSED**: Completed normally
- **CANCELLED**: Cancelled early

---

**Status:** 📝 Definition Complete  
**Last Updated:** January 2026  
**Next Review:** Before Sprint 03 (Implementation)


# Sprint 01: Core Domain Entities Definition
## Actuals-First TPM System

**Purpose:** Define the core domain entities for an Actuals-First TPM system  
**Status:** 📝 Definition Phase  
**Reference:** Section 4 - Actuals-First Mode (BRD)

---

## Overview

This document defines the core domain entities required for the Actuals-First TPM system. Each entity includes:
- **Purpose**: Why this entity exists
- **Key Fields**: Essential attributes (not full schema)
- **Relationships**: How it connects to other entities
- **Lifecycle States**: State transitions and status values

**Note:** This is a definition document, not implementation code. Implementation will follow in subsequent sprints.

---

## 1. Agreement (STA / LTA)

### Purpose

Agreement is the **core commercial contract** that captures promotional deal terms in Actuals-First Mode. It represents the binding commitment between the company and a customer (CPL) for promotional support. Agreements are created reactively in response to market events, opportunities, or customer requests.

**Key Characteristics:**
- Two types: **STA** (Short-Term Agreement, ≤30 days) and **LTA** (Long-Term Agreement, >30 days)
- Created by Planners in response to market events
- Requires approval before execution
- Reserves budget upon approval
- Tracks actual spend as transactions occur
- Serves as source-of-truth for spend attribution

### Key Fields

**Identification:**
- `agreement_code` (e.g., "STA-2026-025", "LTA-2026-GS-001")
- `agreement_name` (descriptive name)
- `agreement_type` (STA | LTA)

**Customer & Scope:**
- `cpl_id` (Customer/CPL reference)
- `channel` (TRADITIONAL, NKA, MT, WHOLESALE, PROFESSIONAL)
- `region_id` (optional geographic scope)

**Product Scope:**
- `fu_id` (Forecasting Unit - required)
- `gu_id` (Generic Unit - optional)
- `sku_scope` (FU | GU | SKU | ALL)

**Tactic & Mechanic:**
- `tactic_id` (e.g., Competitive Response, Turnover Rebate)
- `mechanic_id` (e.g., Off-Invoice Rebate, % Discount)
- `mechanic_value` (amount or percentage)
- `mechanic_type` (PERCENT | AMOUNT | AMOUNT_PER_UNIT)

**Financial Terms:**
- `cap_total_amount` (budget ceiling for this agreement)
- `currency` (default: TRY)
- `spend_type` (ON_INVOICE | OFF_INVOICE | BOTH)

**Period:**
- `start_date` (agreement start)
- `end_date` (agreement end)
- `period_month` (YYYY-MM for budget tracking)

**Justification:**
- `justification` (mandatory business rationale - min 20 chars)

**Status & Approval:**
- `status` (lifecycle state - see below)
- `approval_request_id` (links to approval workflow)
- `approved_at`, `approved_by`

**Budget Tracking:**
- `consumed_amount` (sum of all ledger entries linked to this agreement)

**Price Simulation (STA only):**
- `current_price` (SKU price at agreement creation)
- `expected_price` (simulated price after support)
- `competitor_price` (optional benchmark)
- `competitor_name` (optional)

### Relationships

**To Other Entities:**
- **Many-to-One** → `Customer` (CPL) via `cpl_id`
- **Many-to-One** → `ForecastingUnit` (FU) via `fu_id`
- **Many-to-One** → `GenericUnit` (GU) via `gu_id` (optional)
- **Many-to-One** → `Tactic` via `tactic_id`
- **Many-to-One** → `Mechanic` via `mechanic_id`
- **One-to-One** → `ApprovalRequest` via `approval_request_id`
- **One-to-Many** → `BudgetTransaction` (RESERVE type)
- **One-to-Many** → `OffInvoiceEntry` (off-invoice transactions)
- **One-to-Many** → `LedgerEntry` (all spend transactions)

**To Budget:**
- Links to `BudgetEnvelope` via channel/category/period matching
- Creates `BudgetTransaction` (RESERVE) upon approval

### Lifecycle States

**State Machine:**
```
DRAFT → PENDING → APPROVED → ACTIVE → CLOSED
DRAFT → PENDING → REJECTED
ACTIVE → CANCELLED
```

**State Definitions:**

1. **DRAFT**
   - Agreement being created by Planner
   - Validation in progress
   - Can be edited freely
   - Not yet submitted for approval

2. **PENDING**
   - Agreement submitted for approval
   - Awaiting approval workflow completion
   - Cannot be edited (except by Admin)
   - Budget not yet reserved

3. **APPROVED**
   - All approval levels completed
   - Budget reserved (BudgetTransaction.RESERVE created)
   - Ready for execution
   - Can transition to ACTIVE when start_date reached

4. **ACTIVE**
   - Agreement in effect (start_date reached)
   - Promotion running
   - Transactions posting to ledger
   - Budget being consumed

5. **CLOSED**
   - End date reached or manually closed
   - Final state, no further transactions
   - Historical record

6. **REJECTED**
   - Approval denied by approver
   - Budget not reserved
   - Can be resubmitted (creates new agreement)

7. **CANCELLED**
   - Agreement cancelled early (before end_date)
   - Requires Admin or Finance role
   - Remaining budget released

**State Transitions:**

- `DRAFT → PENDING`: Planner submits for approval
- `PENDING → APPROVED`: All approval levels completed
- `PENDING → REJECTED`: Any approver rejects
- `APPROVED → ACTIVE`: Automatic when start_date reached
- `ACTIVE → CLOSED`: Automatic when end_date reached OR manual close
- `ACTIVE → CANCELLED`: Admin/Finance cancels early

**Guard Conditions:**
- Submit: Requires PLANNER role, budget availability checked
- Approve: Requires APPROVER role, cannot be self-approval (EA-001)
- Reject: Requires APPROVER role
- Activate: Automatic when start_date reached
- Close: Automatic when end_date reached OR manual by Admin/Finance
- Cancel: Requires ADMIN or FINANCE role

---

## 2. Approval

### Purpose

Approval represents the **multi-level approval workflow** that governs spend-affecting actions in Actuals-First Mode. Every agreement and significant budget action requires approval before execution. The approval system ensures governance, budget control, and audit compliance.

**Key Characteristics:**
- Policy-driven (approval rules based on amount, channel, tactic)
- Multi-level sequential approvals
- Cannot be self-approval (EA-001)
- Target turnaround: <24 hours
- Creates audit trail for all decisions

### Key Fields

**Identification:**
- `approval_request_id` (unique identifier)
- `request_type` (AGREEMENT | BUDGET_TRANSFER | IMPORT_BATCH | OTHER)

**Request Details:**
- `entity_type` (AGREEMENT, BUDGET_TRANSFER, IMPORT_BATCH)
- `entity_id` (reference to the entity being approved)
- `requested_by_id` (user who initiated)
- `requested_at` (timestamp)

**Policy & Routing:**
- `approval_policy_id` (which policy matched)
- `approval_levels` (JSON array of required approval steps)
- `current_level` (which step is currently active)

**Status:**
- `status` (lifecycle state - see below)
- `approved_at` (when all levels completed)
- `rejected_at` (when rejected)
- `rejected_by_id` (who rejected)
- `rejection_reason` (why rejected)

**Approval Steps:**
- `steps` (JSON array of individual approval decisions)
  - Each step: `level`, `role`, `approver_id`, `status`, `approved_at`, `comment`

**Metadata:**
- `total_amount` (for amount-based routing)
- `priority` (NORMAL | HIGH | URGENT)
- `due_date` (target completion date)

### Relationships

**To Other Entities:**
- **One-to-One** → `Agreement` (via `entity_id` when `entity_type = AGREEMENT`)
- **One-to-One** → `ImportBatch` (via `entity_id` when `entity_type = IMPORT_BATCH`)
- **One-to-Many** → `ApprovalStep` (individual approval decisions)
- **Many-to-One** → `User` (requested_by, rejected_by)
- **Many-to-One** → `ApprovalPolicy` (policy that matched)

**To Users:**
- Links to approvers via `approval_steps.approver_id`
- Notifications sent to approvers

### Lifecycle States

**State Machine:**
```
PENDING → IN_PROGRESS → APPROVED
PENDING → IN_PROGRESS → REJECTED
PENDING → CANCELLED
```

**State Definitions:**

1. **PENDING**
   - Approval request created
   - Awaiting first approver action
   - No approvals yet received

2. **IN_PROGRESS**
   - At least one approval step completed
   - Awaiting remaining approval levels
   - Sequential processing (one level at a time)

3. **APPROVED**
   - All required approval levels completed
   - Entity can proceed (agreement becomes APPROVED, batch can post)
   - Budget reserved (if applicable)

4. **REJECTED**
   - Any approver rejects at any level
   - Entity cannot proceed
   - Budget not reserved (if applicable)
   - Can be resubmitted (creates new approval request)

5. **CANCELLED**
   - Request cancelled by requester (before any approvals)
   - Only possible in PENDING state

**State Transitions:**

- `PENDING → IN_PROGRESS`: First approver approves
- `IN_PROGRESS → APPROVED`: Last required approver approves
- `IN_PROGRESS → REJECTED`: Any approver rejects
- `PENDING → CANCELLED`: Requester cancels

**Approval Levels:**

Each approval request has multiple levels (steps) that must be completed sequentially:

**Example (STA - Traditional Trade, 15,000 TL):**
```
Level 1: REGIONAL_MANAGER (required for all STAs)
  - Status: APPROVED
  - Approver: Mehmet Kaya
  - Approved at: 2026-01-08 14:15

Level 2: FINANCE (required when amount ≥ 10,000 TL)
  - Status: APPROVED
  - Approver: Ahmet Yıldız
  - Approved at: 2026-01-08 16:00

Final Status: APPROVED (all levels complete)
```

**Guard Conditions:**
- Approve: Requires APPROVER or ADMIN role, cannot be self-approval (EA-001)
- Reject: Requires APPROVER or ADMIN role
- Cancel: Only requester can cancel, must be PENDING state

---

## 3. Budget Envelope

### Purpose

Budget Envelope represents a **budget allocation container** for a specific channel, category, and period. It tracks allocated budget, reserved budget, and consumed budget, providing real-time visibility into budget utilization.

**Key Characteristics:**
- Allocated at fiscal year/period level
- Tracks: Allocated, Reserved, Consumed, Available
- Available = Allocated - Reserved - Consumed
- Links to agreements via channel/category/period matching
- Supports budget alerts (80%, 90%, 100% thresholds)

### Key Fields

**Identification:**
- `code` (e.g., "NKA/Hair/Jan" or "TRADITIONAL/PersonalCare/2026-01")
- `name` (descriptive name)

**Period:**
- `fiscal_year` (e.g., "2024")
- `period` (e.g., "Jan", "Q1", "2024", "2026-01")

**Budget Amounts:**
- `total_allocated` (total budget allocated - stored in envelope)
- `reserved` (computed from `budget_transactions` where tx_type = 'RESERVE' - NOT stored)
- `consumed` (computed from `ledger_entries` - NOT stored)
- `available` (computed: Allocated - Reserved - Consumed - NOT stored)

**Note (BRD Compliance):** Reserved and Consumed amounts are **NOT stored** in budget_envelopes table. They are computed from `budget_transactions` and `ledger_entries` via `v_budget_summary` view. This eliminates dual-write issues and ensures consistency.

**Status:**
- `status` (lifecycle state - see below)

**Ownership:**
- `budget_owner_id` (user responsible)
- `budget_owner_email`, `budget_owner_name`

**Metadata:**
- `currency` (default: TRY)
- `description` (optional notes)
- `metadata` (JSONB for additional attributes)

### Relationships

**To Other Entities:**
- **Many-to-One** → `Tenant` (via `tenant_id`)
- **One-to-Many** → `BudgetTransaction` (all transactions affecting this envelope - RESERVE, RELEASE, etc.)
- **One-to-Many** → `LedgerEntry` (consumed budget entries)

**Note (BRD Compliance):** There is NO separate `BudgetReservation` entity. Budget reservations are represented as `BudgetTransaction` records with `tx_type = 'RESERVE'`. This follows the event-sourced approach defined in BRD Section 3.3.

**To Agreements:**
- Agreements link to envelopes via channel/category/period matching (not direct FK)

### Lifecycle States

**State Machine:**
```
DRAFT → ACTIVE → CLOSED → ARCHIVED
DRAFT → ACTIVE → CLOSED
```

**State Definitions:**

1. **DRAFT**
   - Envelope created but not yet active
   - Cannot accept reservations
   - Can be edited

2. **ACTIVE**
   - Envelope available for reservations
   - Agreements can reserve budget
   - Real-time tracking enabled

3. **CLOSED**
   - Envelope closed (no new reservations)
   - Existing reservations continue
   - Read-only for new agreements

4. **ARCHIVED**
   - Envelope archived (historical data)
   - Read-only
   - For reporting only

**State Transitions:**

- `DRAFT → ACTIVE`: Admin/Finance activates
- `ACTIVE → CLOSED`: Admin/Finance closes (no pending reservations)
- `CLOSED → ARCHIVED`: Admin archives (must be CLOSED)

**Guard Conditions:**
- Activate: Requires ADMIN or FINANCE role
- Close: Requires ADMIN or FINANCE role, no pending reservations
- Archive: Requires ADMIN role, must be CLOSED

---

## 4. Budget Transaction

### Purpose

Budget Transaction represents an **individual budget movement event** that affects a budget envelope. It provides an event-sourced audit trail of all budget changes (reservations, releases, transfers, adjustments).

**Key Characteristics:**
- Event-sourced (immutable records)
- Types: RESERVE, RELEASE, CONSUME, TRANSFER, ADJUSTMENT
- Links to source entity (Agreement, Manual Adjustment, etc.)
- Idempotency keys prevent duplicates
- Used to compute envelope state (Reserved, Consumed)

### Key Fields

**Identification:**
- `transaction_id` (unique identifier)
- `transaction_type` (RESERVE | RELEASE | CONSUME | TRANSFER | ADJUSTMENT)
- `transaction_status` (POSTED | PENDING | CANCELLED)

**Envelope:**
- `envelope_id` (which envelope affected)
- `amount` (transaction amount)
- `currency` (default: TRY)

**Source:**
- `source_type` (AGREEMENT | MANUAL | TRANSFER | ADJUSTMENT)
- `source_id` (reference to source entity)
- `source_reference` (e.g., agreement_code)

**Timing:**
- `transaction_date` (when transaction occurred)
- `effective_date` (when it takes effect)

**Idempotency:**
- `idempotency_key` (prevents duplicate transactions)
- Format: `{source_type}|{source_id}|{envelope_id}|{unique_suffix}`

**Metadata:**
- `description` (human-readable description)
- `notes` (optional notes)
- `metadata` (JSONB for additional context)

### Relationships

**To Other Entities:**
- **Many-to-One** → `BudgetEnvelope` (via `envelope_id`)
- **Many-to-One** → `Agreement` (via `source_id` when `source_type = AGREEMENT`)
- **Many-to-One** → `User` (created_by, for manual transactions)

**Transaction Types (BRD Section 3.3):**

1. **RESERVE**
   - Created when agreement approved
   - Amount: `agreement.cap_total_amount`
   - Status: POSTED immediately
   - Increases envelope.reserved (computed via v_budget_summary)

2. **RELEASE**
   - Created when agreement cancelled/terminated
   - Amount: released reserved amount
   - Decreases envelope.reserved (computed via v_budget_summary)

3. **COMMIT**
   - Planning-First: Plan approved (reserve budget)
   - Not used in Actuals-First Mode

4. **TRANSFER**
   - Manual budget movement between envelopes
   - Requires Finance approval
   - Two transactions: DEBIT from source, CREDIT to target

5. **ADJUST**
   - Manual budget correction
   - Requires Finance approval
   - Can increase or decrease allocated_amount

**Note (BRD Compliance):** There is NO `CONSUME` transaction type. Budget consumption is tracked via `ledger_entries.budget_envelope_id`. Consumed amount is computed from `ledger_entries` table via `v_budget_summary` view (BRD Section 3.3).

### Lifecycle States

**State Machine:**
```
PENDING → POSTED
PENDING → CANCELLED
```

**State Definitions:**

1. **PENDING**
   - Transaction created but not yet applied
   - Used for manual transactions requiring approval

2. **POSTED**
   - Transaction applied to envelope
   - Envelope amounts updated
   - Immutable (cannot be modified)

3. **CANCELLED**
   - Transaction cancelled before posting
   - Only possible in PENDING state

**State Transitions:**

- `PENDING → POSTED`: Transaction approved and applied
- `PENDING → CANCELLED`: Transaction cancelled

**Note:** Most transactions (RESERVE from agreement approval) are POSTED immediately. Only manual transactions (TRANSFER, ADJUSTMENT) may be PENDING awaiting approval.

---

## 5. Agreement Transaction (Off-Invoice Entry)

### Purpose

Agreement Transaction (also called Off-Invoice Entry) represents a **promotional allowance transaction** paid after the invoice, typically through price difference invoices, rebate settlements, display fees, or listing fees. These transactions are imported in batches and linked to agreements.

**Key Characteristics:**
- Batch import capability (40-50 invoices in <5 minutes) - Phase 1
- Single entry capability (Sprint 0)
- Links to approved Agreements (STA or LTA)
- Requires approval before ledger posting (Phase 1)
- Idempotency at file and invoice level
- Automatic ledger posting upon approval

**BRD Compliance Note:** BRD uses `agreement_transactions` table name. Entity can be named `AgreementTransaction` or `OffInvoiceEntry` (both refer to same concept).

### Key Fields

**Identification:**
- `entry_id` (unique identifier)
- `invoice_no` (customer invoice number)
- `invoice_date` (date of invoice)

**Agreement Link:**
- `agreement_id` (which agreement this entry belongs to)
- `agreement_code` (for validation and display)

**Financial:**
- `amount` (invoice amount)
- `currency` (default: TRY)

**Customer:**
- `cpl_id` (customer reference)
- `cpl_code` (for validation)

**Batch:**
- `batch_id` (which import batch this entry belongs to)
- `row_number` (original row in Excel file)

**Status:**
- `status` (lifecycle state - see below)
- `validation_status` (VALID | WARNING | ERROR)
- `validation_errors` (JSON array of validation issues)

**Idempotency:**
- `idempotency_key` (prevents duplicate entries)
- Format: `{agreement_id}|{invoice_no}|{invoice_date}`

**Metadata:**
- `notes` (optional notes from import)
- `metadata` (JSONB for additional context)

### Relationships

**To Other Entities:**
- **Many-to-One** → `Agreement` (via `agreement_id`)
- **Many-to-One** → `Customer` (CPL) via `cpl_id`
- **Many-to-One** → `ImportBatch` (via `batch_id`) - Phase 1 only
- **One-to-One** → `LedgerEntry` (created when approved/posted)

**BRD Table Name:** `agreement_transactions` (BRD Section 4.3)

**To Budget:**
- Links to `BudgetEnvelope` via agreement's channel/category/period
- Creates `LedgerEntry` which consumes budget

### Lifecycle States

**State Machine:**
```
STAGED → APPROVED → POSTED
STAGED → REJECTED
```

**State Definitions:**

1. **STAGED**
   - Entry imported from batch file
   - Validation completed
   - Awaiting batch approval
   - Not yet posted to ledger

2. **APPROVED**
   - Batch approved by Finance/Manager
   - Ready for ledger posting
   - Ledger entry will be created

3. **POSTED**
   - Ledger entry created
   - Budget consumed
   - Agreement consumed_amount updated
   - Final state (immutable)

4. **REJECTED**
   - Entry rejected (validation error or batch rejection)
   - Not posted to ledger
   - Can be corrected and re-imported

**State Transitions:**

- `STAGED → APPROVED`: Batch approved (all entries in batch)
- `STAGED → REJECTED`: Entry has validation errors or batch rejected
- `APPROVED → POSTED`: Ledger entry created (automatic upon batch approval)

**Validation Rules:**

- LTA must exist and be ACTIVE
- Invoice date within agreement period (warning if outside)
- CPL code matches agreement CPL
- Amount > 0 and valid format
- Budget cap not exceeded (warning if exceeded)
- Invoice number uniqueness (idempotency check)

---

## 6. CPL (Customer)

### Purpose

CPL (Customer/Partner Level) represents a **customer or business partner** in the TPM system. Customers are the recipients of promotional agreements and the source of spend transactions.

**Key Characteristics:**
- Multi-tenant (each tenant has own customer list)
- Channel classification (Traditional, NKA, MT, Wholesale, Professional)
- Links to agreements and transactions
- Supports hierarchical relationships (parent/child for chains)
- Tracks business metrics (annual revenue, number of branches)

### Key Fields

**Identification:**
- `code` (unique customer code within tenant)
- `name` (customer name)

**Classification:**
- `channel` (TRADITIONAL | NKA | MT | WHOLESALE | PROFESSIONAL)
- `type` (DIRECT | DISTRIBUTOR | END_CUSTOMER)
- `status` (ACTIVE | INACTIVE | SUSPENDED)

**Location:**
- `city`, `district`, `region`, `country`
- `address`, `postal_code`

**Business Information:**
- `tax_number`, `tax_office`
- `company_registration_number`
- `number_of_branches` (for chains)

**Contact:**
- `contact_person`, `contact_email`, `contact_phone`, `contact_mobile`

**Financial:**
- `annual_revenue` (optional)
- `payment_terms` (NET30, NET60, etc.)
- `credit_limit` (optional)
- `currency` (default: TRY)

**Relationships:**
- `parent_customer_id` (for chains with branches)
- `sales_representative`, `account_manager`

**Metadata:**
- `customer_group`, `customer_segment`, `customer_tier`
- `business_size` (Small, Medium, Large)
- `is_vip` (boolean flag)
- `contract_start_date`, `contract_end_date`
- `metadata` (JSONB for additional attributes)

### Relationships

**To Other Entities:**
- **Many-to-One** → `Tenant` (via `tenant_id`)
- **One-to-Many** → `Agreement` (agreements with this customer)
- **One-to-Many** → `OffInvoiceEntry` (off-invoice transactions)
- **One-to-Many** → `LedgerEntry` (all spend transactions)
- **Many-to-One** → `Customer` (parent customer, for chains)

**To Budget:**
- Links to `BudgetEnvelope` via channel (indirect)

### Lifecycle States

**State Machine:**
```
ACTIVE → INACTIVE
ACTIVE → SUSPENDED
SUSPENDED → ACTIVE
```

**State Definitions:**

1. **ACTIVE**
   - Customer active and can receive agreements
   - Default state for new customers
   - Can create agreements

2. **INACTIVE**
   - Customer inactive (no longer doing business)
   - Cannot create new agreements
   - Historical agreements remain

3. **SUSPENDED**
   - Customer temporarily suspended
   - Cannot create new agreements
   - Can be reactivated

**State Transitions:**

- `ACTIVE → INACTIVE`: Admin marks as inactive
- `ACTIVE → SUSPENDED`: Admin suspends
- `SUSPENDED → ACTIVE`: Admin reactivates

**Note:** Customer lifecycle is simpler than agreements. Status changes are administrative actions, not workflow-driven.

---

## 7. FU (Forecasting Unit)

### Purpose

FU (Forecasting Unit) represents a **product grouping level** used for promotional planning and tracking. FUs are the primary product dimension in Actuals-First Mode, as agreements are defined at FU level (not SKU level).

**Key Characteristics:**
- Product hierarchy: GU (Generic Unit) → FU (Forecasting Unit) → SKU
- Agreements reference FU (required)
- Budget tracking at FU level (via category)
- Supports multiple SKUs under one FU
- Used for spend aggregation and reporting

### Key Fields

**Identification:**
- `code` (unique FU code)
- `name` (product name, e.g., "Wella SP Shampoo 500ml")

**Hierarchy:**
- `gu_id` (parent Generic Unit)
- `category` (product category, e.g., "Hair Care", "Personal Care")
- `brand` (optional brand name)

**Product Details:**
- `description` (product description)
- `base_price` (current list price)
- `unit_of_measure` (e.g., "unit", "case", "pallet")
- `currency` (default: TRY)

**Status:**
- `status` (ACTIVE | INACTIVE | DISCONTINUED)

**Metadata:**
- `metadata` (JSONB for additional attributes)
- `tags` (array of tags for filtering)

### Relationships

**To Other Entities:**
- **Many-to-One** → `GenericUnit` (GU) via `gu_id`
- **One-to-Many** → `SKU` (SKUs under this FU)
- **One-to-Many** → `Agreement` (agreements using this FU)
- **One-to-Many** → `LedgerEntry` (spend transactions)

**To Budget:**
- Links to `BudgetEnvelope` via category (indirect)
- Category determines which budget envelope applies

### Lifecycle States

**State Machine:**
```
ACTIVE → INACTIVE
ACTIVE → DISCONTINUED
```

**State Definitions:**

1. **ACTIVE**
   - FU active and can be used in agreements
   - Default state
   - Can create agreements

2. **INACTIVE**
   - FU inactive (temporarily unavailable)
   - Cannot create new agreements
   - Historical agreements remain

3. **DISCONTINUED**
   - FU discontinued (no longer produced)
   - Cannot create new agreements
   - Historical agreements remain

**State Transitions:**

- `ACTIVE → INACTIVE`: Admin marks as inactive
- `ACTIVE → DISCONTINUED`: Admin marks as discontinued

**Note:** FU lifecycle is administrative. Status changes affect new agreement creation but not existing agreements.

---

## Entity Relationship Summary

### Core Relationships

```
Tenant
  ├─ Customer (CPL)
  │   └─ Agreement
  │       ├─ ApprovalRequest
  │       ├─ BudgetTransaction (RESERVE)
  │       ├─ OffInvoiceEntry
  │       └─ LedgerEntry
  │
  ├─ ForecastingUnit (FU)
  │   └─ Agreement
  │
  ├─ BudgetEnvelope
  │   ├─ BudgetTransaction
  │   └─ LedgerEntry
  │
  └─ User
      ├─ Agreement (created_by, approved_by)
      └─ ApprovalRequest (requested_by, approver)
```

### Key Relationships

1. **Agreement → Customer (CPL)**: Many-to-One
2. **Agreement → FU**: Many-to-One (required)
3. **Agreement → ApprovalRequest**: One-to-One
4. **Agreement → BudgetTransaction**: One-to-Many (RESERVE type)
5. **Agreement → OffInvoiceEntry**: One-to-Many
6. **Agreement → LedgerEntry**: One-to-Many
7. **OffInvoiceEntry → ImportBatch**: Many-to-One
8. **BudgetTransaction → BudgetEnvelope**: Many-to-One
9. **LedgerEntry → BudgetEnvelope**: Many-to-One

---

## Implementation Notes

### Phase 1 Scope

**Entities to Implement:**
- ✅ Agreement (STA/LTA)
- ✅ Approval (ApprovalRequest + ApprovalStep)
- ✅ Budget Envelope (already exists, enhance)
- ✅ Budget Transaction (new)
- ✅ Off-Invoice Entry (new)
- ✅ CPL (Customer - already exists, enhance)
- ✅ FU (Forecasting Unit - new)

**Deferred to Phase 2+:**
- Generic Unit (GU) - optional in Phase 1
- SKU - not required for Actuals-First
- Tactic/Mechanic master data (can be simple enums in Phase 1)

### Data Model Principles

1. **Event Sourcing**: Budget transactions are immutable events
2. **Idempotency**: All transaction-creating entities have idempotency keys
3. **Multi-Tenancy**: All entities include `tenant_id`
4. **Audit Trail**: All entities track `created_by`, `updated_by`, timestamps
5. **Soft Deletes**: Use `deleted_at` for soft deletion (BaseEntity)

### State Management

- State machines defined above
- State transitions enforced by business logic
- State history can be tracked via audit logs
- No state history table required in Phase 1

---

## Next Steps

1. **Review & Validation**
   - Review entity definitions with domain experts
   - Validate relationships and lifecycle states
   - Confirm field requirements

2. **Schema Design** (Sprint 02)
   - Design full database schema
   - Create migration scripts
   - Define indexes and constraints

3. **Entity Implementation** (Sprint 03)
   - Implement TypeORM entities
   - Add validation decorators
   - Create repository interfaces

4. **State Machine Implementation** (Sprint 04)
   - Implement state transition logic
   - Add guard conditions
   - Create state machine services

---

**Status:** 📝 Definition Complete  
**Last Updated:** January 2026  
**Next Review:** Before Sprint 02 (Schema Design)


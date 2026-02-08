# Sprint 0: Off-Invoice Flow Conceptual Design
## Actuals-First TPM System

**Purpose:** Design the Off-Invoice entry flow conceptually for Sprint 0  
**Status:** 📝 Conceptual Design Phase  
**Reference:** Section 4.3 - Off-Invoice Import & Processing (BRD), Sprint 01 Domain Entities

---

## Overview

This document defines the **Off-Invoice entry flow** for Actuals-First Mode in Sprint 0. Off-Invoice entries represent promotional allowances paid after the invoice, such as price difference invoices, rebate settlements, display fees, and listing fees.

**Key Principles (Sprint 0):**
- Off-Invoice entries only for **approved Agreements**
- **CPL-based** (Customer/Partner Level)
- **FU derived from Agreement** (not user input)
- **Single entry only** (no batch processing)
- Direct entry via form (no file upload)

**Note:** This is a simplified version for Sprint 0. Batch processing and file upload will be added in later sprints.

---

## What Is Off-Invoice

### Definition

**Off-Invoice:** Promotional allowances paid **after** the invoice has been issued. These are separate transactions from the main invoice and typically include:

- **Price difference invoices** (fiyat farkı faturası)
- **Rebate settlements** (iade/indirim faturaları)
- **Display fees** (vitrin ücretleri)
- **Listing fees** (liste ücretleri)
- **Turnover bonuses** (ciro primleri)

### Characteristics

**Timing:**
- Paid after the main invoice
- Can occur days, weeks, or months after invoice date
- Typically periodic (monthly, quarterly) for LTAs

**Purpose:**
- Track promotional spend that's not on the main invoice
- Maintain complete spend visibility
- Link to Agreements for budget tracking

---

## Required Data

### Core Fields (Mandatory)

**1. Agreement Reference**
- `agreement_id` (UUID) - **Required**
- `agreement_code` (string) - Denormalized for display (e.g., "LTA-2026-GS-001")
- **Source:** User selects from list of approved Agreements

**2. Customer (CPL)**
- `cpl_id` (UUID) - **Required**
- `cpl_code` (string) - Denormalized for validation (e.g., "GS")
- `cpl_name` (string) - Denormalized for display
- **Source:** Derived from Agreement (Agreement.cpl_id)
- **Validation:** Must match Agreement's CPL

**3. Invoice Information**
- `invoice_no` (string) - **Required** (e.g., "FF-Q1-001")
- `invoice_date` (date) - **Required** (e.g., "2026-04-05")
- **Source:** User input

**4. Financial Amount**
- `amount` (decimal) - **Required** (e.g., 7,250.00)
- `currency` (string) - **Required** (default: TRY)
- **Source:** User input

**5. Product Scope (Derived)**
- `fu_id` (UUID) - **Derived from Agreement** (not user input)
- `fu_code` (string) - Denormalized from Agreement
- `fu_name` (string) - Denormalized from Agreement
- **Source:** Agreement.fu_id (read-only, displayed for confirmation)

**6. Metadata**
- `notes` (text) - Optional (e.g., "Q1 Settlement", "Display Fee")
- **Source:** User input (optional)

### Derived Fields (Auto-Populated)

**From Agreement:**
- `channel` (string) - Agreement.channel
- `period_month` (string) - Agreement.period_month (YYYY-MM)
- `tactic_id` (UUID) - Agreement.tactic_id
- `mechanic_id` (UUID) - Agreement.mechanic_id

**From Customer (CPL):**
- `cpl_code` (string) - Customer.code
- `cpl_name` (string) - Customer.name

**Computed:**
- `idempotency_key` (string) - Format: `{agreement_id}|{invoice_no}|{invoice_date}`
- `created_at` (timestamp) - System timestamp
- `created_by` (UUID) - Current user

### Data Entry Flow

```
┌─────────────────────────────────────────────────────────┐
│         OFF-INVOICE ENTRY FORM (Sprint 0)              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ① SELECT AGREEMENT                                     │
│     ┌─────────────────────────────────────────────┐    │
│     │ Agreement: [LTA-2026-GS-001 ▼]             │    │
│     │   → Shows: Agreement Name, CPL, Status     │    │
│     └─────────────────────────────────────────────┘    │
│                                                         │
│  ② AGREEMENT DETAILS (Auto-Populated, Read-Only)       │
│     ├─ CPL: Güzellik Sarayı (GS)                      │
│     ├─ FU: Wella SP Shampoo 500ml                     │
│     ├─ Channel: Professional                          │
│     ├─ Period: 2026-01                                │
│     └─ Cap Amount: 25,000 TL                          │
│                                                         │
│  ③ INVOICE INFORMATION                                 │
│     ┌─────────────────────────────────────────────┐    │
│     │ Invoice No: [FF-Q1-001]                     │    │
│     │ Invoice Date: [05.04.2026]                 │    │
│     └─────────────────────────────────────────────┘    │
│                                                         │
│  ④ AMOUNT                                              │
│     ┌─────────────────────────────────────────────┐    │
│     │ Amount: [7,250.00] TL                       │    │
│     │ Currency: TRY (read-only)                   │    │
│     └─────────────────────────────────────────────┘    │
│                                                         │
│  ⑤ NOTES (Optional)                                    │
│     ┌─────────────────────────────────────────────┐    │
│     │ Notes: [Q1 Settlement]                      │    │
│     └─────────────────────────────────────────────┘    │
│                                                         │
│  ⑥ VALIDATION SUMMARY                                  │
│     ├─ ✅ Agreement is APPROVED                       │
│     ├─ ✅ CPL matches Agreement                        │
│     ├─ ✅ Invoice date within Agreement period        │
│     ├─ ✅ Amount > 0                                   │
│     └─ ⚠️  Cap not exceeded (7,250 / 25,000)          │
│                                                         │
│  [Submit] [Cancel]                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Validation Rules (Conceptual)

### Agreement Validation

**Rule 1: Agreement Must Exist**
- **Check:** Agreement with `agreement_id` exists
- **Error:** "Agreement not found"
- **Severity:** ERROR (blocks submission)

**Rule 2: Agreement Must Be Approved**
- **Check:** `agreement.status IN ('APPROVED', 'ACTIVE')`
- **Error:** "Agreement must be APPROVED or ACTIVE. Current status: {status}"
- **Severity:** ERROR (blocks submission)
- **Note:** Cannot create entries for DRAFT, PENDING, or REJECTED agreements

**Rule 3: Agreement Must Not Be Closed**
- **Check:** `agreement.status != 'CLOSED'`
- **Error:** "Cannot create entries for closed agreements"
- **Severity:** ERROR (blocks submission)

### Customer (CPL) Validation

**Rule 4: CPL Must Match Agreement**
- **Check:** `entry.cpl_id == agreement.cpl_id`
- **Error:** "CPL mismatch. Agreement CPL: {agreement_cpl}, Entry CPL: {entry_cpl}"
- **Severity:** ERROR (blocks submission)
- **Note:** CPL is derived from Agreement, but validation ensures data integrity

**Rule 5: CPL Must Be Active**
- **Check:** `customer.status == 'ACTIVE'`
- **Error:** "Customer is not active"
- **Severity:** ERROR (blocks submission)

### Invoice Validation

**Rule 6: Invoice Number Required**
- **Check:** `invoice_no IS NOT NULL AND invoice_no.length > 0`
- **Error:** "Invoice number is required"
- **Severity:** ERROR (blocks submission)

**Rule 7: Invoice Number Format**
- **Check:** `invoice_no` matches pattern (alphanumeric, max 100 chars)
- **Error:** "Invalid invoice number format"
- **Severity:** ERROR (blocks submission)

**Rule 8: Invoice Date Required**
- **Check:** `invoice_date IS NOT NULL`
- **Error:** "Invoice date is required"
- **Severity:** ERROR (blocks submission)

**Rule 9: Invoice Date Format**
- **Check:** `invoice_date` is valid date (YYYY-MM-DD)
- **Error:** "Invalid date format"
- **Severity:** ERROR (blocks submission)

**Rule 10: Invoice Date Not Future**
- **Check:** `invoice_date <= today()`
- **Error:** "Invoice date cannot be in the future"
- **Severity:** ERROR (blocks submission)

**Rule 11: Invoice Date Within Agreement Period (Warning)**
- **Check:** `agreement.start_date <= invoice_date <= agreement.end_date`
- **Warning:** "Invoice date outside Agreement period ({start_date} to {end_date})"
- **Severity:** WARNING (allows submission, but alerts user)
- **Note:** Some invoices may legitimately be outside period (settlements)

### Amount Validation

**Rule 12: Amount Required**
- **Check:** `amount IS NOT NULL`
- **Error:** "Amount is required"
- **Severity:** ERROR (blocks submission)

**Rule 13: Amount Must Be Positive**
- **Check:** `amount > 0`
- **Error:** "Amount must be greater than zero"
- **Severity:** ERROR (blocks submission)

**Rule 14: Amount Format**
- **Check:** `amount` is valid decimal (max 2 decimal places)
- **Error:** "Invalid amount format"
- **Severity:** ERROR (blocks submission)

**Rule 15: Amount Not Exceeding Cap (Warning)**
- **Check:** `(agreement.consumed_amount + amount) <= agreement.cap_total_amount`
- **Warning:** "Amount exceeds Agreement cap. Current: {consumed}, Adding: {amount}, Cap: {cap}"
- **Severity:** WARNING (allows submission, but alerts user)
- **Note:** In Sprint 0, warning only. No hard block.

### Idempotency Validation

**Rule 16: Duplicate Invoice Check**
- **Check:** No existing entry with same `idempotency_key`
- **Idempotency Key:** `{agreement_id}|{invoice_no}|{invoice_date}`
- **Error:** "Duplicate invoice. Invoice {invoice_no} for date {invoice_date} already exists for this Agreement"
- **Severity:** ERROR (blocks submission)
- **Note:** Prevents duplicate entries for same invoice

### FU (Forecasting Unit) Validation

**Rule 17: FU Derived from Agreement**
- **Check:** `entry.fu_id == agreement.fu_id` (system-enforced, not user input)
- **Note:** FU is read-only, derived from Agreement
- **No user input required** - automatically set from Agreement

### Currency Validation

**Rule 18: Currency Must Match Agreement**
- **Check:** `entry.currency == agreement.currency`
- **Error:** "Currency mismatch"
- **Severity:** ERROR (blocks submission)
- **Note:** Currency typically defaults to TRY

---

## Relationship to Agreement

### One-to-Many Relationship

**Agreement → Off-Invoice Entries:**
- Each Agreement can have **multiple** Off-Invoice entries
- Each Off-Invoice entry belongs to **exactly one** Agreement
- Relationship: `OffInvoiceEntry.agreement_id → Agreement.id`

**Relationship Diagram:**
```
┌─────────────┐
│  Agreement  │
│             │
│ - id        │
│ - cpl_id    │
│ - fu_id     │
│ - status    │
│ - cap_total │
│   _amount   │
│ - consumed  │
│   _amount   │
└──────┬──────┘
       │
       │ One-to-Many
       │
       ↓
┌──────────────────────┐
│ Off-Invoice Entry   │
│                      │
│ - agreement_id (FK) │
│ - cpl_id (derived)  │
│ - fu_id (derived)   │
│ - invoice_no        │
│ - invoice_date      │
│ - amount            │
└──────────────────────┘
```

### Agreement State Impact

**Agreement Status Requirements:**
- **APPROVED:** Can create entries ✅
- **ACTIVE:** Can create entries ✅
- **DRAFT:** Cannot create entries ❌
- **PENDING:** Cannot create entries ❌
- **REJECTED:** Cannot create entries ❌
- **CLOSED:** Cannot create entries ❌
- **CANCELLED:** Cannot create entries ❌

**Agreement Consumption Tracking:**
- Each Off-Invoice entry increases `agreement.consumed_amount`
- `consumed_amount = SUM(all_off_invoice_entries.amount)`
- Used to track budget utilization against `cap_total_amount`

### Data Derivation from Agreement

**Fields Automatically Set from Agreement:**
- `cpl_id` - From `Agreement.cpl_id`
- `cpl_code` - From `Customer.code` (via CPL lookup)
- `fu_id` - From `Agreement.fu_id`
- `fu_code` - From `ForecastingUnit.code` (via FU lookup)
- `channel` - From `Agreement.channel`
- `period_month` - From `Agreement.period_month`
- `tactic_id` - From `Agreement.tactic_id`
- `mechanic_id` - From `Agreement.mechanic_id`
- `currency` - From `Agreement.currency`

**User Cannot Modify:**
- All derived fields are read-only
- User only inputs: Agreement selection, Invoice No, Invoice Date, Amount, Notes

---

## Relationship to Budget

### Budget Consumption Flow

**Budget Impact:**
- Off-Invoice entries **consume budget** (not reserve)
- Budget was already **reserved** when Agreement was approved
- Entry creation **consumes** from reserved budget

**Flow:**
```
1. Agreement Approved
   ↓
2. Budget Reserved (BudgetReservation created)
   ↓
3. Off-Invoice Entry Created
   ↓
4. Budget Consumed (LedgerEntry created)
   ↓
5. Agreement.consumed_amount updated
   ↓
6. BudgetEnvelope.consumed_amount updated
```

### Budget Envelope Link

**Envelope Matching:**
- Off-Invoice entry links to BudgetEnvelope via Agreement
- Matching criteria:
  - Channel: `Agreement.channel`
  - Category: Derived from `Agreement.fu_id → FU.category`
  - Period: `Agreement.period_month` (YYYY-MM)

**Example:**
```
Agreement:
  - Channel: TRADITIONAL
  - FU Category: Hair Care
  - Period: 2026-01

Matches BudgetEnvelope:
  - Code: "TRADITIONAL/HairCare/2026-01"
```

### Budget Consumption Calculation

**Envelope State:**
```
Before Entry:
  allocated_amount: 100,000 TL
  reserved_amount: 45,000 TL
  consumed_amount: 10,000 TL
  available_amount: 45,000 TL

After Entry (7,250 TL):
  allocated_amount: 100,000 TL (unchanged)
  reserved_amount: 45,000 TL (unchanged)
  consumed_amount: 10,000 + 7,250 = 17,250 TL
  available_amount: 45,000 - 7,250 = 37,750 TL
```

**Agreement Consumption:**
```
Before Entry:
  cap_total_amount: 25,000 TL
  consumed_amount: 6,250 TL

After Entry (7,250 TL):
  cap_total_amount: 25,000 TL (unchanged)
  consumed_amount: 6,250 + 7,250 = 13,500 TL
```

### Budget Constraints (Sprint 0)

**No Overrun Blocking:**
- System validates but does not block if cap exceeded
- Warning shown if `consumed_amount + entry.amount > cap_total_amount`
- Entry can still be created (warning only)

**No Budget Availability Check:**
- Budget was already reserved at approval
- Entry creation assumes budget is available
- No additional availability check needed

---

## Entry Lifecycle (Sprint 0)

### Simple Lifecycle

**State Machine:**
```
CREATED → POSTED
```

**States:**

1. **CREATED**
   - Entry created by user
   - Validation passed
   - Ledger entry created immediately (synchronous)
   - Budget consumed immediately

2. **POSTED**
   - Ledger entry created
   - Budget consumed
   - Agreement consumed_amount updated
   - Final state (immutable)

**Note:** In Sprint 0, no approval workflow. Entry is posted immediately upon creation.

### Future: Approval Workflow

**Future State Machine (not in Sprint 0):**
```
CREATED → PENDING_APPROVAL → APPROVED → POSTED
CREATED → PENDING_APPROVAL → REJECTED
```

**Future:** Entries may require Finance approval before posting (for large amounts or batches).

---

## Entry Creation Flow

### Step-by-Step Process

```
┌─────────────────────────────────────────────────────────┐
│         OFF-INVOICE ENTRY CREATION FLOW                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ① USER SELECTS AGREEMENT                              │
│     ├─ System loads: Approved/Active agreements only   │
│     ├─ User selects: LTA-2026-GS-001                   │
│     └─ System loads Agreement details                  │
│                                                         │
│  ② SYSTEM DERIVES DATA                                 │
│     ├─ CPL: From Agreement.cpl_id                     │
│     ├─ FU: From Agreement.fu_id                        │
│     ├─ Channel: From Agreement.channel                 │
│     ├─ Period: From Agreement.period_month            │
│     └─ Tactic/Mechanic: From Agreement                 │
│                                                         │
│  ③ USER ENTERS INVOICE DATA                            │
│     ├─ Invoice No: FF-Q1-001                           │
│     ├─ Invoice Date: 2026-04-05                       │
│     ├─ Amount: 7,250.00                               │
│     └─ Notes: Q1 Settlement (optional)                 │
│                                                         │
│  ④ SYSTEM VALIDATES                                    │
│     ├─ Agreement exists and is APPROVED/ACTIVE        │
│     ├─ CPL matches Agreement                           │
│     ├─ Invoice date valid (not future)                │
│     ├─ Amount > 0                                     │
│     ├─ No duplicate (idempotency check)               │
│     └─ Warnings: Date outside period, cap exceeded    │
│                                                         │
│  ⑤ USER SUBMITS                                        │
│     ├─ Validation passes                              │
│     └─ Continue to step 6                              │
│                                                         │
│  ⑥ SYSTEM CREATES ENTRY                                │
│     ├─ Create OffInvoiceEntry record                  │
│     │   - agreement_id, cpl_id, fu_id (derived)      │
│     │   - invoice_no, invoice_date, amount            │
│     │   - idempotency_key                             │
│     ├─ Create LedgerEntry                             │
│     │   - Links to Agreement                          │
│     │   - Links to BudgetEnvelope                     │
│     │   - Amount: entry.amount                       │
│     ├─ Update Agreement                               │
│     │   - consumed_amount += entry.amount            │
│     └─ Update BudgetEnvelope                          │
│         - consumed_amount += entry.amount             │
│         - available_amount -= entry.amount            │
│                                                         │
│  ⑦ CONFIRMATION                                        │
│     ├─ Entry created successfully                     │
│     ├─ Ledger posted                                  │
│     └─ Budget consumed                                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Error Scenarios

### Agreement Not Approved

**Scenario:** User tries to create entry for PENDING agreement

**System Behavior:**
- Validation fails
- Error: "Agreement must be APPROVED or ACTIVE. Current status: PENDING"
- Entry not created

### CPL Mismatch

**Scenario:** System detects CPL mismatch (data corruption)

**System Behavior:**
- Validation fails
- Error: "CPL mismatch. Agreement CPL: GS, Entry CPL: MK"
- Entry not created

### Duplicate Invoice

**Scenario:** User tries to create entry with same invoice_no and invoice_date for same Agreement

**System Behavior:**
- Idempotency check fails
- Error: "Duplicate invoice. Invoice FF-Q1-001 for date 2026-04-05 already exists for this Agreement"
- Entry not created

### Invalid Amount

**Scenario:** User enters negative amount or zero

**System Behavior:**
- Validation fails
- Error: "Amount must be greater than zero"
- Entry not created

### Future Invoice Date

**Scenario:** User enters invoice date in the future

**System Behavior:**
- Validation fails
- Error: "Invoice date cannot be in the future"
- Entry not created

---

## Summary

### Required Data
- **Agreement Reference:** `agreement_id` (user selects)
- **Invoice Info:** `invoice_no`, `invoice_date` (user input)
- **Amount:** `amount`, `currency` (user input)
- **Derived:** `cpl_id`, `fu_id`, `channel`, `period_month` (from Agreement)
- **Optional:** `notes`

### Validation Rules
- **Agreement:** Must exist, be APPROVED/ACTIVE, not CLOSED
- **CPL:** Must match Agreement, be ACTIVE
- **Invoice:** Required, valid format, not future, within period (warning)
- **Amount:** Required, positive, valid format, not exceeding cap (warning)
- **Idempotency:** No duplicate invoices

### Relationship to Agreement
- **One-to-Many:** Agreement has multiple entries
- **State Requirement:** Only APPROVED/ACTIVE agreements
- **Data Derivation:** CPL, FU, Channel, Period from Agreement
- **Consumption Tracking:** `consumed_amount` updated

### Relationship to Budget
- **Consumption:** Entries consume reserved budget
- **Envelope Link:** Via Agreement's channel/category/period
- **Immediate Posting:** Ledger entry created synchronously
- **No Overrun Block:** Warning only, no hard block

---

**Status:** 📝 Conceptual Design Complete  
**Last Updated:** January 2026  
**Next Review:** Before Sprint 1 (Implementation)


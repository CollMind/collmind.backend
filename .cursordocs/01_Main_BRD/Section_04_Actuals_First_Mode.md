# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 4

---

# 4. ACTUALS-FIRST MODE (Full Specification)

## Introduction

This section provides the **complete functional specification** for Actuals-First Mode — the execution-driven operational paradigm optimized for rapid tactical decision-making, reactive market conditions, and agreement-based promotions.

**Scope:** This section covers Phase 1 MVP implementation. Features marked as "Phase 2+" are architecturally designed but deferred to later releases.

---

## 4.1 Mode Overview

### Purpose & Business Context

Actuals-First Mode addresses the fundamental challenge of **speed-to-market** in promotional execution. In channels like Traditional Trade, Modern Trade spot deals, and Wholesale volume incentives, the business operates in a reactive paradigm where:
- Competitive moves require same-day/next-day response
- Volume forecasting is impractical or unreliable
- Baseline data is unavailable or irrelevant
- The business model is "act first, justify immediately, track what happened"

**Core Principle:** "Execute action → Record agreement → Get approval → Track spend"

### When to Use Actuals-First

**Mode Resolution Principle:** Actuals-First is not a user-selected mode; it is resolved by tactic eligibility, scope policy configuration, and user permissions. The system determines the appropriate workflow based on business context, not user preference.

**Recommended Scenarios:**
- **Competitive response:** Rival launches promotion; immediate counter-action needed
- **Opportunistic deals:** Unexpected shelf space offer, short-term inventory clearance
- **Distributor negotiations:** Volume rebates negotiated post-facto
- **Traditional Trade dynamics:** Daily pricing decisions in fragmented distribution
- **Spot activations:** Event-based promotions with <7 days planning window

**Typical Channels:**
- Traditional Trade: 80-95% Actuals-First usage
- Modern Trade: 40-60% Actuals-First (spot deals)
- Wholesale: 70-80% Actuals-First (volume rebates)
- NKA: 20-30% Actuals-First (exception deals outside JBP)

### Operational Workflow

```
┌────────────────────────────────────────────────────────────┐
│              ACTUALS-FIRST WORKFLOW                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ① TRIGGER EVENT                                           │
│     │ Competitive move, opportunity, customer request      │
│     ↓                                                      │
│                                                            │
│  ② CREATE AGREEMENT (STA or LTA)                          │
│     │ Planner defines: CPL, Tactic, FU, Value, Duration  │
│     │ System validates: Budget, Policy, Caps             │
│     │ Mandatory: Business justification                   │
│     ↓                                                      │
│                                                            │
│  ③ SUBMIT FOR APPROVAL                                    │
│     │ Approval engine matches policy                      │
│     │ Multi-level sequential approvals                    │
│     │ Target: <24 hours turnaround                        │
│     ↓                                                      │
│                                                            │
│  ④ EXECUTE (Communicate to Field/Customer)                │
│     │ Agreement terms shared with sales team              │
│     │ Promotion begins immediately                         │
│     ↓                                                      │
│                                                            │
│  ⑤ SPEND OCCURS                                           │
│     │ On-Invoice: Deducted at point of sale              │
│     │ Off-Invoice: Batch import of invoices/claims        │
│     ↓                                                      │
│                                                            │
│  ⑥ LEDGER POSTING                                         │
│     │ Transactions → ledger_entries                       │
│     │ Budget consumed automatically                        │
│     ↓                                                      │
│                                                            │
│  ⑦ REAL-TIME REPORTING                                    │
│     Finance Dashboard updated                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Speed Advantage:**
- Agreement creation: 15-30 minutes (vs. 2+ hours for Planning)
- Approval turnaround: <24 hours target
- Execution: Immediate upon approval
- Tracking: Real-time as spend occurs

### Key Differentiators (vs Planning-First)

| Aspect | Actuals-First | Planning-First |
|--------|---------------|----------------|
| **Trigger** | Market event, opportunity | Planning cycle, calendar |
| **Speed** | Hours to 1-2 days | Weeks to months |
| **Data Required** | Minimal (CPL, Tactic, Value) | Extensive (baseline, volumes, SKU mix) |
| **Forecast** | Not required | Core requirement |
| **Approval Basis** | Commercial terms, justification, budget | ROI metrics, profitability simulation |
| **Flexibility** | High (create anytime) | Medium (tied to planning cycles) |
| **KPI Focus** | What was spent, effective discount | What ROI will be, what uplift expected |
| **Use Case Fit** | Reactive, tactical, rapid response | Proactive, strategic, ROI-driven |

### Core Objects

**1. Agreement**
- Commercial contract capturing promotion terms
- Types: STA (Short-Term, ≤30 days) and LTA (Long-Term, >30 days)
- Status lifecycle: Draft → Pending → Approved → Active → Closed
- Budget reservation upon approval

**2. Agreement Transaction**
- Individual spend event linked to agreement
- Types: On-Invoice (immediate) or Off-Invoice (batch import)
- Automatic ledger posting
- Idempotency to prevent duplicates

**3. Ledger Entry**
- Financial transaction record
- Source: Agreement transactions
- Budget consumption tracking
- Audit trail with full attribution

### Success Metrics (Phase 1 Targets)

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Agreement Creation Time** | <30 minutes median | Time from start → submit |
| **Approval Turnaround** | <24 hours | Time from submit → decision |
| **Off-Invoice Batch Processing** | <5 minutes for 50 invoices | Processing time per batch |
| **Budget Tracking** | All spend tracked | % agreements with ledger entries |
| **Justification Compliance** | 100% | % agreements with valid justification |
| **Effective Discount Calculation** | 100% | % agreements with calculated discount |

---

## 4.2 Agreement Management (STA & LTA)

### Purpose

Agreement Management is the **core capability** of Actuals-First Mode. An Agreement captures the commercial terms of a promotional deal, reserves budget, tracks approvals, and serves as the source-of-truth for subsequent spend tracking.

### Agreement Types

**Data Model Note:** STA and LTA share the same data model (`agreements` table) but differ in lifecycle, consumption timing, approval policy, and settlement patterns. The distinction is operational, not structural.

#### Short-Term Agreement (STA)

**Definition:** Promotional agreement with duration ≤30 days

**Lifecycle Characteristics:**
- **Consumption Model:** Immediate (consumed as spend occurs)
- **Settlement:** Typically single period
- **Approval:** 1-2 levels, fast-track
- **Accrual:** No periodic accrual; consumed on actual invoice

**Typical Use Cases:**
- Competitive response ("Rival launched discount, respond within 48 hours")
- Spot shelf space opportunities
- Short-term pricing adjustments
- Event-based activations (weekend promo, flash sale)

**Characteristics:**
- Fast approval (1-2 levels)
- Simple justification required
- Limited budget caps
- Immediate execution

**Example:**
```
STA #2026-025
CPL: Özgür Kozmetik (Traditional Trade)
Tactic: Competitive Response - Off-Invoice Rebate
FU: Wella SP Shampoo 500ml
Duration: Jan 8-31, 2026 (23 days)
Support: 15 TL per unit
Justification: "L'Oréal Elvive dropped to 69 TL; match competitive pricing"
Budget: 15,000 TL (estimated 1,000 units)
```

#### Long-Term Agreement (LTA)

**Definition:** Promotional agreement with duration >30 days

**Lifecycle Characteristics:**
- **Consumption Model:** Periodic (monthly/quarterly settlements)
- **Settlement:** Multi-period accrual, batch settlements
- **Approval:** Multi-level including Finance pre-approval
- **Accrual:** Can accrue monthly but settled periodically (e.g., quarterly turnover rebate)

**Typical Use Cases:**
- Annual turnover rebates
- Quarterly volume incentives
- Year-long listing fees
- Strategic customer contracts

**Characteristics:**
- Multi-level approval (including Finance)
- Detailed contractual terms
- Higher budget thresholds
- Settlement periods (monthly/quarterly)

**Example:**
```
LTA #2026-GS-001
CPL: Güzellik Sarayı Chain (Professional Salon)
Tactic: Turnover Rebate (Annual)
Scope: All Wella Professional Range
Duration: Jan 1 - Dec 31, 2026
Rebate Structure: 5% of annual turnover (target: 500K TL)
Max Payout: 25,000 TL/year
Payment: Quarterly off-invoice settlements
```

### Agreement Lifecycle

```
┌─────────┐
│  DRAFT  │ ← Created by Planner, validation in progress
└────┬────┘
     │ Submit
     ↓
┌─────────┐
│ PENDING │ ← Awaiting approval(s)
└────┬────┘
     │ Approve (all levels)
     ↓
┌──────────┐
│ APPROVED │ ← Budget reserved, ready for execution
└────┬─────┘
     │ Execution begins
     ↓
┌────────┐
│ ACTIVE │ ← Promotion running, transactions posting
└────┬───┘
     │ End date reached or manually closed
     ↓
┌────────┐
│ CLOSED │ ← Final state, no further transactions
└────────┘

ALTERNATIVE PATHS:
PENDING → REJECTED (if approval denied)
ACTIVE → CANCELLED (if agreement terminated early)
```

### Agreement Schema

```sql
CREATE TABLE agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  
  -- Agreement identification
  agreement_code VARCHAR(50) NOT NULL, -- e.g., "STA-2026-025"
  agreement_name VARCHAR(200),
  agreement_type VARCHAR(10) NOT NULL, -- 'STA' | 'LTA'
  
  -- Customer & scope
  cpl_id UUID NOT NULL REFERENCES customers(id),
  channel VARCHAR(30) NOT NULL, -- 'TRADITIONAL', 'NKA', 'MT', 'WHOLESALE'
  region_id UUID REFERENCES regions(id),
  
  -- Product scope
  gu_id UUID REFERENCES generic_units(id), -- Generic Unit (optional)
  fu_id UUID REFERENCES forecasting_units(id), -- Forecasting Unit (required)
  sku_scope VARCHAR(20) DEFAULT 'FU', -- 'GU' | 'FU' | 'SKU' | 'ALL'
  
  -- Tactic & mechanic
  tactic_id UUID NOT NULL REFERENCES tactics(id),
  mechanic_id UUID NOT NULL REFERENCES mechanics(id),
  
  -- Financial terms
  mechanic_value NUMERIC(18,4), -- e.g., 15.00 (TL per unit) or 10.5 (%)
  mechanic_type VARCHAR(20), -- 'PERCENT' | 'AMOUNT' | 'AMOUNT_PER_UNIT'
  currency CHAR(3) DEFAULT 'TRY',
  
  -- Budget
  cap_total_amount NUMERIC(18,2), -- Budget ceiling for this agreement
  spend_type VARCHAR(20), -- 'ON_INVOICE' | 'OFF_INVOICE' | 'BOTH'
  
  -- Period
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  period_month CHAR(7) NOT NULL, -- YYYY-MM (for budget tracking)
  
  -- Justification
  justification TEXT NOT NULL, -- Mandatory business rationale
  
  -- Status
  status VARCHAR(20) NOT NULL, -- 'DRAFT' | 'PENDING' | 'APPROVED' | 'ACTIVE' | 'CLOSED' | 'REJECTED' | 'CANCELLED'
  
  -- Approval
  approval_request_id UUID REFERENCES approval_requests(id),
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  
  -- Budget tracking (computed)
  consumed_amount NUMERIC(18,2) DEFAULT 0, -- Sum of ledger entries
  
  -- Audit
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  updated_at TIMESTAMPTZ,
  
  -- Constraints
  CHECK (end_date >= start_date),
  CHECK (cap_total_amount > 0),
  CHECK (mechanic_value > 0),
  CONSTRAINT uq_agreement_code UNIQUE (tenant_id, agreement_code)
);

-- Indexes
CREATE INDEX idx_agreements_tenant_status ON agreements(tenant_id, status);
CREATE INDEX idx_agreements_cpl ON agreements(tenant_id, cpl_id, status);
CREATE INDEX idx_agreements_period ON agreements(tenant_id, period_month, status);
CREATE INDEX idx_agreements_approval ON agreements(approval_request_id) WHERE approval_request_id IS NOT NULL;
```

### Agreement Creation Workflow

**Step 1: Initiate Agreement**

User clicks "Create Promotion" → System resolves scope policy → If ACTUALS_FIRST or HYBRID, shows Agreement form

**Step 2: Define Agreement Basics**
```
Form Fields (Required):
┌─────────────────────────────────────────────────────┐
│ Agreement Type: ○ STA  ○ LTA                       │
│                                                     │
│ Customer (CPL): [Özgür Kozmetik ▼]                 │
│   → Auto-fills: Channel (Traditional), Region      │
│                                                     │
│ Duration:                                          │
│   Start Date: [08.01.2026]                        │
│   End Date:   [31.01.2026]                        │
│   → System validates: ≤30 days for STA            │
│                                                     │
│ Product Scope:                                     │
│   FU: [Wella SP Shampoo 500ml ▼]                  │
│   → Shows SKUs under this FU (optional detail)    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Step 3: Define Tactic & Mechanics**
```
┌─────────────────────────────────────────────────────┐
│ Tactic: [Competitive Response ▼]                   │
│   → System loads applicable mechanics               │
│                                                     │
│ Mechanic: [Off-Invoice Rebate ▼]                   │
│                                                     │
│ Support Type:                                       │
│   ○ % Discount                                      │
│   ● Amount per Unit                                 │
│   ○ Fixed Lumpsum                                   │
│                                                     │
│ Support Value: [15.00] TL per unit                 │
│                                                     │
│ Budget Cap: [15,000] TL                            │
│   → System checks budget availability               │
│   → Shows: Available 47,500 TL (Traditional/Hair)  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Step 4: Provide Justification**
```
┌─────────────────────────────────────────────────────┐
│ Business Justification: (Mandatory)                 │
│ ┌─────────────────────────────────────────────────┐ │
│ │ L'Oréal Elvive şampuan 69 TL'ye indi.          │ │
│ │ Market payını korumak için Wella SP'yi 80 TL'ye│ │
│ │ çekmemiz gerekiyor. Bu competitive response    │ │
│ │ olmadan 15-20% satış kaybı riski var.          │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Attachments: (Optional)                            │
│ [📎 Add File] competitor_price_screenshot.jpg      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Step 5: Policy Validation (Automatic)**

System runs policy engine:
```typescript
// Pseudo-code
function validateAgreement(agreement) {
  // Check 1: Budget availability
  if (agreement.cap_total_amount > available_budget) {
    return { valid: false, error: "Insufficient budget" };
  }
  
  // Check 2: STA duration
  if (agreement.type === 'STA' && days > 30) {
    return { valid: false, error: "STA cannot exceed 30 days" };
  }
  
  // Check 3: Tactic policy
  const tacticPolicy = getTacticPolicy(agreement.tactic_id, 'ACTUALS');
  if (tacticPolicy.requires_fu && !agreement.fu_id) {
    return { valid: false, error: "This tactic requires FU selection" };
  }
  
  // Check 4: Justification
  if (!agreement.justification || agreement.justification.length < 20) {
    return { valid: false, error: "Justification too short (min 20 chars)" };
  }
  
  return { valid: true };
}
```

**Step 6: Submit for Approval**

- System determines approval policy based on:
  - Agreement type (STA / LTA)
  - Amount (cap_total_amount)
  - Channel
  - Tactic
- Creates `approval_request` with sequential steps
- Notifies first approver (email + in-app)
- Agreement status: DRAFT → PENDING

### Approval Workflow (Example)

**Policy Match:**
```json
{
  "policy_name": "STA Approval - Traditional Trade",
  "applies_to": {
    "agreement_type": "STA",
    "channel": "TRADITIONAL",
    "amount_range": [0, 50000]
  },
  "approval_levels": [
    {
      "order": 1,
      "role": "REGIONAL_MANAGER",
      "when": { "amount_gte": 0 }
    },
    {
      "order": 2,
      "role": "FINANCE",
      "when": { "amount_gte": 10000 }
    }
  ]
}
```

**Approval Flow:**
```
Agreement #2026-025 (15,000 TL)

Step 1: REGIONAL_MANAGER (Mehmet Kaya)
  - Notified: 08.01.2026 10:30
  - Approved: 08.01.2026 14:15
  - Comment: "Competitive situation confirmed, approved"

Step 2: FINANCE (Ahmet Yıldız)
  - Notified: 08.01.2026 14:15
  - Approved: 08.01.2026 16:00
  - Comment: "Budget available, within policy"

Final Status: APPROVED
Budget Reserved: 15,000 TL
```

### Agreement Execution

Upon approval:
1. ✅ Agreement status: PENDING → APPROVED
2. ✅ Budget reservation created (budget_transactions.RESERVE)
3. ✅ Notification sent to creator
4. ✅ Agreement terms communicated to field team
5. ✅ Promotion begins execution

### Spend Tracking (Linked to Agreement)

**On-Invoice Spend:**
- Captured at point of sale
- Invoice system integration (future)
- For now: Manual entry or batch import

**Off-Invoice Spend:**
- Batch import of invoices/claims (Section 4.3)
- Each transaction linked to agreement via `agreement_id`
- Automatic ledger posting

---

## 4.3 Off-Invoice Import & Processing

### Purpose

Off-invoice spend represents promotional allowances paid **after** the invoice, typically through:
- Price difference invoices (fiyat farkı faturası)
- Rebate settlements
- Display fees
- Listing fees
- Turnover bonuses

In Traditional Trade and Professional channels, 40-60% of promotional spend is off-invoice. Without systematic tracking, this spend is invisible to Finance until reconciliation crises emerge.

**CollMind Solution:** Batch import capability processes 40-50+ invoices in <5 minutes with validation, staging, approval, and automatic ledger posting.

### Batch Import Workflow

```
┌────────────────────────────────────────────────────────────┐
│           OFF-INVOICE BATCH IMPORT WORKFLOW                │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ① PREPARE EXCEL FILE                                      │
│     │ Download template, fill invoice data               │
│     ↓                                                      │
│                                                            │
│  ② UPLOAD FILE                                            │
│     │ System validates file structure                     │
│     │ Calculates file hash (idempotency)                  │
│     ↓                                                      │
│                                                            │
│  ③ VALIDATION & STAGING                                   │
│     │ Row-level validation (LTA exists? Amount valid?)   │
│     │ Records staged in import_batches table             │
│     │ Errors/warnings reported to user                    │
│     ↓                                                      │
│                                                            │
│  ④ PREVIEW & CORRECTION                                   │
│     │ User reviews validation results                     │
│     │ Can fix errors inline or re-upload                  │
│     ↓                                                      │
│                                                            │
│  ⑤ SUBMIT FOR APPROVAL                                    │
│     │ Batch goes to Finance/Manager for approval         │
│     │ Approval policy: batch_amount > threshold          │
│     ↓                                                      │
│                                                            │
│  ⑥ LEDGER POSTING (Upon Approval)                         │
│     │ Each record → ledger_entry                          │
│     │ Agreement consumed_amount updated                   │
│     │ Budget consumed (automatic)                         │
│     ↓                                                      │
│                                                            │
│  ⑦ CONFIRMATION                                           │
│     Batch status: POSTED                                  │
│     Notifications sent                                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Excel Template Structure

**Template Columns:**
```
A: LTA_Code         (e.g., "LTA-2026-GS-001")
B: Invoice_No       (e.g., "FF-Q1-001")
C: Invoice_Date     (e.g., "05.04.2026")
D: Amount           (e.g., 7250.00)
E: CPL_Code         (e.g., "GS" - for validation)
F: Notes            (optional)
```

**Example Data:**
```
LTA_Code       | Invoice_No | Invoice_Date | Amount  | CPL_Code | Notes
---------------|------------|--------------|---------|----------|----------------
LTA-2026-GS-001| FF-Q1-001  | 05.04.2026   | 7,250.00| GS       | Q1 Settlement
LTA-2026-GS-001| FF-Q1-005  | 06.04.2026   | 3,500.00| GS       | Display Fee
LTA-2026-MK-002| FF-Q1-012  | 10.04.2026   | 12,000  | MK       | Turnover Bonus
```

### Validation Rules

**File-Level Validation:**
- ✅ File hash check (prevent duplicate upload)
- ✅ Column structure matches template
- ✅ File size <10MB (prevents performance issues)
- ✅ Max 500 rows per batch (performance limit)

**Row-Level Validation:**
```typescript
// Pseudo-code validation logic
function validateRow(row) {
  const errors = [];
  const warnings = [];
  
  // Check 1: LTA exists
  const lta = findAgreement(row.LTA_Code);
  if (!lta) {
    errors.push("LTA not found");
  }
  
  // Check 2: LTA is active
  if (lta && lta.status !== 'ACTIVE' && lta.status !== 'APPROVED') {
    errors.push(`LTA status is ${lta.status}, not ACTIVE`);
  }
  
  // Check 3: Amount format
  if (isNaN(row.Amount) || row.Amount <= 0) {
    errors.push("Invalid amount format");
  }
  
  // Check 4: Invoice date within agreement period
  if (lta && (row.Invoice_Date < lta.start_date || row.Invoice_Date > lta.end_date)) {
    warnings.push("Invoice date outside LTA period");
  }
  
  // Check 5: CPL matches LTA
  if (lta && row.CPL_Code !== lta.cpl_code) {
    errors.push("CPL mismatch with LTA");
  }
  
  // Check 6: Budget cap not exceeded
  if (lta && (lta.consumed_amount + row.Amount) > lta.cap_total_amount) {
    warnings.push(`Exceeds LTA cap by ${diff} TL`);
  }
  
  return { errors, warnings };
}
```

### Validation Results UI

```
┌─────────────────────────────────────────────────────────┐
│ BATCH VALIDATION RESULTS                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ File: off_invoice_april_2026.xlsx                      │
│ Uploaded: 05.04.2026 09:15                             │
│                                                         │
│ ✅ 38 records valid                                     │
│ ⚠️  2 records with warnings                             │
│ ❌ 0 records with errors                                │
│                                                         │
│ DETAILS:                                                │
│ ┌─────┬──────────────┬────────────┬────────┬────────┐  │
│ │ Row │ LTA_Code     │ Invoice_No │ Amount │ Status │  │
│ ├─────┼──────────────┼────────────┼────────┼────────┤  │
│ │ 1-38│ Various      │ Various    │ Valid  │ ✅ OK  │  │
│ │ 39  │ LTA-2026-XY  │ FF-Q1-099  │ 5,000  │ ⚠️ Warn│  │
│ │     │ Warning: Invoice date outside LTA period      │  │
│ │ 40  │ LTA-2026-GS  │ FF-Q1-100  │ 8,000  │ ⚠️ Warn│  │
│ │     │ Warning: Exceeds LTA cap by 1,250 TL          │  │
│ └─────┴──────────────┴────────────┴────────┴────────┘  │
│                                                         │
│ [🔧 Fix Warnings] [➡️ Proceed to Approval]             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Idempotency Mechanisms

**Level 1: File Hash**
```sql
CREATE TABLE import_batches (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  file_name VARCHAR(200),
  file_hash VARCHAR(64) NOT NULL, -- SHA-256 hash
  upload_date TIMESTAMPTZ NOT NULL,
  uploaded_by UUID NOT NULL,
  status VARCHAR(20), -- 'STAGED' | 'APPROVED' | 'POSTED' | 'REJECTED'
  
  CONSTRAINT uq_batch_file_hash UNIQUE (tenant_id, file_hash)
);
```

If same file uploaded twice → System rejects: "File already processed (Batch ID: #BATCH-001)"

**Level 2: Invoice Number Uniqueness**
```sql
CREATE TABLE agreement_transactions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  agreement_id UUID NOT NULL REFERENCES agreements(id),
  
  invoice_no VARCHAR(100) NOT NULL,
  invoice_date DATE NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  
  -- Idempotency
  idempotency_key VARCHAR(200) NOT NULL,
  -- Format: '{agreement_id}|{invoice_no}|{invoice_date}'
  
  CONSTRAINT uq_transaction_idempotency UNIQUE (tenant_id, idempotency_key)
);
```

If same invoice_no + invoice_date combination → System blocks duplicate

### Batch Approval

**Approval Policy:**
```json
{
  "entity_type": "IMPORT_BATCH",
  "approval_required_when": {
    "total_amount_gte": 50000
  },
  "approval_levels": [
    {
      "order": 1,
      "role": "FINANCE",
      "when": { "amount_gte": 50000 }
    }
  ]
}
```

**Approval UI:**
```
┌─────────────────────────────────────────────────────────┐
│ BATCH APPROVAL REQUEST                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Batch ID: BATCH-2026-04-001                            │
│ Uploaded by: Ayşe Yılmaz (Finance Coordinator)         │
│ Upload Date: 05.04.2026 09:15                          │
│                                                         │
│ SUMMARY:                                                │
│ ├─ Total Records: 40                                   │
│ ├─ Total Amount: 145,600 TL                            │
│ ├─ LTAs Affected: 8                                    │
│ └─ Warnings: 2 (see details)                           │
│                                                         │
│ BREAKDOWN BY LTA:                                       │
│ ┌──────────────┬────────┬────────┐                     │
│ │ LTA Code     │ Count  │ Amount │                     │
│ ├──────────────┼────────┼────────┤                     │
│ │ LTA-2026-GS  │ 15     │ 52,000 │                     │
│ │ LTA-2026-MK  │ 12     │ 38,500 │                     │
│ │ LTA-2026-OK  │ 8      │ 28,100 │                     │
│ │ ... (5 more) │ ...    │ ...    │                     │
│ └──────────────┴────────┴────────┘                     │
│                                                         │
│ [📊 View Details] [📄 Download Excel]                  │
│                                                         │
│ DECISION:                                               │
│ ○ Approve    ○ Reject                                   │
│                                                         │
│ Comments: (Optional)                                    │
│ ┌─────────────────────────────────────────────────┐    │
│ │                                                 │    │
│ └─────────────────────────────────────────────────┘    │
│                                                         │
│ [✅ Submit Decision]                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Ledger Posting (Upon Approval)

```typescript
// Pseudo-code
async function postBatchToLedger(batchId) {
  const batch = await getBatch(batchId);
  const transactions = await getBatchTransactions(batchId);
  
  for (const tx of transactions) {
    // Find agreement
    const agreement = await getAgreement(tx.agreement_id);
    
    // Find budget envelope
    const envelope = await findBudgetEnvelope({
      channel: agreement.channel,
      category: agreement.category,
      period: agreement.period_month
    });
    
    // Create ledger entry
    await createLedgerEntry({
      source_type: 'AGREEMENT',
      source_id: agreement.id,
      spend_type: 'OFF_INVOICE',
      entry_direction: 'DEBIT',
      amount: tx.amount,
      currency: tx.currency,
      period_month: tx.invoice_date.substring(0, 7), // 'YYYY-MM'
      posting_date: new Date(),
      
      // Dimensions
      channel: agreement.channel,
      cpl_id: agreement.cpl_id,
      fu_id: agreement.fu_id,
      tactic_id: agreement.tactic_id,
      mechanic_id: agreement.mechanic_id,
      
      // Budget link
      budget_envelope_id: envelope?.id,
      
      // Idempotency
      idempotency_key: `LEDGER|AGREEMENT|${agreement.id}|${tx.invoice_no}`
    });
    
    // Update agreement consumed amount
    await incrementAgreementConsumed(agreement.id, tx.amount);
  }
  
  // Mark batch as posted
  await updateBatchStatus(batchId, 'POSTED');
}
```

### Performance Considerations

**Phase 1 Targets:**
- 50 invoices processed in <5 minutes
- Validation: <30 seconds
- Ledger posting: <2 minutes
- File size limit: 10MB

**Phase 2+ Optimization:**
- Parallel processing (chunks of 10)
- Background job queue
- Real-time progress indicator

---

## 4.4 Spend Tracking & KPIs

### Purpose

Actuals-First Mode focuses on **what was spent** rather than "what ROI will be." KPIs are descriptive, not predictive, and emphasize spend visibility, budget utilization, and effective discount tracking.

### Core KPIs

#### 1. Total Spend

**Formula:** `SUM(ledger_entries.amount WHERE source_type = 'AGREEMENT')`

**Purpose:** Total promotional spend through agreements

**Breakdowns:**
- By Channel
- By Category
- By CPL
- By Tactic
- By Period

#### 2. Effective Discount %

**Formula:** `(Total Spend / Total GSV) × 100`

**Purpose:** Average discount given as % of gross sales value

**Example:**
```
Total GSV (Gross Sales Value): 1,000,000 TL
Total Spend (Agreements): 150,000 TL
Effective Discount %: 15%
```

#### 3. On-Invoice vs Off-Invoice Split

**Formula:**
- On-Invoice: `SUM(amount WHERE spend_type = 'ON_INVOICE')`
- Off-Invoice: `SUM(amount WHERE spend_type = 'OFF_INVOICE')`
- Split %: `(Off-Invoice / Total Spend) × 100`

**Purpose:** Visibility into spend structure

**Example:**
```
Total Spend: 150,000 TL
├─ On-Invoice: 90,000 TL (60%)
└─ Off-Invoice: 60,000 TL (40%)
```

#### 4. Budget Utilization %

**Formula:** `((Reserved + Consumed) / Total Allocated) × 100`

**Purpose:** Track budget consumption rate

**RAG Status:**
- Green: <80%
- Amber: 80-95%
- Red: >95%

#### 5. Agreement Coverage

**Formula:** `(# Active Agreements / # Total CPLs) × 100`

**Purpose:** Measure promotional reach

**Example:**
```
Total CPLs in Traditional: 50
CPLs with Active Agreements: 35
Coverage: 70%
```

#### 6. Average Agreement Value

**Formula:** `Total Spend / # Agreements`

**Purpose:** Track deal size trends

#### 7. Approval Turnaround Time

**Formula:** `AVG(approved_at - created_at)`

**Purpose:** Process efficiency metric

**Target:** <24 hours

### KPI Dashboard (Actuals-First)

```
┌─────────────────────────────────────────────────────────┐
│ ACTUALS-FIRST DASHBOARD                                │
│ Period: January 2026                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ SPEND OVERVIEW                                          │
│ ┌─────────────────────┐  ┌─────────────────────────┐  │
│ │ Total Spend         │  │ Budget Utilization      │  │
│ │ 145,600 TL         │  │ 68% (Amber)             │  │
│ │ ↑ 12% vs Dec       │  │ 145K / 215K             │  │
│ └─────────────────────┘  └─────────────────────────┘  │
│                                                         │
│ SPEND STRUCTURE                                         │
│ ┌─────────────────────┐  ┌─────────────────────────┐  │
│ │ On-Invoice          │  │ Off-Invoice             │  │
│ │ 87,360 TL (60%)    │  │ 58,240 TL (40%)         │  │
│ └─────────────────────┘  └─────────────────────────┘  │
│                                                         │
│ BY CHANNEL                                              │
│ ┌──────────────────────────────────────────────────┐   │
│ │ Traditional: 98,500 TL (68%) ████████░░░░░      │   │
│ │ NKA:         32,100 TL (22%) ███░░░░░░░░░       │   │
│ │ MT:          15,000 TL (10%) ██░░░░░░░░░░       │   │
│ └──────────────────────────────────────────────────┘   │
│                                                         │
│ EFFICIENCY METRICS                                      │
│ ├─ Effective Discount: 14.2%                           │
│ ├─ Agreement Coverage: 72% (36/50 CPLs)                │
│ ├─ Avg Agreement Value: 3,640 TL                       │
│ └─ Approval Time: 18 hours avg (✅ Target: <24h)       │
│                                                         │
│ [📊 Detailed Report] [📥 Export Excel]                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Database Tables (Summary)

**Core Tables:**
- `agreements` (STA/LTA definitions)
- `agreement_transactions` (off-invoice records)
- `ledger_entries` (unified spend log)
- `import_batches` (batch upload tracking)
- `budget_envelopes` (budget tracking)
- `budget_transactions` (reservation/consumption log)

**Supporting Tables:**
- `approval_requests` (workflow tracking)
- `approval_steps` (multi-level approvals)
- `tactics` (tactic library)
- `mechanics` (mechanic definitions)
- `tactic_policies` (mode-specific rules)

---

## 4.5 Use Case Scenarios

### Scenario 1: Competitive Response (STA)

**Context:**
- Channel: Traditional Trade
- CPL: Özgür Kozmetik (regional distributor)
- Situation: L'Oréal dropped shampoo price from 89 TL to 69 TL
- Required action: Match competitive pricing within 48 hours

**CollMind Solution:**

**Day 1, 10:30 AM:**
- Sales Rep calls Planner: "L'Oréal promo, need immediate response"
- Planner opens CollMind → Create Agreement → STA

**Day 1, 11:00 AM:**
- Agreement defined:
  - FU: Wella SP Shampoo 500ml
  - Support: 15 TL per unit (95 TL → 80 TL effective price)
  - Duration: Jan 8-31 (23 days)
  - Budget cap: 15,000 TL (estimated 1,000 units)
  - Justification: "Competitive parity with L'Oréal Elvive pricing"
- Submitted for approval

**Day 1, 2:00 PM:**
- Regional Manager approves (Level 1)
- Finance auto-notified (amount triggers Level 2)

**Day 1, 4:00 PM:**
- Finance approves
- Agreement status: APPROVED
- Budget reserved: 15,000 TL
- Sales team notified

**Day 1-31:**
- Promotion runs
- Off-invoice invoices submitted weekly
- Ledger updated in real-time

**Result:**
- ✅ Market response time: <6 hours (vs. 3-5 days with planning-only systems)
- ✅ Complete audit trail
- ✅ Budget controlled
- ✅ Finance visibility

---

### Scenario 2: Annual Turnover Rebate (LTA)

**Context:**
- Channel: Professional (Salon)
- CPL: Güzellik Sarayı Chain (20 salons)
- Situation: Negotiate annual turnover-based rebate

**CollMind Solution:**

**Jan 1:**
- Key Account Manager creates LTA:
  - Type: Turnover Rebate (5% of annual sales)
  - Target: 500,000 TL annual turnover
  - Max payout: 25,000 TL
  - Payment: Quarterly off-invoice settlements
  - Duration: Jan 1 - Dec 31, 2026

**Jan-Mar (Q1):**
- Salon purchases 125,000 TL worth of products
- Q1 rebate due: 125,000 × 5% = 6,250 TL

**Apr 5:**
- Finance prepares Q1 settlement
- Off-invoice batch import: 1 record (6,250 TL)
- Links to LTA-2026-GS-001
- Finance approves batch
- Ledger posted automatically

**Apr-Dec:**
- Process repeats quarterly
- Running total tracked in LTA consumed_amount
- Budget visibility maintained

**Result:**
- ✅ Long-term agreement visibility
- ✅ Systematic settlement tracking
- ✅ No surprise invoices for Finance
- ✅ Customer relationship transparency

---

### Scenario 3: Bulk Off-Invoice Processing

**Context:**
- Month-end: 42 off-invoice invoices received
- Mix: Turnover rebates, display fees, promotional support
- Challenge: Process efficiently without errors

**CollMind Solution:**

**Apr 5, 9:00 AM:**
- Finance Coordinator downloads Excel template
- Fills 42 records from paper invoices
- Uploads file: `off_invoice_april_2026.xlsx`

**Apr 5, 9:05 AM:**
- System validates:
  - ✅ 40 records valid
  - ⚠️ 2 warnings (dates outside LTA period)
  - ❌ 0 errors
- Coordinator reviews warnings, confirms intentional

**Apr 5, 9:10 AM:**
- Submits batch for approval
- Total: 145,600 TL across 8 LTAs

**Apr 5, 10:30 AM:**
- Finance Manager approves batch
- System posts 40 ledger entries (2 minutes)
- Budget consumed across multiple envelopes
- Email confirmations sent

**Result:**
- ✅ Processing time: <90 minutes (vs. 3-4 hours manual entry)
- ✅ Zero data entry errors (template validation)
- ✅ Complete audit trail
- ✅ Budget impact visible immediately

---

---

## 4.6 Price Simulation (STA)

### Purpose

Price Simulation is a **decision support tool** for Short-Term Agreements (STA) that helps planners visualize the impact of promotional support on customer-facing prices. In competitive response scenarios, planners need to quickly answer: "If I give X TL support per unit, what will the final price be?"

**Use Cases:**
- Competitive price matching
- Shelf price target achievement
- Quick ROI estimation (informal)
- Approval justification (show intended price impact)

### Calculation Logic

**Formula:**
```
Expected Price = Current Price - Support Amount

Where:
- Current Price: SKU price from master data (or manual input)
- Support Amount: Agreement mechanic value (TL per unit)
- Expected Price: Target customer-facing price
```

**Reverse Calculation:**
```
Required Support = Current Price - Target Price

Example:
- Current Price: 95 TL
- Target Price: 80 TL (to match competitor)
- Required Support: 15 TL per unit
```

### UI Widget (Agreement Creation)

```
┌─────────────────────────────────────────────────────────┐
│ PRICE SIMULATION (STA)                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Current Price:                                          │
│ ┌─────────────────────┐                                │
│ │ 95.00 TL           │ (from SKU master data)          │
│ └─────────────────────┘                                │
│                                                         │
│ Support per Unit:                                       │
│ ┌─────────────────────┐                                │
│ │ 15.00 TL           │ [Adjust ▲▼]                     │
│ └─────────────────────┘                                │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │           EXPECTED PRICE AFTER SUPPORT          │   │
│ │                                                 │   │
│ │              80.00 TL                           │   │
│ │                                                 │   │
│ │   95.00 TL - 15.00 TL = 80.00 TL               │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ COMPETITIVE BENCHMARK: (Optional)                       │
│ ├─ L'Oréal Elvive (competitor): 69 TL                  │
│ └─ Price Gap: 11 TL (Wella still 16% higher)           │
│                                                         │
│ NOTES:                                                  │
│ • Simulation for guidance only                         │
│ • Actual customer pricing may vary                     │
│ • Does not include customer margin                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Validation Rules

**Input Validation:**
- Current Price must be > 0
- Support Amount must be > 0
- Support Amount cannot exceed Current Price (Expected Price must be ≥0)

**Warning Thresholds:**
- If Expected Price < 50% of Current Price → Warning: "High discount (>50%)"
- If Expected Price < Competitor Price → Info: "Below competitor pricing"

### Data Sources

**Current Price:**
1. **Preferred:** SKU master data (`skus.base_price`)
2. **Fallback:** Manual input by planner
3. **Validation:** System checks if price is recent (<90 days)

**Competitor Price (Optional):**
- Manual input only (no automatic ingestion in Phase 1)
- Stored in `agreement.competitor_price` (optional field)
- Used for justification and reporting only

### Use in Approval Workflow

Price Simulation results can be attached to approval requests:

```
APPROVAL REQUEST DETAILS:
├─ Agreement: STA-2026-025
├─ CPL: Özgür Kozmetik
├─ Support: 15 TL per unit
├─ Current Price: 95 TL
├─ Expected Price: 80 TL
├─ Competitive Benchmark: L'Oréal @ 69 TL
└─ Justification: "Achieve competitive parity in premium segment"
```

**Approver View:**
- Can see price simulation in approval screen
- Helps contextualize discount request
- Not a substitute for actual ROI (Planning-First has full KPI engine)

### Limitations (Phase 1)

**Explicitly NOT Supported:**
- ❌ Multi-SKU simulation (only single SKU at a time)
- ❌ Volume-weighted pricing
- ❌ Customer margin calculation
- ❌ Profitability impact (GP ROI)
- ❌ Automatic competitor price ingestion
- ❌ Historical price tracking

**Phase 2+ Considerations:**
- Integrate with pricing management system
- Multi-SKU basket simulation
- Margin impact estimation (requires cost data)

### Schema Addition

```sql
-- Add to agreements table
ALTER TABLE agreements
ADD COLUMN current_price NUMERIC(18,2), -- SKU price at time of agreement
ADD COLUMN expected_price NUMERIC(18,2), -- Simulated price after support
ADD COLUMN competitor_price NUMERIC(18,2), -- Optional benchmark
ADD COLUMN competitor_name VARCHAR(100); -- e.g., "L'Oréal Elvive"
```

---

## 4.7 Tactic & Mechanic Execution

### Purpose

Tactics and Mechanics define **how promotional support is structured and delivered**. Different mechanics have different calculation rules, settlement methods, and validation requirements. Actuals-First Mode enforces tactic policies specific to execution-driven workflows.

### Core Mechanics in Actuals-First

#### 1. Off-Invoice Rebate (Per Unit)

**Definition:** Fixed amount per unit sold, paid via off-invoice settlement

**Calculation:**
```
Total Rebate = Units Sold × Rebate per Unit

Example:
- Rebate: 15 TL per unit
- Units Sold: 1,000
- Total Rebate: 15,000 TL
```

**Settlement:**
- Captured via off-invoice batch import
- Links to agreement via `agreement_id`
- Posted to ledger as OFF_INVOICE spend

**Validation:**
- Rebate per unit must be > 0
- Cannot exceed SKU base price (warning if >50%)

---

#### 2. Percentage Discount (On-Invoice)

**Definition:** Percentage discount deducted at point of sale

**Calculation:**
```
Discount Amount = GSV × Discount %

Example:
- GSV: 10,000 TL
- Discount: 10%
- Discount Amount: 1,000 TL
- Net Invoice: 9,000 TL
```

**Settlement:**
- Deducted immediately on invoice
- Captured via invoice system integration (future)
- Phase 1: Manual entry or batch import

**Validation:**
- Discount % must be between 0-100%
- Warning if >30% (high discount)

---

#### 3. Fixed Lumpsum

**Definition:** Fixed amount regardless of volume

**Calculation:**
```
Total Support = Fixed Amount (no calculation needed)

Example:
- Display Fee: 5,000 TL (one-time)
- Listing Fee: 10,000 TL (annual)
```

**Settlement:**
- Single off-invoice invoice
- Can be split across periods (e.g., quarterly)

**Validation:**
- Fixed amount must be > 0
- Must specify payment schedule (one-time, monthly, quarterly)

---

#### 4. Turnover Rebate (% of Sales)

**Definition:** Percentage rebate based on achieved turnover

**Calculation:**
```
Rebate Amount = Actual Turnover × Rebate %

Example:
- Q1 Turnover: 125,000 TL
- Rebate: 5%
- Q1 Rebate: 6,250 TL
```

**Settlement:**
- Periodic (monthly, quarterly, annual)
- Requires turnover data (from sales system or manual input)
- Off-invoice settlement via batch import

**Validation:**
- Rebate % must be > 0
- Target turnover (optional) vs actual turnover tracking
- Warning if actual exceeds target significantly (indicates cap breach)

---

### Tactic Policy Enforcement

Each tactic has **mode-specific policies** that define allowed mechanics and validation rules:

**Example: Competitive Response Tactic**
```json
{
  "tactic_id": "TACTIC-COMP-RESP",
  "tactic_name": "Competitive Response",
  "mode": "ACTUALS",
  "allowed_mechanics": [
    "OFF_INVOICE_REBATE",
    "PERCENT_DISCOUNT_ON_INVOICE"
  ],
  "validation_rules": {
    "requires_fu": true,
    "requires_justification": true,
    "max_duration_days": 30, // STA only
    "approval_threshold": 10000 // TL
  },
  "budget_policy": {
    "requires_budget_check": true,
    "reserve_on_approval": true
  }
}
```

**Policy Enforcement Flow:**
```typescript
// Pseudo-code
async function validateAgreement(agreement) {
  // Load tactic policy
  const tacticPolicy = await getTacticPolicy(
    agreement.tactic_id, 
    'ACTUALS'
  );
  
  // Check 1: Mechanic allowed for this tactic?
  if (!tacticPolicy.allowed_mechanics.includes(agreement.mechanic_id)) {
    throw new Error(`Mechanic ${agreement.mechanic_id} not allowed for tactic ${agreement.tactic_id}`);
  }
  
  // Check 2: FU required?
  if (tacticPolicy.validation_rules.requires_fu && !agreement.fu_id) {
    throw new Error("This tactic requires FU selection");
  }
  
  // Check 3: Duration limit (for STA)
  if (agreement.agreement_type === 'STA') {
    const days = daysBetween(agreement.start_date, agreement.end_date);
    if (days > tacticPolicy.validation_rules.max_duration_days) {
      throw new Error(`STA duration cannot exceed ${tacticPolicy.validation_rules.max_duration_days} days`);
    }
  }
  
  // Check 4: Approval threshold
  if (agreement.cap_total_amount >= tacticPolicy.validation_rules.approval_threshold) {
    agreement.requires_multi_level_approval = true;
  }
  
  return { valid: true };
}
```

### Mechanic-Specific Data Capture

Different mechanics require different data points:

| Mechanic | Required Fields | Optional Fields |
|----------|----------------|-----------------|
| **Off-Invoice Rebate** | `mechanic_value` (per unit) | `estimated_volume` |
| **% Discount** | `mechanic_value` (%), `expected_gsv` | `price_simulation` |
| **Fixed Lumpsum** | `mechanic_value` (fixed amount) | `payment_schedule` |
| **Turnover Rebate** | `mechanic_value` (%), `target_turnover` | `payment_frequency` |

### Settlement Calculation Examples

**Example 1: Off-Invoice Rebate**
```
Agreement: STA-2026-025
Mechanic: Off-Invoice Rebate
Value: 15 TL per unit

Month 1 Sales:
- Invoice 1: 50 units → 750 TL rebate
- Invoice 2: 80 units → 1,200 TL rebate
- Invoice 3: 120 units → 1,800 TL rebate

Total Month 1: 250 units × 15 TL = 3,750 TL
```

**Example 2: Turnover Rebate (LTA)**
```
Agreement: LTA-2026-GS-001
Mechanic: Turnover Rebate
Value: 5% of quarterly turnover

Q1 Sales (Jan-Mar):
- Jan: 35,000 TL
- Feb: 42,000 TL
- Mar: 48,000 TL
- Total Q1: 125,000 TL

Q1 Rebate: 125,000 × 5% = 6,250 TL
Settlement: Single off-invoice invoice (April)
```

---

## 4.8 Budget Integration

### Purpose

Budget Integration ensures that every agreement **reserves budget upon approval** and **consumes budget as spend occurs**, maintaining real-time visibility and preventing overruns.

### Budget Flow (Actuals-First)

```
┌────────────────────────────────────────────────────────┐
│         BUDGET INTEGRATION WORKFLOW                    │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ① AGREEMENT CREATION                                  │
│     │ Planner specifies cap_total_amount              │
│     │ System finds applicable budget envelope         │
│     ↓                                                  │
│                                                        │
│  ② PRE-APPROVAL VALIDATION                            │
│     │ Check: envelope.available >= cap_total_amount   │
│     │ If insufficient → Block submission              │
│     ↓                                                  │
│                                                        │
│  ③ APPROVAL GRANTED                                   │
│     │ Create RESERVE transaction                      │
│     │ Amount: cap_total_amount                        │
│     │ Status: POSTED                                   │
│     ↓                                                  │
│                                                        │
│  ④ SPEND OCCURS (Ledger Posting)                      │
│     │ agreement_transaction → ledger_entry            │
│     │ ledger_entry.budget_envelope_id set             │
│     │ Consumed amount auto-computed                   │
│     ↓                                                  │
│                                                        │
│  ⑤ BUDGET UTILIZATION UPDATED                         │
│     v_budget_summary view reflects:                   │
│     - Reserved: cap_total_amount                      │
│     - Consumed: SUM(ledger_entries)                   │
│     - Available: Allocated - Reserved - Consumed      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Budget & Ledger State Transitions

**Critical Flow:** Understanding when budget moves from Reserved → Consumed

```
┌─────────────────────────────────────────────────────────┐
│     BUDGET & LEDGER STATE TRANSITION FLOW               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ① AGREEMENT APPROVED                                   │
│     ├─ Agreement Status: PENDING → APPROVED            │
│     ├─ Budget Action: Create RESERVE transaction       │
│     ├─ Budget State: Reserved += cap_total_amount      │
│     └─ Ledger Action: None (no spend yet)              │
│                                                         │
│  ② INVOICE RECEIVED                                     │
│     ├─ Source: Off-invoice batch import / manual entry │
│     ├─ Record Created: agreement_transaction           │
│     ├─ Budget State: No change (still Reserved)        │
│     └─ Ledger Action: Staged (pending approval)        │
│                                                         │
│  ③ INVOICE/BATCH APPROVED                              │
│     ├─ Ledger Action: Create ledger_entry              │
│     ├─ ledger_entry.budget_envelope_id set             │
│     ├─ Budget State: Consumed += invoice.amount        │
│     └─ Agreement: consumed_amount updated               │
│                                                         │
│  ④ BUDGET SUMMARY UPDATED (Automatic)                  │
│     ├─ v_budget_summary computes from:                 │
│     │   • budget_transactions (Reserved)               │
│     │   • ledger_entries (Consumed)                    │
│     ├─ Available = Allocated - Reserved - Consumed     │
│     └─ No aggregate columns to drift                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Key Principle:** Budget reservation happens at agreement approval; budget consumption happens at ledger posting (which occurs upon invoice/batch approval).

**Why Two Steps?**
- **Reserved:** Prevents over-commitment (other agreements can't use this budget)
- **Consumed:** Actual financial spend occurred (invoice posted, payment obligation created)

**Example Timeline:**
```
Day 1, 10:00: Agreement created (Draft)
Day 1, 16:00: Agreement approved (RESERVE 15,000 TL)
Day 5, 09:00: Invoice batch uploaded (staged, not yet consumed)
Day 5, 10:30: Batch approved (LEDGER entries created, 12,500 TL consumed)
Day 12, 09:00: Another batch (3,500 TL consumed, total 16,000 TL)
          ↑ Warning: Exceeded cap by 1,000 TL (alert triggered)
```

### Budget Reservation (Approval Event)

**Trigger:** Agreement status changes PENDING → APPROVED

**Action:**
```typescript
// Pseudo-code
async function reserveBudgetOnApproval(agreementId) {
  const agreement = await getAgreement(agreementId);
  
  // Find budget envelope
  const envelope = await findBudgetEnvelope({
    tenant_id: agreement.tenant_id,
    channel: agreement.channel,
    category: agreement.category, // Derived from FU
    period_code: agreement.period_month
  });
  
  if (!envelope) {
    throw new Error(`No budget envelope found for ${agreement.channel}/${agreement.category}/${agreement.period_month}`);
  }
  
  // Create RESERVE transaction
  await createBudgetTransaction({
    envelope_id: envelope.id,
    tx_type: 'RESERVE',
    tx_status: 'POSTED',
    source_type: 'AGREEMENT',
    source_id: agreement.id,
    amount: agreement.cap_total_amount,
    currency: agreement.currency,
    idempotency_key: `RESERVE|AGREEMENT|${agreement.id}|${envelope.id}`
  });
  
  console.log(`Reserved ${agreement.cap_total_amount} TL from envelope ${envelope.id}`);
}
```

### Budget Consumption (Ledger Posting)

**Trigger:** Ledger entry created (agreement transaction)

**Action:**
```typescript
// Pseudo-code
async function postToLedger(transaction) {
  const agreement = await getAgreement(transaction.agreement_id);
  
  // Find envelope (same logic as reservation)
  const envelope = await findBudgetEnvelope({
    tenant_id: agreement.tenant_id,
    channel: agreement.channel,
    category: agreement.category,
    period_code: transaction.invoice_date.substring(0, 7) // YYYY-MM
  });
  
  // Create ledger entry with envelope link
  await createLedgerEntry({
    source_type: 'AGREEMENT',
    source_id: agreement.id,
    spend_type: transaction.spend_type, // ON_INVOICE | OFF_INVOICE
    entry_direction: 'DEBIT',
    amount: transaction.amount,
    period_month: transaction.invoice_date.substring(0, 7),
    posting_date: new Date(),
    
    // Dimensions
    channel: agreement.channel,
    cpl_id: agreement.cpl_id,
    fu_id: agreement.fu_id,
    tactic_id: agreement.tactic_id,
    mechanic_id: agreement.mechanic_id,
    
    // Budget link
    budget_envelope_id: envelope?.id,
    
    // Idempotency
    idempotency_key: `LEDGER|AGREEMENT|${agreement.id}|${transaction.invoice_no}`
  });
  
  // Note: consumed amount auto-computed via v_budget_summary
}
```

### Budget Availability Check

**Real-Time Validation (Pre-Submission):**

```typescript
// Pseudo-code - called during agreement creation
async function checkBudgetAvailability(agreement) {
  const envelope = await findBudgetEnvelope({
    tenant_id: agreement.tenant_id,
    channel: agreement.channel,
    category: agreement.category,
    period_code: agreement.period_month
  });
  
  if (!envelope) {
    return {
      available: false,
      reason: "No budget envelope configured for this channel/category/period"
    };
  }
  
  // Get current utilization
  const summary = await getBudgetSummary(envelope.id);
  
  const available = summary.available; // Allocated - Reserved - Consumed
  const requested = agreement.cap_total_amount;
  
  if (requested > available) {
    return {
      available: false,
      reason: `Insufficient budget. Available: ${available} TL, Requested: ${requested} TL`,
      budget_status: {
        allocated: summary.total_allocated,
        reserved: summary.reserved,
        consumed: summary.consumed,
        available: summary.available
      }
    };
  }
  
  return {
    available: true,
    budget_status: {
      allocated: summary.total_allocated,
      available: summary.available,
      utilization_pct: ((summary.reserved + summary.consumed) / summary.total_allocated) * 100
    }
  };
}
```

### Budget Alerts & Thresholds

**Alert Triggers:**
- **Warning (80%):** Email to Planner + Finance
- **Approval Required (90%):** Finance approval needed for new agreements
- **Block (100%):** System prevents new agreement submissions

**Alert Example:**
```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ BUDGET ALERT                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Envelope: Traditional / Hair Care / 2026-01            │
│                                                         │
│ Current Utilization: 87% (AMBER)                       │
│ ├─ Allocated: 215,000 TL                               │
│ ├─ Reserved: 128,000 TL (60%)                          │
│ ├─ Consumed: 59,000 TL (27%)                           │
│ └─ Available: 28,000 TL (13%)                          │
│                                                         │
│ Warning: Only 28,000 TL remaining for January          │
│                                                         │
│ [📊 View Details] [📧 Notify Finance]                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Cross-Reference

**Full Budget Architecture:** See Section 3.3 Budget Management for:
- Budget envelope schema
- Budget transaction types
- Policy configuration
- Phase 1 constraints
- Event-sourced state management

---

## 4.9 Reporting & Analytics

### Purpose

Reporting & Analytics in Actuals-First Mode provides **spend visibility**, **budget tracking**, and **agreement performance analysis**. Reports are descriptive (what happened) rather than predictive (what will happen).

### Standard Reports

#### 1. Spend by Channel Report

**Purpose:** Track promotional spend across channels

**Dimensions:**
- Primary: Channel (Traditional, NKA, MT, Wholesale)
- Secondary: Period (Month, Quarter, YTD)
- Filters: Region, Category, CPL

**Metrics:**
- Total Spend (TL)
- # Active Agreements
- Effective Discount %
- Budget Utilization %

**Example Output:**
```
SPEND BY CHANNEL - January 2026
┌─────────────┬──────────┬───────────┬────────────┬──────────┐
│ Channel     │ Spend    │ # Agr     │ Eff Disc% │ Budget % │
├─────────────┼──────────┼───────────┼────────────┼──────────┤
│ Traditional │ 98,500   │ 23        │ 14.2%      │ 68%      │
│ NKA         │ 32,100   │ 8         │ 8.5%       │ 45%      │
│ MT          │ 15,000   │ 5         │ 12.0%      │ 38%      │
│ Wholesale   │ 0        │ 0         │ -          │ 0%       │
├─────────────┼──────────┼───────────┼────────────┼──────────┤
│ TOTAL       │ 145,600  │ 36        │ 12.8%      │ 58%      │
└─────────────┴──────────┴───────────┴────────────┴──────────┘
```

---

#### 2. Agreement Performance Report

**Purpose:** Track individual agreement execution

**Columns:**
- Agreement Code
- CPL Name
- Tactic
- Start/End Date
- Cap Amount (TL)
- Consumed Amount (TL)
- Utilization %
- Status

**Filters:**
- Status (Active, Closed)
- Period
- Channel
- Tactic

**Example Output:**
```
AGREEMENT PERFORMANCE - Active Agreements
┌──────────────┬─────────────┬──────────┬─────────┬──────────┬────────┐
│ Code         │ CPL         │ Tactic   │ Cap     │ Consumed │ Util % │
├──────────────┼─────────────┼──────────┼─────────┼──────────┼────────┤
│ STA-2026-025 │ Özgür Koz.  │ Comp Resp│ 15,000  │ 12,500   │ 83%    │
│ LTA-2026-GS  │ Güzellik S. │ Turnover │ 25,000  │ 6,250    │ 25%    │
│ STA-2026-032 │ Metro Dist. │ Display  │ 8,000   │ 8,000    │ 100%   │
└──────────────┴─────────────┴──────────┴─────────┴──────────┴────────┘
```

---

#### 3. Budget Utilization Report

**Purpose:** Track budget consumption across dimensions

**Cross-Reference:** Leverages Section 3.3 Budget Management

**Metrics:**
- Allocated, Reserved, Consumed, Available (TL)
- Utilization % ((Reserved + Consumed) / Allocated)
- RAG Status

**Example Output:**
```
BUDGET UTILIZATION - January 2026
┌──────────────┬────────────┬──────────┬──────────┬──────────┬──────┐
│ Envelope     │ Allocated  │ Reserved │ Consumed │ Available│ RAG  │
├──────────────┼────────────┼──────────┼──────────┼──────────┼──────┤
│ Traditional/ │ 215,000    │ 128,000  │ 59,000   │ 28,000   │ 🟡   │
│ Hair Care    │            │ (60%)    │ (27%)    │ (13%)    │      │
├──────────────┼────────────┼──────────┼──────────┼──────────┼──────┤
│ Traditional/ │ 95,000     │ 32,000   │ 18,000   │ 45,000   │ 🟢   │
│ Personal Care│            │ (34%)    │ (19%)    │ (47%)    │      │
└──────────────┴────────────┴──────────┴──────────┴──────────┴──────┘
```

---

### Export Capabilities

**Supported Formats:**
- **Excel (.xlsx):** Full data export with multiple sheets
- **PDF:** Formatted report with charts
- **CSV:** Raw data for further analysis

**Export Example (Excel):**
```
Workbook: "Actuals_Report_Jan_2026.xlsx"
├─ Sheet 1: Summary
├─ Sheet 2: Spend by Channel
├─ Sheet 3: Agreement List
├─ Sheet 4: Budget Utilization
└─ Sheet 5: Transactions (detail)
```

### Custom Report Builder

**Phase 2+ Feature:**
- Drag-and-drop report designer
- Custom dimension selection
- Calculated fields
- Scheduled email delivery

**Phase 1:**
- Standard reports only (pre-configured)
- Manual export on-demand

---

## 4.10 Phase 1 Implementation Scope

### ✅ Phase 1 Features (MVP Foundation)

**Core Agreement Management:**
- ✅ STA & LTA creation, approval, tracking
- ✅ Agreement lifecycle (Draft → Approved → Active → Closed)
- ✅ Policy-driven validation
- ✅ Multi-level approval workflows
- ✅ Budget reservation on approval

**Off-Invoice Processing:**
- ✅ Excel batch import (40-50 invoices)
- ✅ File + row-level validation
- ✅ Idempotency (file hash + invoice number)
- ✅ Batch approval workflow
- ✅ Automatic ledger posting

**Spend Tracking:**
- ✅ Unified ledger (agreement transactions → ledger_entries)
- ✅ Budget consumption tracking
- ✅ Real-time budget utilization
- ✅ Spend KPIs (7 core KPIs)

**Budget Integration:**
- ✅ Budget reservation (RESERVE transactions)
- ✅ Budget consumption (ledger links)
- ✅ Availability checking
- ✅ Alert thresholds (80%, 90%, 100%)

**Reporting:**
- ✅ 3 standard reports (Spend by Channel, Agreement Performance, Budget Utilization)
- ✅ Excel/PDF export
- ✅ Period-based filtering

**Tactic & Mechanics:**
- ✅ 4 core mechanics (Off-Invoice Rebate, % Discount, Lumpsum, Turnover Rebate)
- ✅ Tactic policy enforcement
- ✅ Mode-specific validation

**Price Simulation:**
- ✅ STA price simulation widget
- ✅ Current → Expected price calculation
- ✅ Competitor benchmarking (manual input)

---

### ❌ Explicitly NOT in Phase 1 (Deferred)

**Advanced Agreement Features:**
- ❌ Agreement templates (save/reuse configurations)
- ❌ Agreement cloning
- ❌ Bulk agreement creation
- ❌ Agreement amendments (currently requires new agreement)

**Integration:**
- ❌ Invoice system integration (on-invoice automatic capture)
- ❌ ERP sync (real-time posting)
- ❌ Pricing system integration (automatic current price)
- ❌ Sales data integration (turnover auto-calculation)

**Advanced Budget:**
- ❌ Reallocation workflows (Finance manually creates TRANSFER)
- ❌ Carry-forward rules
- ❌ Overrun approval (hard block at 100%)
- ❌ Multi-dimensional budgets (Brand, Region - only Channel × Category × Period)

**Advanced Reporting:**
- ❌ Custom report builder
- ❌ Scheduled reports (email delivery)
- ❌ Predictive analytics
- ❌ Trend analysis / forecasting

**Price Simulation:**
- ❌ Multi-SKU basket simulation
- ❌ Customer margin calculation
- ❌ Profitability impact (GP ROI - Planning-First only)
- ❌ Automatic competitor price ingestion

**Workflow:**
- ❌ Parallel approvals (only sequential in Phase 1)
- ❌ Delegated approvals (out-of-office)
- ❌ Conditional approval routing (Phase 1 uses fixed policies)

---

### 🔮 Phase 2+ Roadmap Items

**Phase 2 (Planning-First Activation):**
- Committed state in budget (for approved plans)
- Plan-to-agreement conversion
- Baseline data requirements
- ROI KPI engine

**Phase 3 (Optimization & Integration):**
- Invoice system integration (on-invoice auto-capture)
- ERP bi-directional sync
- Agreement templates & cloning
- Advanced budget reallocation
- Custom report builder
- Predictive analytics

**Phase 4 (AI & Automation):**
- AI-driven price recommendations
- Competitor price tracking (API integration)
- Anomaly detection (spend patterns)
- Automatic justification quality scoring

---

### Target State vs Initial Implementation

**Architecture Principle:**
- ✅ Target architecture fully designed (all tables, all fields)
- ✅ Phase 1 uses subset of capabilities
- ✅ No breaking changes required for Phase 2+
- ✅ Expansion via configuration, not refactoring

**Example: Budget Schema**
- Target: Multi-dimensional JSONB (`dimensions`)
- Phase 1: Single template (Channel × Category × Period)
- Phase 2: Add Brand, Region (no schema change, just policy update)

**Example: Agreement Schema**
- Target: Full agreement lifecycle + amendment support
- Phase 1: Core lifecycle only (no amendments)
- Phase 2: Add amendment workflows (use existing fields)

---

### Why Actuals-First Is Operationally Complex

**Perception vs Reality:**

Actuals-First appears simple on the surface ("just track what happened") but is operationally complex due to:
- **Asynchronous execution:** Agreements approved before spend occurs; spend timing unpredictable
- **Delayed financial signals:** Off-invoice settlements arrive weeks/months after promotion execution
- **Policy-driven controls:** Budget checks, approval routing, tactic validation must happen in real-time despite incomplete data
- **Idempotency requirements:** Same invoice can be uploaded multiple times; system must prevent duplicates across file, row, and transaction levels
- **Cross-period tracking:** Long-term agreements span multiple budget periods; consumption must allocate correctly

**Engineering Implication:** This is not a "simplified" TPM; it is a **policy-controlled, event-driven spend tracking system** with stringent audit requirements.

---

### Explicitly Out of Scope for Actuals-First (Phase 1)

The following capabilities are **conceptually incompatible** with Actuals-First paradigm or deferred to Planning-First Mode:

**Not Supported (By Design):**
- ❌ **Baseline calculation:** Actuals-First operates in contexts where baseline is unknown or irrelevant
- ❌ **Planned volume forecasting:** Volume is not forecasted; agreements set terms, actual sales determine spend
- ❌ **ROI simulation:** ROI requires baseline + planned volume + cost data; Actuals-First tracks effective discount only
- ❌ **Optimization / recommendations:** No predictive modeling; decisions are reactive, not optimized
- ❌ **Cross-period uplift attribution:** Cannot attribute incremental sales to promotion without baseline

**Supported in Planning-First Only:**
- KPI Calculation Engine (GP ROI, Uplift%, Incremental Volume)
- What-If Scenarios (adjust discount → recalculate ROI)
- RAG Status (Green/Amber/Red based on profitability thresholds)
- Plan-level aggregates (total plan value, total incremental GP)

**Why This Matters:**
- Prevents scope creep ("Can we add ROI to Actuals-First?")
- Clarifies product boundaries (Actuals = execution tracking; Planning = optimization)
- Guides customer conversations (ROI-driven customers → Planning-First)

---

**END OF SECTION 4 - ACTUALS-FIRST MODE**

---

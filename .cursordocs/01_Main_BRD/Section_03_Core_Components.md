# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 3

---

# 3. CORE/SHARED COMPONENTS (Overview)

## Introduction

The CollMind TPM Platform's power lies in its **mode-agnostic core** — a set of foundational components that serve both Actuals-First and Planning-First modes equally. This shared architecture ensures:

- **Data Consistency:** One SKU code, one customer record, everywhere
- **Governance Uniformity:** Same approval principles across all promotions
- **Budget Integrity:** Single budget pool, real-time visibility
- **Reporting Accuracy:** One ledger, one truth

**IMPORTANT - Target State vs Implementation Phasing:**

This section describes the **target architecture** — the complete vision for CollMind's core components. However, **not all capabilities will be implemented in Phase 1**. Each component section includes:
- **Target State:** Full architectural vision (the "North Star")
- **Phase 1 Implementation:** What will actually be built in Actuals-First MVP
- **Phase 2+ Expansion:** Capabilities deferred to later phases

**Principle:** Build a solid foundation that supports future expansion, but implement only what Phase 1 requires.

This section provides an **overview** of each core component. Detailed functional requirements, database schemas, and acceptance criteria will be documented in dedicated technical specifications during implementation planning.

---

## 3.1 Master Data Management

### Purpose

Master Data Management provides the **single source of truth** for all reference data used across the platform. Both Actuals-First and Planning-First workflows reference the same master data entities, eliminating reconciliation overhead and ensuring consistency.

### Key Capabilities

#### Product Hierarchy

The product hierarchy supports both promotional targeting (Actuals-First) and volume forecasting (Planning-First):

```
Brand (Pantene, Head & Shoulders)
  ↓
Category (Hair Care > Shampoo) [Hierarchical]
  ↓
GU - Generic Unit (Pantene Shampoo Range)
  ↓
FU - Forecasting Unit (500ml Shampoo segment) [Planning-specific]
  ↓
SKU - Stock Keeping Unit (Pantene 500ml Parlak Renkler)
```

**Brand:**
- Top-level brand identity
- Examples: Pantene, Head & Shoulders, Gillette
- Used for: Brand-level budget allocation, brand performance reporting

**Category (Hierarchical):**
- Product category taxonomy with parent-child relationships
- Examples: 
  - Hair Care (parent)
    - Shampoo (child)
    - Conditioner (child)
  - Skin Care (parent)
    - Moisturizer (child)
- **Critical:** Category is part of **Product Hierarchy**, not organizational dimensions
- Used for: Budget allocation (Channel × Category × Period), reporting, targeting

**GU (Generic Unit):**
- Product grouping for promotional targeting
- Examples: "Pantene Shampoo Range", "Head & Shoulders Anti-Dandruff Line"
- Belongs to: Brand + Category
- Used for: Agreement targeting (Actuals-First), reporting rollups

**FU (Forecasting Unit):**
- **Definition:** Planning-level aggregation for volume forecasting
- **Purpose:** Groups SKUs with same form factor, price point, but different variants
- **Planning-First specific:** FU is the primary planning level
- **Actuals-First usage:** Optional (can target FU if alignment with planning needed)

**FU Concept Explained:**
```
FU: "500ml X Series Shampoo"
├─ SKU: Pantene 500ml Parlak Renkler (Bright Colors variant)
├─ SKU: Pantene 500ml Bukleler (Curls variant)
└─ SKU: Pantene 500ml Besleyici (Nourishing variant)

Why FU?
- Same size (500ml) → same form factor
- Same price point → consistent ROI calculation
- Different variants → consumer preference, not promotional structure
- Planner forecasts: "We'll sell 10,000 units of 500ml segment (all variants)"
```

**SKU (Stock Keeping Unit):**
- Individual sellable product
- Examples: "Pantene 500ml Parlak Renkler", "Pantene 250ml Genel Bakım"
- Attributes: Barcode, unit price, size, variant
- Used for: Actuals tracking (invoice line items), detailed planning (optional)

#### Product Hierarchy Usage by Mode

**Actuals-First (Agreement Management):**
- Primary targeting level: **GU or FU**
- Agreement scope: "All Pantene Shampoo" (GU) or "500ml Shampoo segment" (FU)
- Invoice tracking: SKU level (detailed)
- Reporting: Rollup to GU → Category → Brand

**Planning-First (Volume Planning):**
- Primary planning level: **FU**
- Plan structure: FU → SKU volumes (optional detail)
- Volume forecasting: "10,000 units of 500ml Shampoo FU"
- ROI calculation: FU-level (consistent price point)
- Reporting: Rollup to GU → Category → Brand

#### Customer Hierarchy

**CPL (Customer/Planning Level):**
- Top-level customer entity for promotion planning
- Examples: "Carrefour", "Migros", "Distributor A"
- Used for: Agreement creation, Plan creation, Budget reporting

**Customer (Optional Granularity):**
- Individual outlet or sub-customer
- Examples: "Carrefour Levent Store", "Migros Kadıköy"
- Used for: Detailed actuals tracking (if needed)

**Channel Classification:**
- Traditional, NKA, Modern Trade, Wholesale
- **Critical:** Channel is NOT part of customer hierarchy
- Channel is an **attribute** of CPL (one CPL = one channel)
- Used for: Scope policies, budget dimensions, reporting

**Subchannel (Optional):**
- Finer channel segmentation
- Examples: "Traditional > Premium", "Traditional > Mass", "NKA > Hypermarket"
- Used for: Advanced scope policies, detailed reporting

**Region/Geography:**
- Geographic hierarchy: Country → Region → City
- CPL mapping: Each CPL belongs to a region
- Used for: Regional budget allocation, sales team assignment

#### Organizational Dimensions

**Channels:**
- User-definable channel types
- Standard: Traditional, NKA, Modern Trade, Wholesale
- Custom: Can add new channels (e.g., E-Commerce, Pharmacy)

**Regions:**
- Geographic hierarchy (Country → Region → City)
- Used for: Budget allocation, sales team structure

**Sales Teams:**
- Team assignments for approval routing
- Examples: "North Region Team", "NKA Strategic Team"
- Used for: Approval workflows, permissions

**Note on Categories:**
Categories are part of **Product Hierarchy** (not organizational dimensions), but serve dual purpose:
- Product attribute: Hair Care, Skin Care
- Budget dimension: Channel × Category × Period

#### UOM (Unit of Measure)

**Base UOM:**
- EA (Each), CS (Case), KG (Kilogram), LT (Liter)

**Conversion Factors:**
- 1 CS = 12 EA (configurable per SKU)
- Used for: Volume planning, invoice validation

**Multi-UOM Support:**
- Planning: Forecast in EA
- Invoicing: Receive in CS
- Reporting: Display in both

### Why Shared?

Master data is the **common language** across all promotion activities. A "500ml Shampoo FU" means the same thing whether referenced in an Agreement (Actuals-First) or a Plan (Planning-First). Sharing master data:
- Eliminates duplicate data entry
- Prevents reconciliation errors (no "is FU123 the same as FU_123?")
- Enables unified reporting (roll up from SKU → FU → GU → Category → Brand regardless of mode)
- Simplifies user experience (same dropdowns, same search, everywhere)

**Without shared master data:**
- ❌ Actuals and Planning use different product codes → reconciliation nightmare
- ❌ Finance can't aggregate (which "Shampoo" is which?)
- ❌ Users confused (different terminology per mode)

**With shared master data:**
- ✅ One SKU code, one FU code, one GU code — everywhere
- ✅ Unified reporting (Planning forecast vs. Actuals performance)
- ✅ Consistent terminology
- ✅ Single maintenance point

### Database Tables

**Product Hierarchy:**
- `brands`
- `categories` (with parent_category_id for hierarchy)
- `generic_units` (GU)
- `forecasting_units` (FU) — Planning-specific aggregation level
- `skus` (with optional fu_id reference)

**Customer Hierarchy:**
- `customers` (CPL + optional customer detail)
- `channels`
- `regions`

**Organizational:**
- `sales_teams`
- `uom`

### Schema Highlights

**Product Hierarchy:**
```sql
CREATE TABLE brands (
  id UUID PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE categories (
  id UUID PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  parent_category_id UUID REFERENCES categories(id), -- Hierarchy support
  level INT NOT NULL DEFAULT 1 -- 1=top level, 2=sub-category, etc.
);

CREATE TABLE generic_units (
  id UUID PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES brands(id),
  category_id UUID NOT NULL REFERENCES categories(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE forecasting_units (
  id UUID PRIMARY KEY,
  gu_id UUID NOT NULL REFERENCES generic_units(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL, -- "500ml Shampoo"
  
  -- FU attributes
  size VARCHAR(20), -- "500ml"
  segment VARCHAR(50), -- "Premium", "Mass", etc.
  
  -- Planning defaults
  is_plannable BOOLEAN DEFAULT true,
  default_base_volume NUMERIC(18,3), -- Historical baseline for planning
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE skus (
  id UUID PRIMARY KEY,
  gu_id UUID NOT NULL REFERENCES generic_units(id),
  fu_id UUID REFERENCES forecasting_units(id), -- Nullable (some SKUs not FU-mapped)
  
  code VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL, -- "Pantene 500ml Parlak Renkler"
  
  -- SKU attributes
  variant VARCHAR(100), -- "Parlak Renkler", "Bukleler", etc.
  size VARCHAR(20),
  barcode VARCHAR(50),
  unit_price NUMERIC(18,4),
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Navigation Examples:**

**Planning Workflow:**
```
User selects Brand → Category → GU → FU
└─ System shows: FU list with default volumes
   User selects FU → System expands to SKU list (optional detail)
```

**Actuals Workflow:**
```
User selects Brand → Category → GU (or FU if FU-level targeting)
└─ System validates against available GUs/FUs
   Invoice import → SKU-level line items
```

### Functional Scope (Summary)

**Product Master:**
- CRUD operations for all product hierarchy entities
- Bulk import/export (CSV, Excel)
- FU ↔ SKU mapping management
- Hierarchy validation (SKU must belong to FU, FU must belong to GU, etc.)
- Search and navigation (hierarchical drill-down)

**Customer Master:**
- CPL management (with channel assignment)
- Customer hierarchy (optional outlet detail)
- Region mapping
- Channel and subchannel definitions

**Master Data Governance:**
- Audit trail (who changed what, when)
- Soft delete (retain history, mark inactive)
- Data quality rules (e.g., barcode uniqueness, mandatory fields)
- Bulk update capabilities (Finance/Admin workflow)

---

## 3.2 User Management & RBAC

### Purpose

User Management & RBAC (Role-Based Access Control) provides **consistent authentication, authorization, and access control** across the platform. Users have a single identity with unified permissions that apply to both Actuals-First and Planning-First workflows.

### Key Capabilities

**User Management:**
- User accounts (username, email, full name)
- SSO integration (SAML 2.0 / OAuth 2.0)
- Password management (if local auth enabled)
- Session management (timeout, concurrent sessions)
- User status (active, inactive, locked)

**Role Definitions (Mode-Agnostic):**
- **Admin:** Full system control, configuration management
- **Planner:** Create agreements and/or plans (depending on permissions)
- **Approver:** Review and approve promotion requests
- **Finance:** Budget oversight, reporting access, approval authority
- **Read-Only:** View-only access for auditors, analysts

**Permission Model:**
- **Capability-based permissions:**
  - `agreements.create`, `agreements.view`, `agreements.approve`
  - `plans.create`, `plans.view`, `plans.approve` (Phase 2)
  - `reports.view`, `reports.export`
  - `admin.master_data`, `admin.scope_policies`, `admin.users`
- **Permission assignment:** Roles → Permissions (many-to-many)
- **Permission overrides:** User-level exceptions (use sparingly)

**Scope Policy Integration:**
- User permissions combined with scope policies determine available workflows
- Example: User has `plans.create` permission, but if channel scope = ACTUALS_FIRST, Plan workflow not shown

### Why Shared?

Users work across modes. An NKA Planner may create a Plan for quarterly JBP (Planning-First) and an Agreement for a spot deal (Actuals-First) — same user, same session, same permissions. Separate permission systems would create:
- Duplicate user management
- Inconsistent access control
- Audit trail fragmentation
- User confusion ("why do I log in twice?")

### Database Tables

- `users`
- `roles`
- `permissions`
- `role_permissions` (junction)
- `user_roles` (junction)
- `user_permission_overrides` (exceptions)

### Functional Scope (Summary)

- User CRUD (create, read, update, deactivate)
- Role management (define roles, assign permissions)
- Permission management (define capabilities, assign to roles)
- User-role assignment (users → roles, effective permissions calculation)
- SSO integration (SAML 2.0 configuration, OAuth 2.0 providers)
- Audit logging (login attempts, permission checks, role changes)

---

## 3.3 Budget Management

### Purpose

Budget Management provides **real-time, multi-dimensional budget tracking** with policy-driven governance across all promotion activities. The system uses an **envelope-based architecture** where budgets are defined as flexible containers that can be hierarchically organized and tracked through an immutable transaction log.

### Key Architectural Principles

**1. Envelope-Based Model:**
- Budgets are "envelopes" defined by flexible dimensions (channel, category, brand, etc.)
- Envelopes can be hierarchical (parent-child relationships)
- No hard-coded dimension combinations — policy-driven flexibility

**2. Event-Sourced State:**
- Budget state (committed, reserved, consumed) is derived from transactions and ledger
- No dual-write problems — single source of truth
- Complete audit trail by design

**3. Policy-Driven Governance:**
- Threshold alerts, approval requirements, reallocation rules all policy-configured
- Zero hard-coding — admin-adjustable via UI
- Different policies for different contexts (channel, category, etc.)

### Core Capabilities

#### Budget Envelope Management

**Flexible Dimensions:**
- **Channel:** Traditional, NKA, Modern Trade, Wholesale
- **Category:** Product category hierarchy (Hair Care, Skin Care, etc.)
- **Brand:** Brand-level budget tracking (optional)
- **Region:** Geographic budget allocation (optional)
- **Period:** Monthly, Quarterly, Annual

**Dimension Combinations (Examples):**
```
Channel × Category × Period (Month)  ← Phase 1 default
Brand × Channel × Period (Quarter)
Channel × Period (Year)
Region × Channel × Category × Period
```

**Canonical Key Generation:**
All dimension combinations are normalized to a canonical key to prevent duplicates:
- Keys: UPPERCASE_SNAKE_CASE
- Sorted alphabetically
- Example: `CATEGORY=HAIR_CARE|CHANNEL=TRADITIONAL`

**Hierarchical Structure:**
```
Total Budget (2026): $10M
├─ Traditional: $6M
│  ├─ Hair Care: $3M
│  │  ├─ Q1: $750K
│  │  │  ├─ Jan: $250K
│  │  │  ├─ Feb: $250K
│  │  │  └─ Mar: $250K
│  │  └─ Q2: $750K
│  └─ Skin Care: $3M
└─ NKA: $4M
```

#### Budget State Tracking

**Four States (Event-Sourced):**

| State | Source | Description |
|-------|--------|-------------|
| **Allocated** | budget_envelopes.total_allocated | Envelope amount (ceiling) |
| **Committed** | budget_transactions (COMMIT) | Planning-First: Plan approved |
| **Reserved** | budget_transactions (RESERVE - RELEASE) | Actuals-First: Agreement approved but not spent |
| **Consumed** | ledger_entries (budget_envelope_id) | Actual spend posted to ledger |
| **Available** | Derived: Allocated - Committed - Reserved - Consumed | Remaining budget |

**State Flow:**

**Planning-First:**
```
Allocated (1000) 
  → Plan approved → Committed (300) → Available (700)
  → Plan executed → Consumed (300) → Available (700) [Committed released]
```

**Actuals-First:**
```
Allocated (1000)
  → Agreement approved → Reserved (200) → Available (800)
  → Spend posted → Consumed (200) → Available (800) [Reserved released]
```

**Critical Design Decision:**
- committed/reserved/consumed are **not stored** in budget_envelopes table
- Instead, they are **computed** from budget_transactions and ledger_entries
- This eliminates dual-write issues and ensures consistency

#### Budget Transactions (Immutable Log)

Every budget change is logged as a transaction:

**Transaction Types:**
- **ALLOCATE:** Initial envelope creation
- **COMMIT:** Planning plan approved (reserve budget)
- **RESERVE:** Actuals agreement approved (reserve budget)
- **RELEASE:** Agreement cancelled (free reserved budget)
- **TRANSFER:** Move budget between envelopes
- **ADJUST:** Manual correction (admin only)

**Idempotency:**
Every transaction has an idempotency key:
```
Format: '<tx_type>|<source_type>|<source_id>|<envelope_id>'
Example: 'RESERVE|AGREEMENT|uuid-123|uuid-456'
```
Prevents duplicate reservations on retry/replay.

#### Budget Policies (Governance Rules)

**Policy Types:**

**1. Threshold Policies**
- **Warning:** Alert at 80% utilization
- **Approval:** Require approval at 90% utilization
- **Block:** Hard stop at 100% utilization

**2. Reallocation Policies**
- Transfer allowed within same parent? (Yes/No)
- Transfer allowed across channels? (Requires approval)
- Approval threshold: Transfers > $50K require Finance approval

**3. Overrun Policies**
- Overrun allowed? (Yes with approval / No hard block)
- Approval role: Who can approve overrun? (Finance, Regional Manager)

**4. Carry-Forward Policies**
- Unused budget rolls to next period? (Yes/No)
- Percentage limit: Max 20% can carry forward

**Policy Configuration (JSON):**
```json
{
  "policy_type": "THRESHOLD_APPROVAL",
  "applies_to_dimensions": { "channel": "TRADITIONAL" },
  "config": {
    "approval_percent": 90,
    "approval_role": "FINANCE",
    "notify_roles": ["REGIONAL_MANAGER", "FINANCE"]
  },
  "priority": 10
}
```

**Policy Matching (Containment-Based):**
- Policy applies if policy dimensions ⊆ envelope dimensions
- If multiple policies match, lowest priority number wins (most specific)

#### Period Management

**Period Types:**
- **MONTH:** 2026-01, 2026-02, etc.
- **QUARTER:** 2026-Q1, 2026-Q2, etc.
- **YEAR:** 2026

**Period Locking:**
- Finance locks period after close (e.g., Q1 closed on Apr 5)
- Locked periods cannot have new commitments/reservations
- Locked periods can be reopened by Finance (audit logged)

**Carry-Forward (Policy-Driven):**
- If policy allows, unused budget from Q1 → Q2
- Carry-forward is a TRANSFER transaction (audit trail preserved)

#### Budget vs Ledger Integration

**Critical Link:** `ledger_entries.budget_envelope_id`

When posting to ledger:
1. System determines applicable budget envelope (by channel, category, period)
2. Sets `ledger_entries.budget_envelope_id`
3. consumed is automatically calculated from ledger (view aggregates)

**Example:**
```sql
-- Agreement transaction posted to ledger
INSERT INTO ledger_entries (
  source_type, source_id, amount, period_month,
  channel, category, budget_envelope_id, -- ← Link!
  ...
) VALUES (
  'AGREEMENT', 'agr-123', 10000, '2026-01',
  'TRADITIONAL', 'HAIR_CARE', 'env-456', -- ← Mapped at posting time
  ...
);

-- consumed for envelope 'env-456' automatically updated via view
```

### Why Shared?

Budget is an **organizational constraint**, not mode-specific:
- Finance doesn't distinguish "Planning spend" vs "Actuals spend" — total matters
- Single budget pool prevents double-counting
- Unified tracking ensures real-time visibility
- Policy-driven governance applies uniformly

**Without unified budget:**
- ❌ Planning and Actuals each get separate budget → Risk of exceeding total
- ❌ Finance reconciliation nightmare (which mode consumed what?)
- ❌ No single answer to "how much budget remains?"

**With unified budget:**
- ✅ Both modes draw from same pool
- ✅ Real-time availability calculation
- ✅ Policy enforcement consistent
- ✅ Single reporting source

### Database Tables

**Core Tables:**
- `budget_envelopes` (envelope definitions with dimensions)
- `budget_transactions` (immutable event log)
- `budget_policies` (governance rules)

**Integration:**
- `ledger_entries.budget_envelope_id` (consumed tracking)

**Derived View:**
- `v_budget_summary` (real-time state calculation)

### Schema Highlights

**budget_envelopes:**
```sql
CREATE TABLE budget_envelopes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  parent_envelope_id UUID, -- Hierarchy support
  
  -- Flexible dimensions (JSONB)
  dimensions JSONB NOT NULL,
  dimensions_key TEXT NOT NULL, -- Canonical key for uniqueness
  
  -- Period (separate for querying)
  period_code VARCHAR(20) NOT NULL,
  period_type budget_period_type NOT NULL, -- MONTH | QUARTER | YEAR
  
  -- Budget amount
  total_allocated NUMERIC(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'TRY',
  
  -- Locking
  is_locked BOOLEAN NOT NULL DEFAULT false,
  
  -- Audit
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT uq_envelope_key UNIQUE (tenant_id, dimensions_key, period_code)
);
```

**budget_transactions:**
```sql
CREATE TABLE budget_transactions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  envelope_id UUID NOT NULL,
  
  tx_type budget_tx_type NOT NULL, -- COMMIT | RESERVE | RELEASE | TRANSFER
  tx_status budget_tx_status NOT NULL, -- PENDING | POSTED
  
  source_type VARCHAR(30), -- AGREEMENT | PLAN
  source_id UUID,
  
  amount NUMERIC(18,2) NOT NULL,
  
  -- Idempotency
  idempotency_key VARCHAR(200) NOT NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT uq_budget_tx_idempotency UNIQUE (tenant_id, idempotency_key)
);
```

**v_budget_summary (Derived View):**
```sql
CREATE VIEW v_budget_summary AS
SELECT
  e.id AS envelope_id,
  e.dimensions,
  e.period_code,
  e.total_allocated,
  
  -- Computed from transactions
  COALESCE(tx.committed, 0) AS committed,
  COALESCE(tx.reserved, 0) AS reserved,
  
  -- Computed from ledger
  COALESCE(lg.consumed, 0) AS consumed,
  
  -- Available
  (e.total_allocated - COALESCE(tx.committed, 0) 
   - COALESCE(tx.reserved, 0) - COALESCE(lg.consumed, 0)) AS available,
  
  -- Utilization %
  ROUND(((COALESCE(tx.committed, 0) + COALESCE(tx.reserved, 0) + COALESCE(lg.consumed, 0)) 
         / NULLIF(e.total_allocated, 0) * 100), 2) AS utilization_pct,
  
  -- RAG status
  CASE 
    WHEN utilization_pct >= 95 THEN 'RED'
    WHEN utilization_pct >= 80 THEN 'AMBER'
    ELSE 'GREEN'
  END AS rag_status
  
FROM budget_envelopes e
LEFT JOIN tx_summary tx ON ...
LEFT JOIN ledger_summary lg ON ...;
```

### Functional Scope (Summary)

**Budget Allocation:**
- Create envelopes with dimensions and period
- Hierarchical envelope relationships
- Bulk import from Excel/CSV (Finance workflow)

**Budget Tracking:**
- Real-time availability calculation
- Automatic state updates (from transactions + ledger)
- Period-based rollup (Month → Quarter → Year)

**Budget Governance:**
- Policy-driven threshold alerts
- Approval workflows for overruns
- Reallocation with approval (inter-envelope transfers)

**Budget Locking:**
- Period close/reopen (Finance only)
- Locked periods prevent new commitments

**Budget Reporting:**
- Utilization by envelope
- RAG status dashboard
- Budget vs. actual variance
- Drill-down from hierarchy

### Phase 1 Constraints (Simplicity)

To avoid configuration complexity in Phase 1:

**✅ Phase 1 Implementation (Actuals-First MVP):**

**Dimension Pattern:**
- Channel × Category × Period (Month) ONLY
- Single template, no multi-dimensional flexibility yet

**Budget State Tracking:**
- Allocated (envelope creation)
- Reserved (agreement approval)
- Consumed (ledger posting)
- Available (computed)

**Policies:**
- Threshold warning (80% utilization)
- Threshold approval (90% utilization, Finance role)
- Threshold block (100% utilization)

**Budget Operations:**
- Create envelope (manual, via Finance)
- Reserve budget (automatic on agreement approval)
- Consume budget (automatic on ledger posting)
- View utilization (v_budget_summary)

**❌ Explicitly NOT in Phase 1:**
- Envelope hierarchy (parent-child relationships exist in schema, not used)
- Multi-dimensional flexibility (Brand, Region dimensions)
- Reallocation workflows (Finance manually creates TRANSFER transactions if needed)
- Carry-forward (unused budget expires at period end)
- Overrun approval (hard block at 100%, no exceptions)
- Quarterly/Annual period types (Monthly only)
- Committed state (Planning-First introduces this in Phase 2)

**🔮 Phase 2 Expansion (Planning-First Activation):**
- Brand × Channel dimension combinations
- Region dimension support
- Quarterly/Annual period types
- Committed state (for approved plans)
- Reallocation policies with approval workflows
- Carry-forward rules
- Overrun approval exceptions

**Target Architecture Note:** The schema supports all these capabilities today (JSONB dimensions, policy engine, transaction types). Phase 1 simply constrains usage to the simplest pattern. This enables Phase 2 expansion without schema changes.

---

## 3.4 Approval Engine

### Purpose

The Approval Engine provides **policy-driven, multi-level approval workflows** that apply consistently across all promotion types. Whether approving an Agreement (Actuals-First) or a Plan (Planning-First), the same approval principles, notification mechanisms, and audit trails are used.

### Key Capabilities

**Policy-Driven Workflow:**
- **Approval policies table:** Defines rules for when approvals are required
- **JSON-configurable rules:** No hard-coding; admin-adjustable
- **Policy matching:** System finds applicable policy based on entity type, mode, channel, amount, tactic
- **Priority-based resolution:** If multiple policies match, highest priority wins

**Phase 1 Guardrail:** Approval policies are intentionally constrained to a small, opinionated set in early phases. Complex multi-conditional policies and edge case handling will be introduced progressively based on actual usage patterns, not anticipated scenarios.

**Multi-Level Approvals:**
- **Sequential approvals:** Step 1 must complete before Step 2 begins
- **Parallel approvals:** (Optional Phase 2) Multiple approvers at same level
- **Role-based assignment:** Approval steps assigned to roles (e.g., "REGIONAL_MANAGER", "FINANCE")
- **Conditional steps:** Approval level may depend on amount threshold or ROI metric

**Approval Request Lifecycle:**
- **PENDING:** Submitted, awaiting approval
- **APPROVED:** All steps approved
- **REJECTED:** Any step rejected (entire request fails)
- **CANCELLED:** Requester cancels before completion

**Notifications:**
- **Approval request:** Notify assigned approvers (email + in-app)
- **Approval decision:** Notify requester and stakeholders
- **Escalation:** (Optional) Auto-escalate if approval delayed > N days

**Audit Trail:**
- Complete history of approval requests
- Who approved/rejected, when, decision reason
- Changes to approval policies logged

### Why Shared?

Governance principles apply **universally**. Whether it's a $100K Agreement or a $100K Plan, Finance needs to approve. Separate approval systems would create:
- Inconsistent governance (different rules for same spend level)
- Fragmented audit trail (can't see all pending approvals in one place)
- Duplicate configuration (maintain two approval rule sets)
- User confusion (Approvers see two different UIs)

**Example:**
```
Policy: "Agreements > $50K require Finance approval"
Policy: "Plans > $50K require Finance approval"

Unified: "Any promotion > $50K requires Finance approval"
         (applies to both entity_type = AGREEMENT and entity_type = PLAN)
```

### Database Tables

- `approval_policies` (policy definitions)
- `approval_requests` (promotion approval requests)
- `approval_steps` (individual approval steps per request)
- `approval_history` (audit log)

### Policy Configuration Example (JSON)

```json
{
  "entity_type": "AGREEMENT",
  "mode": "ACTUALS",
  "approval_levels": [
    {
      "order": 1,
      "role": "REGIONAL_MANAGER",
      "when": { "agreement_type": "STA", "amount_gte": 0 }
    },
    {
      "order": 2,
      "role": "FINANCE",
      "when": { "agreement_type": "LTA" }
    }
  ],
  "requires_justification": true,
  "min_justification_length": 50
}
```

### Functional Scope (Summary)

- Approval policy management (CRUD, priority, activation)
- Approval request creation (on submit for approval)
- Approval step generation (based on policy rules)
- Approval decision capture (approve/reject, reason, timestamp)
- Notification dispatch (email, in-app)
- Escalation handling (optional)
- Approval dashboard (pending approvals by role)
- Audit reporting (approval history, turnaround time)

---

## 3.5 Tactic Library & Policies

### Purpose

The Tactic Library provides a **centralized catalog of promotion tactics** (e.g., "Off-Invoice Rebate", "Display Allowance") with **mode-specific policy configurations**. A tactic represents the "intent" of the promotion; the same tactic can be used in Actuals-First (as part of an Agreement) or Planning-First (as part of a Plan), but with different validation rules.

### Key Capabilities

**Tactic Definitions:**
- **Tactic catalog:** Predefined list of promotion types
- **Tactic metadata:**
  - Name (e.g., "Off-Invoice Rebate")
  - Description
  - Category (On-Invoice, Off-Invoice, Lumpsum)
  - Mechanic types supported (PERCENT, AMOUNT, AMOUNT_PER_UNIT)

**Mechanic Types:**
- **PERCENT:** Discount as percentage (e.g., 10% off)
- **AMOUNT:** Fixed amount (e.g., $500 lumpsum payment)
- **AMOUNT_PER_UNIT:** Per-unit support (e.g., $0.50 per unit sold)

**Tactic Policies (Mode-Specific):**
- **Actuals-First configuration:**
  - `enabled_in_actuals`: true/false
  - `actuals_config` (JSONB): Validation rules for Agreements
    - Example: `{ "requires_fu": true, "max_duration_days": 30, "max_support_percent": 40 }`
- **Planning-First configuration:**
  - `enabled_in_planning`: true/false
  - `planning_config` (JSONB): Validation rules for Plans
    - Example: `{ "requires_baseline": true, "min_uplift_percent": 5 }`

**Policy Enforcement:**
- System validates Agreement/Plan against tactic policy rules
- Invalid entries blocked at point of entry (not at approval)
- Policy violations surfaced with clear error messages

### Why Shared?

Tactics represent **business concepts** that transcend modes. "Display Allowance" means the same thing whether used in an Agreement or a Plan. However, the **rules** differ:
- Actuals: Must specify invoice, may not require baseline
- Planning: Must specify baseline volume, may require ROI threshold

Sharing tactics:
- Ensures consistent terminology (no "Rebate" in Actuals vs. "Discount" in Planning)
- Centralizes policy management (one place to update rules)
- Enables cross-mode reporting (total spend by tactic, regardless of mode)

### Database Tables

- `tactics` (tactic catalog)
- `mechanics` (mechanic definitions)
- `tactic_policies` (mode-specific rules)

### Policy Configuration Example (JSON)

**Actuals Config:**
```json
{
  "requires_justification": true,
  "min_justification_length": 50,
  "requires_fu": true,
  "max_duration_days": 30,
  "allowed_mechanic_types": ["PERCENT", "AMOUNT"],
  "max_support_percent": 40.0,
  "approval_policy_key": "ACTUALS_STA_DEFAULT"
}
```

**Planning Config:**
```json
{
  "requires_baseline": true,
  "requires_planned_volume": true,
  "allowed_mechanic_types": ["PERCENT", "AMOUNT_PER_UNIT"],
  "max_discount_percent": 40.0,
  "min_uplift_percent": 5.0,
  "approval_policy_key": "PLANNING_DEFAULT"
}
```

### Functional Scope (Summary)

- Tactic catalog management (CRUD)
- Tactic policy configuration (per mode)
- Policy validation engine (validate agreement/plan against policy)
- Tactic usage reporting (which tactics used most)
- Admin UI for policy editing (JSON editor with validation)

---

## 3.6 Ledger & Spend Tracking

### Purpose

The Ledger provides a **unified transaction log** for all promotional spend across the platform. Every Agreement transaction (Actuals-First) and every Plan execution (Planning-First) posts to the same ledger, creating a **single source of truth** for financial reporting, audit, and reconciliation.

**Scope Boundary:** Ledger is a financial traceability mechanism, not an accounting system. It tracks promotional spend attribution and audit trails, but does not replace GL accounting, accounts payable processing, or ERP financial modules.

### Key Capabilities

**Unified Ledger Entry:**
- **source_type:** AGREEMENT | PLAN (identifies origin)
- **source_id:** Foreign key to agreement or plan
- **spend_type:** ON_INVOICE | OFF_INVOICE | ADJUSTMENT | ACCRUAL
- **entry_direction:** DEBIT (+spend) | CREDIT (-spend, reversal)
- **amount:** Transaction amount (always positive; sign indicated by direction)
- **currency:** Transaction currency (default TRY)
- **period_month:** Accounting period (YYYY-MM format)
- **posting_date:** Transaction date
- **dimensions:** channel, cpl_id, customer_id, fu_id, sku_id, tactic_id, mechanic_id

**Posting Mechanics:**
- **Actuals-First:** agreement_transactions → ledger_entries (automatic on approval)
- **Planning-First:** plan_execution → ledger_entries (Phase 2, on realization)
- **Batch operations:** Off-invoice batch import posts multiple ledger entries atomically

**Reversal & Adjustment:**
- **Reversal:** Create offsetting CREDIT entry, link via `reversed_entry_id`
- **Adjustment:** Create new entry with adjusted amount, reference original
- **Audit preservation:** Original entries never deleted, always traceable

**Idempotency:**
- Prevents duplicate postings (e.g., same off-invoice invoice posted twice)
- Unique constraints on source + period + spend_type
- File hash check for batch imports

**Period Closing:**
- Month-end close: Mark period as closed (no new postings allowed)
- Reopening: Admin can reopen if adjustments needed (audit logged)

### Why Shared?

Finance needs **one view of spend**, not two. Separate ledgers would create:
- Reconciliation hell ("what's our total spend?")
- Double-entry risk (same transaction in both ledgers)
- Fragmented audit trail (can't trace all spend in one query)
- Reporting complexity (union queries everywhere)

**Example:**
```sql
-- Total spend for Q1 2026, all modes, all channels
SELECT SUM(amount) 
FROM ledger_entries
WHERE tenant_id = 'tenant-x'
  AND period_month BETWEEN '2026-01' AND '2026-03'
  AND entry_direction = 'DEBIT'
  AND status = 'POSTED';

-- No need to UNION between actuals_ledger and planning_ledger
```

### Database Tables

- `ledger_entries` (main ledger)
- `ledger_entry_reversals` (audit trail for reversals)

### Schema Highlights

```sql
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  
  -- Source
  source_type VARCHAR(30) NOT NULL,  -- 'AGREEMENT' | 'PLAN'
  source_id UUID NOT NULL,
  
  -- Transaction
  spend_type VARCHAR(20) NOT NULL,    -- 'ON_INVOICE' | 'OFF_INVOICE' | ...
  entry_direction VARCHAR(10) NOT NULL, -- 'DEBIT' | 'CREDIT'
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'TRY',
  
  -- Period
  period_month CHAR(7) NOT NULL,      -- 'YYYY-MM'
  posting_date DATE NOT NULL,
  
  -- Dimensions (for reporting)
  channel VARCHAR(30) NOT NULL,
  cpl_id UUID NOT NULL,
  customer_id UUID,
  fu_id UUID,
  sku_id UUID,
  tactic_id UUID,
  mechanic_id UUID,
  
  -- Audit
  account_code VARCHAR(50),           -- Optional GL mapping
  reference_code VARCHAR(100),        -- Invoice number, etc.
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'POSTED',
  reversed_entry_id UUID,             -- Link to reversed entry
  
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Critical indexes
CREATE INDEX idx_ledger_tenant_period 
  ON ledger_entries(tenant_id, period_month);
CREATE INDEX idx_ledger_source 
  ON ledger_entries(tenant_id, source_type, source_id);
CREATE INDEX idx_ledger_dimensions 
  ON ledger_entries(tenant_id, cpl_id, tactic_id, period_month);
```

### Functional Scope (Summary)

- Ledger posting (from agreements, plans, batch imports)
- Reversal processing (create offsetting entry)
- Adjustment processing (new entry with correction)
- Period closing/reopening
- Idempotency enforcement (duplicate prevention)
- Ledger query API (for reporting, dashboards)
- Reconciliation reports (ledger vs. ERP)
- Audit trail export

---

## 3.7 Summary: Shared Core Benefits

The shared core architecture delivers tangible benefits:

| Benefit | Impact |
|---------|--------|
| **Single Source of Truth** | No reconciliation between modes; one master data set, one ledger |
| **Consistent Governance** | Same approval principles, same budget rules, regardless of workflow |
| **Unified Reporting** | Finance Dashboard shows all spend; no mode-specific silos |
| **Simplified User Experience** | Users learn one set of concepts, one permission model, one UI paradigm |
| **Reduced Development Cost** | Core components built once, reused by both modes |
| **Easier Maintenance** | Bug fixes and enhancements in core benefit both modes |
| **Phased Deployment** | Actuals-First MVP leverages core; Planning-First activation reuses core |

---

## 3.8 Technical Notes

**API Design:**
- Core components expose RESTful APIs
- Both Actuals-First and Planning-First modules consume same APIs
- Example: `POST /api/v1/ledger/entries` (called by both Agreement and Plan posting logic)

**Database Design:**
- Core tables (master data, budget, ledger) have no mode-specific columns
- Mode-specific tables (agreements, plans) reference core via foreign keys
- Clean separation enables independent scaling

**Performance Considerations:**
- Ledger queries optimized with period-based indexing
- Budget availability calculated efficiently (indexed queries)
- Master data cached at application layer (reduce DB load)

---

**Next Section Preview:**  
Section 4 will provide the **full specification** for Actuals-First Mode, including detailed functional requirements, database schemas, user stories, and acceptance criteria for Agreements, Off-Invoice Import, and Spend Tracking.

---

*End of Section 3: Core/Shared Components (Overview)*

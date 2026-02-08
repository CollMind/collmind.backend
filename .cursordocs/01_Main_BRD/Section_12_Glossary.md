# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 12

---

# 12. GLOSSARY

## Introduction

This section defines **the precise meaning of key terms** used throughout the BRD. It eliminates ambiguity, ensures consistent interpretation, and serves as a permanent reference for all stakeholders.

**Purpose:** Every organization uses trade promotion terminology differently. This glossary establishes CollMind's definitions — the "single source of truth" for discussions, documentation, and future enhancements.

**How to Use:** When any term in this BRD is unclear or disputed, refer to this glossary. If a term is not defined here, it uses common industry meaning.

---

## A

### Actuals-First Mode
**Definition:** An operational mode where promotional agreements are created reactively after commercial terms are negotiated, then tracked for budget consumption and compliance.

**Key Characteristics:**
- Speed-focused (create agreement in <5 minutes)
- Terms-driven (discount %, lumpsum amounts)
- No forecasting required
- Budget reserved at approval, consumed at invoice posting

**Contrast with Planning-First:** Actuals-First captures execution; Planning-First optimizes strategy.

**Example:** Regional Manager negotiates 10% off-invoice rebate with distributor → creates STA in CollMind → gets approval → tracks invoices against cap.

**Related Terms:** Agreement, STA, LTA, Off-Invoice

---

### Agreement
**Definition:** A formal record in CollMind documenting a promotional arrangement between the company and a customer (or customer planning level). Agreements are the core entity in Actuals-First Mode.

**Types:**
- **STA (Short-Term Agreement):** One-time, time-bound promotion (e.g., 1-month campaign)
- **LTA (Long-Term Agreement):** Recurring or extended promotion (e.g., 6-month annual deal)

**Lifecycle:** Draft → Pending → Approved → Active → Closed

**Key Attributes:**
- CPL (customer planning level)
- Tactics and mechanics (e.g., CPP 10%, Display Fee 2,000 TL)
- Cap amount (spending limit)
- Validity period (start/end dates)

**Related Terms:** STA, LTA, CPL, Tactic, Mechanic, Cap

---

### Approval Policy
**Definition:** A rule set that determines who must approve an agreement or plan, in what order, and under what conditions.

**Components:**
- **Approval Levels:** Sequential approvers (Level 1: Category Manager, Level 2: Finance)
- **Routing Conditions:** Thresholds that trigger levels (e.g., amount ≥50K TL → Finance approval required)
- **Auto-Reject Rules:** Conditions that automatically reject without human review (e.g., GP ROI <5%)

**Example Policy:**
```
NKA Plan Approval:
- Level 1: Category Manager (always required)
- Level 2: Finance (if amount ≥50K OR GP ROI <15%)
- Auto-Reject: If GP ROI <5%
```

**Related Terms:** Approval Workflow, Sequential Approval, Threshold

---

## B

### Baseline (Baseline Volume)
**Definition:** Historical sales volume for a given customer × product × period, used as the reference point for calculating incremental volume and uplift in Planning-First Mode.

**Typical Granularity:** Customer × SKU × Week (or Month)

**Source:** ERP sales data, data warehouse, or manual import

**Usage:** Planner enters Planned Volume; system calculates Incremental Volume = Planned - Baseline

**Example:**
```
Baseline Volume (SKU123, Carrefour, Week 1): 1,000 units
Planned Volume: 1,200 units
Incremental Volume: 200 units (20% uplift)
```

**Critical Requirement:** Baseline must have ≥95% SKU coverage for Planning-First plans to be approved (data quality gate).

**Related Terms:** Incremental Volume, Uplift %, Planning-First Mode

---

### Budget Envelope
**Definition:** A financial container that allocates a specific amount of money to a dimension (typically Channel × Category × Period) for promotional spending.

**Purpose:** Control total trade spend, prevent overruns, enable utilization tracking

**Dimensions (Phase 1):**
- Channel (e.g., NKA, Modern Trade)
- Category (e.g., Hair Care, Personal Care)
- Period (e.g., 2026-01, Q1 2026)

**States (via Ledger Transactions):**
- **Allocated:** Total budget amount
- **Reserved:** Amount locked by approved Actuals-First agreements
- **Committed:** Amount locked by approved Planning-First plans
- **Consumed:** Actual spend that has occurred (invoices posted)
- **Available:** Allocated - (Reserved + Committed + Consumed)

**RAG Status:**
- 🟢 Green: <80% utilization
- 🟡 Amber: 80-95% utilization
- 🔴 Red: >95% utilization

**Related Terms:** Ledger, Reserve, Commit, Consume, RAG

---

## C

### Cap (Cap Amount)
**Definition:** The maximum spending limit for an Actuals-First agreement. Once the cap is reached, no further spend can be tracked against that agreement.

**Purpose:** Prevent uncontrolled spending, enforce agreed terms

**Example:**
```
Agreement: STA-2026-025
Cap: 15,000 TL
Consumed: 12,500 TL (83% utilization)
Remaining: 2,500 TL
```

**Cap Breach:** When consumed amount exceeds cap (alert triggered, requires Finance override)

**Related Terms:** Agreement, Consumed Amount, Off-Invoice

---

### COGS (Cost of Goods Sold)
**Definition:** The direct cost to produce or purchase one unit of a product (SKU). Used to calculate Gross Profit and GP ROI in Planning-First Mode.

**Source:** ERP system, Finance master data

**Example:**
```
SKU: Wella SP Balance 500ml
List Price: 95 TL
COGS: 42 TL
Gross Profit per Unit: 95 - 42 = 53 TL
```

**Critical Requirement:** COGS must be accurate and refreshed monthly for ROI calculations to be trusted.

**Related Terms:** Gross Profit, GP ROI, List Price

---

### Commit (Budget State)
**Definition:** A budget state transition where allocated funds are locked for an approved Planning-First plan. Committed budget cannot be used by other plans until the original plan is closed or cancelled.

**Budget Lifecycle (Planning-First):**
1. Plan created (Draft) → No budget impact
2. Plan approved → Budget COMMITTED (ledger transaction: COMMIT)
3. Plan executed → Budget CONSUMED (invoices posted)

**Contrast with Reserve:** Reserve is for Actuals-First agreements; Commit is for Planning-First plans.

**Related Terms:** Budget Envelope, Ledger, Reserve, Consume

---

### Consume (Budget State)
**Definition:** A budget state transition where actual spend occurs (invoices posted). This is the final step in budget utilization.

**Trigger:** Off-invoice batch imported → Transactions linked to agreements/plans → Ledger entries created (type: CONSUME)

**Example:**
```
Invoice: INV-2026-001, Amount: 2,250 TL
Linked to: Agreement STA-2026-025
Ledger Entry: CONSUME, 2,250 TL from Budget Envelope "NKA / Hair Care / Jan"
```

**Related Terms:** Budget Envelope, Ledger, Reserve, Commit

---

### CPL (Customer Planning Level)
**Definition:** An aggregation of one or more customers used for agreement creation in Actuals-First Mode. CPLs simplify promotional management when multiple customers share the same terms.

**Purpose:** Avoid creating separate agreements for each customer in a group

**Example:**
```
CPL: "Modern Trade - Istanbul"
Includes Customers:
- Metro Cash & Carry
- Kipa
- Real
Agreement applies to all 3 customers simultaneously
```

**Related Terms:** Customer, Agreement, Actuals-First Mode

---

## F

### FU (Forecasting Unit)
**Definition:** An aggregation of SKUs used for volume planning and tactic definition in Planning-First Mode. FUs represent product groupings at a level where promotional decisions are made.

**Purpose:** Planners don't forecast at SKU-level granularity; they forecast at brand/format/size level

**Example:**
```
FU: "Wella SP Balance Shampoo Range"
Includes SKUs:
- Wella SP Balance 250ml
- Wella SP Balance 500ml
- Wella SP Balance 1000ml

Planner defines:
- Tactic at FU level: CPP 10%
- Volume at SKU level: 2,500 units, 4,000 units, 1,500 units
```

**Hierarchy:** GU (Group Unit) > FU > SKU

**Related Terms:** SKU, GU, Planning-First Mode, Planning Grid

---

## G

### GP ROI (Gross Profit ROI)
**Definition:** A profitability metric calculated in Planning-First Mode: (Incremental Gross Profit / Total Planned Spend) × 100%.

**Formula:**
```
Incremental GP = Planned GP - Base GP
GP ROI % = (Incremental GP / Total Planned Spend) × 100
```

**Interpretation:**
- GP ROI ≥20%: 🟢 Green (excellent profitability)
- GP ROI 10-20%: 🟡 Amber (acceptable, watch closely)
- GP ROI <10%: 🔴 Red (poor profitability, approval at risk)

**Example:**
```
Incremental GP: 58,000 TL
Total Planned Spend: 180,000 TL
GP ROI = (58,000 / 180,000) × 100 = 32.2% 🟢
```

**Contrast with TO ROI (Turnover ROI):** GP ROI uses profit; TO ROI uses revenue. Finance prefers GP ROI.

**Related Terms:** Incremental GP, Total Planned Spend, RAG Status

---

### GU (Group Unit)
**Definition:** An aggregation of Forecasting Units (FUs), providing an additional hierarchical level above FU. Optional in Phase 1.

**Purpose:** Large portfolios need 3-level hierarchy (GU > FU > SKU) for manageability

**Example:**
```
GU: "Wella Professional Hair Care"
Includes FUs:
- SP Balance Range
- SP Repair Range
- SP Volumize Range
```

**Related Terms:** FU, SKU, Planning Grid

---

## I

### Idempotency
**Definition:** The property of an operation where performing it multiple times has the same effect as performing it once. In CollMind, idempotency prevents duplicate data imports.

**Implementation:**
- **File Hash:** Detect duplicate file uploads
- **Record Key:** Detect duplicate records (e.g., same invoice imported twice)

**Example:**
```
User uploads "invoices_20260106.csv" twice
→ System detects duplicate file hash
→ Second upload rejected: "This file was already imported on 2026-01-06 10:30 AM"
```

**Related Terms:** Off-Invoice Import, Baseline Import, Data Integration

---

### Incremental Volume
**Definition:** The additional sales volume expected from a promotion, calculated as Planned Volume - Baseline Volume.

**Formula:**
```
Incremental Volume = Planned Volume - Baseline Volume
```

**Example:**
```
Baseline Volume: 1,000 units
Planned Volume: 1,200 units
Incremental Volume: 200 units
Uplift %: 20%
```

**Why Important:** GP ROI calculation depends on incremental profit, not total profit. Without uplift, the promotion is unprofitable.

**Related Terms:** Baseline Volume, Uplift %, GP ROI

---

## K

### KPI (Key Performance Indicator)
**Definition:** A calculated metric that measures promotional performance. In CollMind, KPIs are formula-driven and stored as metadata (not hardcoded).

**Examples:**
- Volume KPIs: BASE_VOL, PLANNED_VOL, INCR_VOL, VOL_UPLIFT_PCT
- Profit KPIs: BASE_GP, PLANNED_GP, INCR_GP
- ROI KPIs: GP_ROI_PCT, TO_ROI_PCT

**KPI Engine:** 40+ KPIs calculated in dependency order (topological sort) in <500ms for 50 SKUs

**Formula Example:**
```
KPI: GP_ROI_PCT
Formula: (INCR_GP / TOTAL_PLANNED_SPEND) × 100
Depends On: [INCR_GP, TOTAL_PLANNED_SPEND]
Calculation Order: 38 (runs after dependencies)
```

**Related Terms:** Formula, Dependency Graph, Planning-First Mode

---

## L

### Ledger (Budget Ledger)
**Definition:** An immutable transaction log that records all budget state changes. The ledger is the single source of truth for budget utilization.

**Transaction Types:**
- **ALLOCATE:** Initial budget allocation (e.g., 215,000 TL to NKA / Hair Care / Jan)
- **RESERVE:** Agreement approved (Actuals-First)
- **COMMIT:** Plan approved (Planning-First)
- **CONSUME:** Spend occurred (invoices posted)
- **RELEASE:** Agreement/plan cancelled (funds returned to envelope)

**Example Ledger:**
```
Envelope: NKA / Hair Care / 2026-01

Txn 1: ALLOCATE, +215,000 TL (allocated budget)
Txn 2: RESERVE,  -25,000 TL (Agreement STA-2026-025 approved)
Txn 3: COMMIT,   -35,000 TL (Plan Q1-NKA-Carrefour approved)
Txn 4: CONSUME,  -12,500 TL (Invoice INV-001 posted)
Current State:
- Allocated: 215,000
- Reserved: 25,000 (minus 12,500 consumed = 12,500 remaining reserved)
- Committed: 35,000
- Consumed: 12,500
- Available: 142,500
```

**Key Property:** Ledger is append-only (transactions never deleted, only corrective transactions added).

**Related Terms:** Budget Envelope, Reserve, Commit, Consume

---

### LTA (Long-Term Agreement)
**Definition:** An Actuals-First agreement that spans multiple periods or has recurring terms (e.g., annual deal, quarterly rebate).

**Contrast with STA:** STA is one-time/short-duration; LTA is extended/recurring.

**Example:**
```
LTA: Carrefour Annual Rebate 2026
- CPP: 8% off-invoice (applied to all purchases)
- Duration: 2026-01-01 to 2026-12-31
- Cap: 500,000 TL (annual limit)
- Settlement: Quarterly (Q1, Q2, Q3, Q4)
```

**Related Terms:** Agreement, STA, CPL, Actuals-First Mode

---

## M

### Mechanic
**Definition:** A specific implementation of a tactic, defining how the promotional value is calculated and applied.

**Example:**
```
Tactic: CPP (Customer Price Promotion)
Mechanics:
- CPP On-Invoice % (percentage applied to on-invoice sales)
- CPP Off-Invoice % (percentage applied to off-invoice sales)
- CPP Lumpsum (fixed amount, not percentage)
```

**Contrast with Tactic:** Tactic is the high-level category; mechanic is the calculation method.

**Related Terms:** Tactic, Agreement, Plan

---

### Mode (Operational Mode)
**Definition:** A conceptual distinction in CollMind describing whether a promotion is created reactively (Actuals-First) or proactively (Planning-First). Mode is not user-selected; it is resolved by context.

**Two Modes:**
1. **Actuals-First Mode:** Reactive, speed-focused, terms-driven
2. **Planning-First Mode:** Proactive, ROI-optimized, forecast-driven

**Mode Resolution Factors:**
- Tactic eligibility (some tactics only available in Planning-First)
- Baseline data availability (Planning-First requires baseline)
- Channel maturity (NKA → Planning-First; Traditional Trade → Actuals-First)
- User workflow (create Agreement → Actuals; create Plan → Planning)

**Key Clarification:** Mode is not a system-wide toggle. Both modes coexist within the same organization, channel, or even customer.

**Contrast with Capability:** Mode is conceptual; capability is a permission (e.g., `plan.create`).

**Related Terms:** Actuals-First, Planning-First, Context Resolution

---

## O

### Off-Invoice
**Definition:** Promotional spending that does not appear as a line-item discount on the original customer invoice. Off-invoice spend is settled separately (e.g., credit note, bank transfer, deduction).

**Types:**
- Rebates (e.g., 10% off-invoice rebate, paid quarterly)
- Display fees (e.g., 2,000 TL for in-store display)
- Visibility lumpsums (e.g., 5,000 TL for catalog placement)

**Contrast with On-Invoice:** On-invoice is deducted at point of sale (customer sees discount on invoice); off-invoice is settled later.

**Tracking in CollMind:**
- Actuals-First: Off-invoice batch imported → Linked to agreements → Cap consumption tracked
- Planning-First: Off-invoice tactics included in Total Planned Spend → GP ROI calculation

**Related Terms:** Agreement, Cap, Invoice Import

---

## P

### Plan (Promotional Plan)
**Definition:** A forward-looking forecast of promotional volumes, tactics, and expected profitability. Plans are the core entity in Planning-First Mode.

**Lifecycle:** Draft → Pending → Approved → Active → Closed

**Key Components:**
- Hierarchical FU/SKU structure
- Volume planning (Base, Planned, Incremental)
- Tactic definition at FU level
- KPI calculation (40+ KPIs)
- ROI evaluation (GP ROI %, RAG status)

**Example:**
```
Plan: Q1 2026 NKA Carrefour Hair Care JBP
- 3 FUs, 24 SKUs
- Total Planned Volume: 13,200 units
- Total Planned Spend: 180,000 TL
- GP ROI: 32.2% 🟢
- Status: Approved
```

**Related Terms:** Planning-First Mode, FU, SKU, KPI, GP ROI

---

### Planning Grid
**Definition:** The hierarchical UI (user interface) in Planning-First Mode where planners input volumes, define tactics, and see real-time KPI calculations.

**Structure:**
- **Level 1 (FU Row):** Tactics defined here, KPIs aggregated
- **Level 2 (SKU Rows):** Volumes entered here, KPIs calculated

**Key Features:**
- Expand/collapse FUs
- Real-time calculation (<500ms)
- Grand Totals Panel (6 key metrics)
- RAG status visualization (per SKU, per FU, per Plan)

**Related Terms:** Plan, FU, SKU, KPI Calculation Engine

---

### Planning-First Mode
**Definition:** An operational mode where promotional plans are created proactively with volume forecasts, profitability analysis, and ROI optimization before budget commitment.

**Key Characteristics:**
- Strategic (ROI-driven decision-making)
- Forecast-required (volumes, tactics, baselines)
- Budget committed (not reserved) at approval
- What-if simulation enabled

**Workflow:**
1. Load baseline data
2. Create plan (FU/SKU hierarchy)
3. Enter planned volumes
4. Define tactics at FU level
5. KPIs calculate automatically
6. RAG status evaluated
7. Optimize (what-if scenarios)
8. Submit for approval (ROI-based policy)
9. Approved → Budget COMMITTED

**Contrast with Actuals-First:** Planning-First optimizes strategy; Actuals-First captures execution.

**Related Terms:** Plan, Planning Grid, KPI, GP ROI, Baseline

---

## R

### RAG Status
**Definition:** A visual indicator (Red/Amber/Green) that signals profitability performance, typically based on GP ROI %.

**Thresholds (Configurable):**
- 🟢 Green: GP ROI ≥20% (excellent profitability)
- 🟡 Amber: GP ROI 10-20% (acceptable, monitor)
- 🔴 Red: GP ROI <10% (poor profitability, approval at risk)

**Usage:**
- Displayed at SKU, FU, and Plan levels
- Used in approval policies (e.g., auto-reject if Red)
- Aggregated: Any Red → FU Red; No Red but Amber → FU Amber; All Green → FU Green

**Related Terms:** GP ROI, Planning-First Mode, Approval Policy

---

### Reserve (Budget State)
**Definition:** A budget state transition where allocated funds are locked for an approved Actuals-First agreement. Reserved budget cannot be used by other agreements until the original agreement is closed or cap fully consumed.

**Budget Lifecycle (Actuals-First):**
1. Agreement created (Draft) → No budget impact
2. Agreement approved → Budget RESERVED (ledger transaction: RESERVE)
3. Invoices posted → Budget CONSUMED (RESERVE amount decreases)

**Contrast with Commit:** Reserve is for Actuals-First agreements; Commit is for Planning-First plans.

**Related Terms:** Budget Envelope, Ledger, Commit, Consume

---

### ROI (Return on Investment)
**Definition:** A profitability metric measuring the return generated per unit of spend. In CollMind, two types:

1. **GP ROI (Gross Profit ROI):** (Incremental GP / Total Planned Spend) × 100%
   - Preferred by Finance (uses profit, not revenue)
   
2. **TO ROI (Turnover ROI):** (Incremental GSV / Total Planned Spend) × 100%
   - Easier to calculate (no COGS required)

**CollMind Standard:** GP ROI is primary metric for approval decisions

**Related Terms:** GP ROI, TO ROI, Incremental GP, Total Planned Spend

---

## S

### SKU (Stock Keeping Unit)
**Definition:** The most granular product identifier, representing a specific sellable item (brand, format, size, variant).

**Example:**
```
SKU: Wella SP Balance Shampoo 500ml
Brand: Wella
Category: Hair Care
Subcategory: Shampoo
Format: Bottle
Size: 500ml
```

**Hierarchy:** GU > FU > SKU

**Usage in CollMind:**
- Master data imported from ERP
- Volume planning occurs at SKU level (Planning-First)
- KPI calculations start at SKU level, then aggregate to FU/Plan

**Related Terms:** FU, GU, Master Data

---

### STA (Short-Term Agreement)
**Definition:** An Actuals-First agreement for a one-time or short-duration promotion (typically <3 months).

**Contrast with LTA:** STA is short/one-time; LTA is extended/recurring.

**Example:**
```
STA: Ramadan Campaign 2026 - Özgür Kozmetik
- Tactic: Off-Invoice Rebate 12%
- Duration: 2026-03-01 to 2026-03-31 (1 month)
- Cap: 8,000 TL
```

**Related Terms:** Agreement, LTA, CPL, Actuals-First Mode

---

## T

### Tactic
**Definition:** A high-level promotional mechanism type (e.g., Customer Price Promotion, Display Fee, Price Support).

**Examples:**
- CPP (Customer Price Promotion): On-invoice or off-invoice discounts
- Display Fee: Payment for in-store visibility
- Price Support: Per-unit subsidy to lower end-customer price
- Visibility Lumpsum: Fixed payment for catalog/flyer placement

**Tactic Properties:**
- **Applicability Rules:** Which channels/categories can use this tactic
- **Spending Type:** On-Invoice vs Off-Invoice
- **Mechanics:** How value is calculated (%, per unit, lumpsum)

**Contrast with Mechanic:** Tactic is the category; mechanic is the calculation method.

**Related Terms:** Mechanic, Agreement, Plan

---

### Total Planned Spend
**Definition:** The sum of all promotional spending planned for a given plan, including on-invoice and off-invoice tactics.

**Formula (Simplified):**
```
Total Planned Spend = 
  CPP On Spend + 
  CPP Off Spend + 
  Display Fees + 
  Price Support Spend + 
  Visibility Lumpsums + 
  Other Promo Spend
```

**Usage:** Denominator in GP ROI calculation

**Related Terms:** GP ROI, KPI, Planning-First Mode

---

## U

### Uplift % (Volume Uplift Percentage)
**Definition:** The percentage increase in sales volume expected from a promotion, calculated as (Incremental Volume / Baseline Volume) × 100%.

**Formula:**
```
Uplift % = (Incremental Volume / Baseline Volume) × 100
```

**Example:**
```
Baseline Volume: 1,000 units
Incremental Volume: 200 units
Uplift % = (200 / 1,000) × 100 = 20%
```

**Interpretation:**
- 10-20% uplift: Typical promotional impact
- 30%+ uplift: Strong promotion or new product launch
- <5% uplift: Weak promotion, may be unprofitable

**Related Terms:** Incremental Volume, Baseline Volume, Planning-First Mode

---

## W

### What-If Analysis
**Definition:** A simulation capability in Planning-First Mode where planners adjust inputs (volumes, tactics) and instantly see the impact on KPIs and ROI.

**Workflow:**
1. Initial state: Plan shows GP ROI 18.2% 🟡
2. Planner adjusts: Reduce CPP from 15% to 10%
3. System recalculates: GP ROI now 24.5% 🟢
4. Planner decides: Accept change or undo

**Performance Target:** <500ms recalculation for 50 SKUs

**Related Terms:** Planning Grid, KPI Calculation Engine, ROI Simulation

---

**END OF SECTION 12 - GLOSSARY**

---

# 🎉 BRD COMPLETE! 🎉

**Total Sections:** 12  
**Total Pages:** ~150  
**Total Words:** ~43,000

**CollMind TPM Platform - Business Requirements Document**  
**Version:** 1.0 Final  
**Date:** January 7, 2026  
**Status:** ✅ COMPLETE AND LOCKED

---

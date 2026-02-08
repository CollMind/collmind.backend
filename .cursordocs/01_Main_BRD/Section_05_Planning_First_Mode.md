# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 5

---

# 5. PLANNING-FIRST MODE (Full Specification)

## Introduction

This section provides the **complete functional specification** for Planning-First Mode — the strategic, forward-looking operational paradigm optimized for ROI-driven decision-making, volume-based planning, and profitability optimization.

**Scope:** This section covers target product capabilities. Phase 1 implementation constraints are noted explicitly. Features marked "Phase 2+" are architecturally designed but activation timing depends on organizational readiness.

**Critical Distinction:** Planning-First is not "Actuals-First with forecasting bolted on." It is a fundamentally different decision-making paradigm that requires:
- Baseline data as input
- Volume forecasting capability
- Cost visibility (COGS per SKU)
- Profitability simulation (GP ROI calculation)
- What-if scenario modeling

Organizations using Planning-First Mode are asking: **"What ROI will this promotion generate?"** rather than "What did we spend?"

---

## 5.1 Mode Overview

### Purpose & Business Context

Planning-First Mode addresses the challenge of **strategic promotional optimization** in channels where:
- Planning cycles are structured (quarterly JBPs, monthly promotional calendars)
- Volume predictability is high (historical baselines available)
- ROI accountability is mandatory (Finance demands profitability justification)
- Time is available for analysis (weeks to plan, not hours)
- The business model is: "Simulate outcomes → Optimize → Commit → Execute → Track variance"

**Core Principle:** "Define baseline → Plan volumes → Calculate ROI → Optimize → Get approval → Execute"

### When to Use Planning-First

**Mode Resolution Principle:** Planning-First is not a user-selected mode; it is resolved by channel maturity, tactic eligibility, and organizational policy. The system determines the appropriate workflow based on data availability and business context.

**Recommended Scenarios:**
- **Strategic account planning:** NKA Joint Business Plans (JBPs) with quarterly/annual commitments
- **Promotional calendars:** Modern Trade monthly promotional windows
- **ROI-driven promotions:** High-investment activations requiring profitability simulation
- **New product launches:** Volume forecasting critical for supply chain planning
- **Category management:** Portfolio-level optimization across multiple SKUs/brands

**Typical Channels:**
- NKA (National Key Accounts): 70-90% Planning-First usage
- Modern Trade: 60-80% Planning-First (calendar-driven promotions)
- Professional: 40-60% Planning-First (salon chains with structured planning)
- Traditional Trade: 5-20% Planning-First (seasonal campaigns only)

### Operational Workflow

```
┌────────────────────────────────────────────────────────────┐
│              PLANNING-FIRST WORKFLOW                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ① PLANNING TRIGGER                                        │
│     │ JBP cycle, promotional calendar window, category    │
│     │ review meeting                                      │
│     ↓                                                      │
│                                                            │
│  ② BASELINE ESTABLISHMENT                                 │
│     │ Load historical baseline volumes (last 12 months)  │
│     │ System calculates base turnover, base GP           │
│     │ Baseline = "what would happen without promotion"   │
│     ↓                                                      │
│                                                            │
│  ③ VOLUME PLANNING (SKU-Level Input)                     │
│     │ Planner enters planned volumes per SKU             │
│     │ System calculates: Incremental Volume = Planned -  │
│     │ Baseline                                            │
│     ↓                                                      │
│                                                            │
│  ④ TACTIC DEFINITION (FU-Level Input)                    │
│     │ Planner selects tactics (CPP discount, display     │
│     │ fees, etc.)                                         │
│     │ Enters mechanic values (%, TL per unit, lumpsum)   │
│     ↓                                                      │
│                                                            │
│  ⑤ KPI CALCULATION ENGINE                                 │
│     │ Real-time calculation of 40+ KPIs                  │
│     │ Key metrics: GP ROI %, Uplift %, Incremental GP    │
│     │ Calculation cascade: Volume → Turnover → Spend →   │
│     │ Profit → ROI                                        │
│     ↓                                                      │
│                                                            │
│  ⑥ RAG STATUS EVALUATION                                  │
│     │ System evaluates ROI thresholds:                   │
│     │ Green: GP ROI ≥20%, Amber: 10-20%, Red: <10%      │
│     │ Visual feedback in grid (🟢🟡🔴)                    │
│     ↓                                                      │
│                                                            │
│  ⑦ WHAT-IF OPTIMIZATION                                   │
│     │ Planner adjusts: volumes, discounts, tactics       │
│     │ System recalculates ROI instantly (<500ms)         │
│     │ Iterate until Green status achieved                │
│     ↓                                                      │
│                                                            │
│  ⑧ SUBMIT FOR APPROVAL                                    │
│     │ Plan submitted with:                               │
│     │ - ROI metrics (GP ROI, Incremental GP)             │
│     │ - Budget validation (spend within allocated budget)│
│     │ - Profitability justification                      │
│     ↓                                                      │
│                                                            │
│  ⑨ APPROVAL BASED ON ROI                                  │
│     │ Finance/Manager approves based on:                 │
│     │ - GP ROI % (must be ≥ threshold)                   │
│     │ - Budget availability                              │
│     │ - Strategic alignment                              │
│     ↓                                                      │
│                                                            │
│  ⑩ COMMITTED BUDGET                                       │
│     │ Upon approval:                                     │
│     │ - Budget state: Reserved → Committed              │
│     │ - Plan status: Pending → Approved                 │
│     │ - Execution authorized                             │
│     ↓                                                      │
│                                                            │
│  ⑪ EXECUTION & ACTUALS TRACKING                           │
│     │ Promotion runs                                     │
│     │ Actuals data imported (sales volumes, spend)       │
│     │ Variance analysis: Planned vs Actual              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Strategic Advantage:**
- ROI visibility before commitment
- Profitability optimization (10-15% improvement typical)
- Budget efficiency (eliminate unprofitable promotions)
- Finance confidence (data-driven approval)
- Variance tracking (learn from execution)

### Key Differentiators (vs Actuals-First)

| Aspect | Planning-First | Actuals-First |
|--------|----------------|---------------|
| **Decision Basis** | "What ROI will I get?" | "What terms did I agree?" |
| **Data Required** | Baseline, COGS, volumes | CPL, Tactic, Value |
| **Forecast** | Core requirement (baseline + planned) | Not required |
| **KPIs** | Predictive (GP ROI, Uplift%, iGP) | Descriptive (Effective Discount%) |
| **Optimization** | What-if scenarios, iterative | One-shot decision |
| **Approval Basis** | ROI metrics, profitability simulation | Commercial terms, justification |
| **Budget State** | Committed (approved plans) | Reserved (approved agreements) |
| **Execution Trigger** | Plan approved → scheduled | Agreement approved → immediate |
| **Variance Tracking** | Planned vs Actual KPIs | N/A (no plan to compare) |
| **Use Case Fit** | Strategic, ROI-driven, calendar-based | Tactical, reactive, opportunistic |

### Core Objects

**1. Plan**
- Strategic promotional plan covering one or more FUs
- Contains: Baseline volumes, Planned volumes, Tactics, KPIs
- Status lifecycle: Draft → Pending → Approved → Active → Closed
- Budget commitment upon approval (Committed state)

**2. Plan FU (Forecasting Unit Level)**
- Aggregation level for tactic definition
- One FU can contain multiple SKUs
- Tactics defined at FU level, distributed to SKUs

**3. Plan SKU (Stock Keeping Unit Level)**
- Volume planning occurs at SKU level
- Each SKU has: Base Volume, Planned Volume
- KPIs calculated per SKU, aggregated to FU level

**4. Baseline Data**
- Historical sales volumes (last 12 months typical)
- Source: Sales data warehouse, demand planning system
- Required fields: SKU, Period, Volume, List Price
- Quality: No baseline = cannot use Planning-First

**5. KPI Calculation Result**
- 40+ KPIs calculated in real-time
- Stored in JSONB (flexible schema)
- Calculation cascade: 5 levels (Volume → Turnover → Spend → Profit → ROI)
- Dependency graph ensures correct order

**6. RAG Status**
- Green/Amber/Red evaluation based on KPI thresholds
- Primary metric: GP ROI %
- Configurable thresholds (default: Green ≥20%, Amber 10-20%, Red <10%)
- Visual feedback in planning grid

### Success Metrics (Phase 1 Targets)

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Plan Creation Time** | <2 hours median | Time from start → submit |
| **KPI Calculation Speed** | <500ms | Response time for grid update |
| **ROI Optimization** | 10-15% improvement | Average GP ROI increase vs initial draft |
| **Approval Turnaround** | <48 hours | Time from submit → decision |
| **Baseline Data Quality** | >95% SKUs | % SKUs with valid baseline |
| **Green Status Achievement** | >70% approved plans | % plans meeting ROI threshold |
| **Variance Tracking** | 100% approved plans | % plans with actuals comparison |

### Mode Coexistence (Critical Clarification)

**Planning-First and Actuals-First can coexist within the same customer, channel, or portfolio.** The system resolves the appropriate workflow contextually based on:
- Tactic eligibility (some tactics may be Planning-First only)
- Baseline data availability (no baseline → Actuals-First)
- Channel maturity (NKA typically Planning-First, Traditional Trade typically Actuals-First)
- User role/permissions (Category Managers may have Planning-First, Regional Managers may be Actuals-First only)

This is not a system-wide toggle. A single user may create an Actuals-First agreement for a competitive response in Traditional Trade in the morning, then work on a Planning-First JBP for NKA in the afternoon.

**Example Coexistence:**
```
Company: Wella Turkey
├─ NKA Channel (Carrefour, Migros)
│  └─ Planning-First: 90% of promotions (calendar-driven, ROI-optimized)
│
├─ Modern Trade (local chains)
│  ├─ Planning-First: 60% (scheduled promotions)
│  └─ Actuals-First: 40% (opportunistic deals)
│
└─ Traditional Trade (distributors)
   └─ Actuals-First: 95% (reactive, speed-critical)
```

### Product Philosophy

**Planning-First Mode is designed for organizations that treat promotions as investment decisions, not commercial concessions.** This paradigm shift — from "What discount should I give?" to "What ROI will I generate?" — represents a fundamental change in trade spend management maturity.

---

## 5.2 Forward Planning (Planning Grid UI)

### Purpose

The Planning Grid is the **primary interface** for Planning-First Mode. It is a hierarchical, spreadsheet-like UI where planners:
- View baseline volumes (historical data)
- Enter planned volumes (forecasted sales)
- Define tactics and mechanics (discounts, fees)
- See calculated KPIs in real-time (GP ROI, Uplift%)
- Optimize until Green (RAG status)

**Design Philosophy:** "Excel-like familiarity meets real-time intelligence"

### Planning Grid Architecture

#### Hierarchical Structure (FU → SKU)

**Level 1: Forecasting Unit (FU)**
- Aggregation level (e.g., "Wella SP Shampoo Range")
- Tactics defined here (CPP discount %, Display fee)
- KPIs aggregated from SKU level (sum volumes, average ROI)
- Expand/collapse to show/hide SKUs

**Level 2: Stock Keeping Unit (SKU)**
- Granular product level (e.g., "Wella SP Balance 500ml")
- Volume planning occurs here (Base Volume, Planned Volume)
- KPIs calculated per SKU
- Tactic spend distributed from FU level

**Visual Representation:**
```
┌─────────────────────────────────────────────────────────────────┐
│ PLANNING GRID - Hierarchical View                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ➕ FU: Wella SP Shampoo Range                                  │
│    Base Vol: 10,000 | Planned: 12,000 | ROI: 24.5% 🟢        │
│    Tactics: CPP 10%, Display Fee 5,000 TL                      │
│                                                                 │
│    ├─ SKU: Wella SP Balance 500ml                             │
│    │  Base: 3,000 | Planned: 3,600 | ROI: 26.1% 🟢           │
│    │                                                            │
│    ├─ SKU: Wella SP Hydrate 500ml                             │
│    │  Base: 4,000 | Planned: 4,800 | ROI: 23.8% 🟢           │
│    │                                                            │
│    └─ SKU: Wella SP Silver Blond 250ml                        │
│       Base: 3,000 | Planned: 3,600 | ROI: 23.9% 🟢           │
│                                                                 │
│ ➕ FU: Wella EIMI Styling Range                                │
│    Base Vol: 5,000 | Planned: 6,500 | ROI: 18.2% 🟡          │
│    Tactics: Price Support 8 TL/unit                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Column Structure (Dynamic)

**Columns are dynamically generated based on:**
1. Master data fields (SKU Name, Brand, Category, List Price)
2. Volume fields (Base Volume, Planned Volume, Incremental Volume, Uplift%)
3. Tactic fields (varies by selected tactics - CPP%, Display Fee, etc.)
4. KPI fields (configurable - GP ROI%, Incremental GP, Total Spend)
5. RAG Status (🟢🟡🔴 visual indicator)

**Example Column Set (NKA JBP Plan):**
```
┌──────┬────────┬──────┬─────┬────────┬─────────┬──────┬────────┬────────┬───────┬─────┐
│ [+]  │ SKU    │Brand │List │Base Vol│Planned  │Uplift│CPP On% │Display │GP ROI │ RAG │
│      │ Name   │      │Price│        │Volume   │ %    │        │Fee TL  │  %    │     │
├──────┼────────┼──────┼─────┼────────┼─────────┼──────┼────────┼────────┼───────┼─────┤
│ ➕ FU│ Wella  │Wella │ -   │ 10,000 │ 12,000  │ 20%  │  10%   │ 5,000  │ 24.5% │ 🟢  │
│      │ SP     │      │     │        │         │      │ [edit] │[edit]  │[calc] │     │
├──────┼────────┼──────┼─────┼────────┼─────────┼──────┼────────┼────────┼───────┼─────┤
│   │─ │ SP     │Wella │95 TL│ 3,000  │ [3600]  │ 20%  │  10%   │ 1,667  │ 26.1% │ 🟢  │
│      │Balance │      │     │[locked]│ [edit]  │[calc]│[parent]│[calc]  │[calc] │     │
├──────┼────────┼──────┼─────┼────────┼─────────┼──────┼────────┼────────┼───────┼─────┤
│   │─ │ SP     │Wella │89 TL│ 4,000  │ [4800]  │ 20%  │  10%   │ 2,133  │ 23.8% │ 🟢  │
│      │Hydrate │      │     │[locked]│ [edit]  │[calc]│[parent]│[calc]  │[calc] │     │
└──────┴────────┴──────┴─────┴────────┴─────────┴──────┴────────┴────────┴───────┴─────┘

Legend:
[locked] = Read-only (baseline data)
[edit] = User can modify
[calc] = Calculated in real-time
[parent] = Inherited from FU level
```

### Input Patterns

#### Pattern 1: Volume Input (SKU Level)

**Base Volume:** Read-only, loaded from baseline data
**Planned Volume:** Editable, planner enters forecasted volume

```typescript
// Pseudo-code - Volume input validation
function handlePlannedVolumeInput(skuId: string, value: number) {
  // Validation
  if (value < 0) {
    showError("Planned volume cannot be negative");
    return;
  }
  
  const baseVolume = getBaseVolume(skuId);
  if (value < baseVolume * 0.5) {
    showWarning("Planned volume is 50%+ below baseline. Is this intentional?");
  }
  
  // Update
  updatePlanSku(skuId, { planned_volume: value });
  
  // Trigger calculation cascade
  calculateKPIs(skuId); // Calculates iVol, Uplift%, Turnover, GP, ROI
  aggregateToFU(); // Roll up SKU values to FU level
  updateGrandTotals(); // Update plan-level aggregates
}
```

#### Pattern 2: Tactic Input (FU Level)

**Tactics are defined at FU level, distributed to SKUs:**

**CPP On-Invoice % (Percentage Discount):**
- Entered at FU level (e.g., 10%)
- Applied to all SKUs under that FU
- Calculation: `CPP_Spend = (Planned_GSV - LTA_On) × (CPP% / 100)`

**Display Fee (Lumpsum):**
- Entered at FU level (e.g., 5,000 TL)
- Distributed to SKUs proportionally by planned volume
- Calculation: `SKU_DisplayFee = FU_DisplayFee × (SKU_PlannedVol / FU_PlannedVol)`

```typescript
// Pseudo-code - Tactic input distribution
function handleCPPInput(fuId: string, cppPercent: number) {
  // Validation
  if (cppPercent < 0 || cppPercent > 100) {
    showError("CPP % must be between 0-100");
    return;
  }
  
  if (cppPercent > 30) {
    showWarning("CPP discount >30% is high. Check profitability.");
  }
  
  // Store at FU level
  updatePlanFU(fuId, { cpp_on_percent: cppPercent });
  
  // Distribute to all SKUs under this FU
  const skus = getSKUsUnderFU(fuId);
  for (const sku of skus) {
    // CPP applies to each SKU's turnover
    const plannedGSV = sku.planned_volume * sku.list_price;
    const ltaOn = calculateLTAOn(sku);
    const cppSpend = (plannedGSV - ltaOn) * (cppPercent / 100);
    
    updatePlanSku(sku.id, { cpp_on_spend: cppSpend });
  }
  
  // Recalculate KPIs (spend changed → GP changed → ROI changed)
  calculateKPIs(fuId);
}
```

#### Pattern 3: Real-Time Calculation Cascade

**Calculation Order (5 Levels):**

```
LEVEL 1: Volume Calculations (User Input + Baseline)
├─ Base Volume (from baseline data)
├─ Planned Volume (user input)
├─ Incremental Volume = Planned - Base
└─ Volume Uplift % = (iVol / Base) × 100

LEVEL 2: Turnover Calculations
├─ Base GSV = Base Volume × List Price
├─ Planned GSV = Planned Volume × List Price
├─ Incremental GSV = Planned GSV - Base GSV
└─ Turnover Uplift % = (iGSV / Base GSV) × 100

LEVEL 3: Spend Calculations (Tactic-Dependent)
├─ LTA On-Invoice Spend = Planned GSV × LTA_On%
├─ LTA Off-Invoice Spend = (Planned GSV - LTA_On) × LTA_Off%
├─ CPP On-Invoice Spend = (Planned GSV - LTA_On) × CPP%
├─ Display Fee Spend = [Lumpsum] (distributed to SKUs)
├─ Price Support Spend = Planned Volume × Support_Per_Unit
└─ Total Planned Spend = SUM(all spend categories)

LEVEL 4: Profit Calculations
├─ Base COGS = Base Volume × COGS_Per_Unit
├─ Planned COGS = Planned Volume × COGS_Per_Unit
├─ Base GP = Base GSV - Base COGS
├─ Planned GP = (Planned GSV - CPP_Spend) - Planned COGS
└─ Incremental GP = Planned GP - Base GP

LEVEL 5: ROI Calculations
├─ GP ROI % = (Incremental GP / Total Planned Spend) × 100
├─ TO ROI % = (Incremental Turnover / Total Planned Spend) × 100
└─ RAG Status = IF(GP_ROI ≥ 20%, GREEN, IF(GP_ROI ≥ 10%, AMBER, RED))
```

**Performance Target:** Entire cascade completes in <500ms for 50 SKUs

### Design Principle (Critical Guardrail)

**The Planning Grid is intentionally not a free-form spreadsheet; guardrails are enforced to protect data integrity and calculation correctness.** While the interface is Excel-like for familiarity, it is a structured data entry system with validation rules, formula dependencies, and workflow controls. Users cannot arbitrarily add columns, bypass validations, or break calculation logic.

**What This Means:**
- ❌ Cannot add custom calculated columns (Phase 1)
- ❌ Cannot override calculated KPIs (they are read-only)
- ❌ Cannot paste arbitrary formulas (only data values)
- ❌ Cannot delete required columns (volume, tactics, ROI)
- ✅ Can enter volumes, tactics, and user-input fields
- ✅ Can reorder/resize existing columns
- ✅ Can filter, sort, and export data

This design prevents common spreadsheet pitfalls: broken formulas, inconsistent calculations, and data corruption.

### RAG Status Visualization

**Color Coding:**
- 🟢 **Green:** GP ROI ≥ 20% (Excellent profitability)
- 🟡 **Amber:** GP ROI 10-20% (Marginal profitability)
- 🔴 **Red:** GP ROI < 10% (Unprofitable)

**Display Locations:**
- SKU-level: Mini indicator in RAG column
- FU-level: Larger indicator, aggregated status
- Plan-level: Grand Totals Panel (overall plan status)

**Aggregation Logic (FU-level RAG):**
- If any SKU is Red → FU is Red
- If no Red but any Amber → FU is Amber
- If all Green → FU is Green

**Visual Example:**
```
┌──────────────────────────────────────────────────┐
│ FU: Wella SP Shampoo Range          ROI: 24.5%  │
│                                                  │
│ ┌────────────────────────────────────────────┐  │
│ │ 🟢 GREEN                                   │  │
│ │ Excellent profitability                    │  │
│ │                                            │  │
│ │ GP ROI: 24.5%                             │  │
│ │ Threshold: ≥20% for Green                 │  │
│ └────────────────────────────────────────────┘  │
│                                                  │
│ ├─ SKU: SP Balance      ROI: 26.1%  🟢         │
│ ├─ SKU: SP Hydrate      ROI: 23.8%  🟢         │
│ └─ SKU: SP Silver Blond ROI: 23.9%  🟢         │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## 5.3 KPI Calculation Engine

### Purpose

The KPI Calculation Engine is the **computational brain** of Planning-First Mode. It is a **formula-driven, dependency-aware calculation system** that computes 40+ KPIs in real-time as planners modify volumes and tactics.

**Core Capabilities:**
- Formula storage as text (admin-configurable)
- Dependency graph resolution (calculate in correct order)
- Real-time execution (<500ms response time)
- Cascade recalculation (change one field → update all dependents)
- Aggregation from SKU → FU → Plan levels
- Error handling for edge cases (zero baseline, new products)

**Architecture Principle:** "Formulas are data, not code" — All KPI definitions stored in database, not hardcoded.

### KPI Library Structure

**40+ KPIs organized into 8 groups:**

1. **Master Data** (2 KPIs) - Price, COGS
2. **Volume** (4 KPIs) - Base, Planned, Incremental, Uplift%
3. **Gross Sales Value - GSV** (3 KPIs) - Base, Planned, Incremental
4. **Net Invoice Value - NIV** (3 KPIs) - Base, Planned, Incremental
5. **Turnover** (4 KPIs) - Base, Planned, Incremental, Uplift%
6. **LTA Spend** (8 KPIs) - On/Off-Invoice baseline and planned
7. **Promo Spend** (11 KPIs) - CPP, Display, Price Support, etc.
8. **Gross Profit** (5 KPIs) - Base, Planned, Incremental GP
9. **ROI** (3 KPIs) - GP ROI%, TO ROI%, RAG Status

### KPI Schema (Database)

```sql
CREATE TABLE kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  
  -- Identification
  kpi_code VARCHAR(50) UNIQUE NOT NULL, -- e.g., 'INCR_VOL', 'GP_ROI_PCT'
  kpi_name VARCHAR(200) NOT NULL, -- Display name
  kpi_group VARCHAR(100) NOT NULL, -- 'Volume', 'Profit', 'ROI'
  kpi_description TEXT,
  
  -- Formula Configuration (Critical!)
  formula_type VARCHAR(50) NOT NULL, 
    -- 'expression' | 'conditional' | 'user_input' | 'external' | 'javascript'
  formula_text TEXT NOT NULL,
    -- e.g., "PLANNED_VOL - BASE_VOL"
    -- e.g., "IF(GP_ROI_PCT >= 20, 'GREEN', IF(GP_ROI_PCT >= 10, 'AMBER', 'RED'))"
  depends_on_kpis JSONB,
    -- Array of KPI codes this depends on
    -- e.g., '["PLANNED_VOL", "BASE_VOL"]'
  
  -- Calculation Sequence
  calculation_order INTEGER NOT NULL,
    -- Determines execution order (1-50)
    -- Level 1: 1-10 (inputs)
    -- Level 2: 11-20 (simple calcs)
    -- Level 3: 21-30 (dependent calcs)
    -- Level 4: 31-40 (profit)
    -- Level 5: 41-50 (ROI)
  calculation_level VARCHAR(20) NOT NULL,
    -- 'sku' | 'fu' | 'plan'
  
  -- Display Configuration
  display_format VARCHAR(50) NOT NULL, -- 'number', 'currency', 'percentage'
  decimal_places INTEGER DEFAULT 2,
  show_in_grid BOOLEAN DEFAULT true,
  column_order INTEGER, -- Position in planning grid
  
  -- Aggregation (for rolling up SKU → FU)
  aggregation_method_fu VARCHAR(20),
    -- 'sum' | 'avg' | 'min' | 'max' | 'weighted_avg'
  
  -- RAG Configuration (for KPIs that use thresholds)
  rag_green_threshold NUMERIC(18,4),
  rag_amber_threshold NUMERIC(18,4),
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  
  -- Constraints
  CHECK (calculation_order > 0 AND calculation_order <= 50),
  CHECK (formula_type IN ('expression', 'conditional', 'user_input', 'external', 'javascript'))
);

-- Indexes
CREATE INDEX idx_kpis_calculation_order ON kpis(calculation_order);
CREATE INDEX idx_kpis_group ON kpis(kpi_group);
CREATE UNIQUE INDEX idx_kpis_code ON kpis(tenant_id, kpi_code);
```

### Complete KPI Library (40 KPIs)

**KPI Engine Architecture Note:**

While the KPI engine supports 40+ KPIs and can calculate all of them in real-time, **only a curated subset is exposed in the Phase 1 planning grid UI**. The full library is available for:
- Backend calculations (all KPIs computed, stored in JSONB)
- Export/reports (full KPI set in Excel exports)
- API access (external systems can query any KPI)

**Phase 1 UI Exposure (Grid Columns):**
- Volume: Base, Planned, Incremental, Uplift% (4 KPIs)
- Turnover: Planned GSV, Incremental GSV (2 KPIs)
- Spend: Total Planned Spend (1 KPI)
- Profit: Planned GP, Incremental GP (2 KPIs)
- ROI: GP ROI %, RAG Status (2 KPIs)

**Total Grid Columns:** ~11 KPI columns (+ tactics + master data = ~20 columns total)

**Computation-Only KPIs (Hidden from Grid, Used in Calculations):**
- LTA spend breakdowns (8 KPIs) - used for spend calculation, not displayed
- COGS values (2 KPIs) - used for GP calculation, not displayed
- Detailed promo spend by mechanic (11 KPIs) - aggregated in "Total Spend"
- Base GP, Base COGS (3 KPIs) - used for incremental calculations

**Why This Matters:**
- Prevents grid overload (20 columns manageable, 40 overwhelming)
- Maintains calculation accuracy (all formulas execute)
- Enables future UI expansion (Phase 2: user-configurable columns)

#### GROUP 1: Master Data (2 KPIs)

```sql
-- KPI 1: List Price per Piece (BPTT - Brüt Parça Taşıma Fiyatı)
INSERT INTO kpis VALUES (
  'LIST_PRICE',
  'List Price per Piece',
  'Master Data',
  'external', -- Comes from SKU master data
  'sku.list_price',
  '[]', -- No dependencies
  1, -- First in calculation order
  'sku',
  'currency',
  2,
  'sum', -- When aggregating to FU: sum all SKU prices
  true
);

-- KPI 2: COGS per Piece
INSERT INTO kpis VALUES (
  'COGS',
  'Cost of Goods Sold per Piece',
  'Master Data',
  'external', -- Comes from SKU master data
  'sku.cogs_per_unit',
  '[]',
  2,
  'sku',
  'currency',
  2,
  'sum',
  true
);
```

#### GROUP 2: Volume (4 KPIs)

```sql
-- KPI 3: Base Volume
INSERT INTO kpis VALUES (
  'BASE_VOL',
  'Base Volume',
  'Volume',
  'external', -- Loaded from baseline data
  'baseline.volume',
  '[]',
  3,
  'sku',
  'number',
  0,
  'sum',
  true
);

-- KPI 4: Planned Volume
INSERT INTO kpis VALUES (
  'PLANNED_VOL',
  'Planned Volume',
  'Volume',
  'user_input', -- Planner enters this
  'plan_sku.planned_volume',
  '[]',
  4,
  'sku',
  'number',
  0,
  'sum',
  true
);

-- KPI 5: Incremental Volume (iVol)
INSERT INTO kpis VALUES (
  'INCR_VOL',
  'Incremental Volume',
  'Volume',
  'expression',
  'PLANNED_VOL - BASE_VOL',
  '["PLANNED_VOL", "BASE_VOL"]',
  11, -- Level 2: Simple calculation
  'sku',
  'number',
  0,
  'sum',
  true
);

-- KPI 6: Volume Uplift %
INSERT INTO kpis VALUES (
  'VOL_UPLIFT_PCT',
  'Volume Uplift %',
  'Volume',
  'expression',
  '(INCR_VOL / BASE_VOL) * 100',
  '["INCR_VOL", "BASE_VOL"]',
  12,
  'sku',
  'percentage',
  1,
  'avg', -- Average uplift when aggregating to FU
  true
);
```

#### GROUP 3: Gross Sales Value - GSV (3 KPIs)

```sql
-- KPI 7: Base GSV
INSERT INTO kpis VALUES (
  'BASE_GSV',
  'Base Gross Sales Value',
  'Gross Sales Value',
  'expression',
  'BASE_VOL * LIST_PRICE',
  '["BASE_VOL", "LIST_PRICE"]',
  13,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 8: Planned GSV
INSERT INTO kpis VALUES (
  'PLANNED_GSV',
  'Planned Gross Sales Value',
  'Gross Sales Value',
  'expression',
  'PLANNED_VOL * LIST_PRICE',
  '["PLANNED_VOL", "LIST_PRICE"]',
  14,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 9: Incremental GSV (iGSV)
INSERT INTO kpis VALUES (
  'INCR_GSV',
  'Incremental Gross Sales Value',
  'Gross Sales Value',
  'expression',
  'PLANNED_GSV - BASE_GSV',
  '["PLANNED_GSV", "BASE_GSV"]',
  15,
  'sku',
  'currency',
  2,
  'sum',
  true
);
```

#### GROUP 4: LTA Spend (8 KPIs)

```sql
-- KPI 10: LTA On-Invoice %
INSERT INTO kpis VALUES (
  'LTA_ON_PCT',
  'LTA On-Invoice %',
  'LTA Spend',
  'external', -- From SKU master data or CPL agreement
  'sku.lta_on_invoice_pct',
  '[]',
  5,
  'sku',
  'percentage',
  2,
  'avg',
  false -- Hidden in grid
);

-- KPI 11: LTA Off-Invoice %
INSERT INTO kpis VALUES (
  'LTA_OFF_PCT',
  'LTA Off-Invoice %',
  'LTA Spend',
  'external',
  'sku.lta_off_invoice_pct',
  '[]',
  6,
  'sku',
  'percentage',
  2,
  'avg',
  false
);

-- KPI 12: Base LTA Spend On-Invoice
INSERT INTO kpis VALUES (
  'BASE_LTA_ON',
  'Base LTA Spend On-Invoice',
  'LTA Spend',
  'expression',
  '(BASE_GSV * LTA_ON_PCT) / 100',
  '["BASE_GSV", "LTA_ON_PCT"]',
  16,
  'sku',
  'currency',
  2,
  'sum',
  false
);

-- KPI 13: Base LTA Spend Off-Invoice
INSERT INTO kpis VALUES (
  'BASE_LTA_OFF',
  'Base LTA Spend Off-Invoice',
  'LTA Spend',
  'expression',
  '((BASE_GSV - BASE_LTA_ON) * LTA_OFF_PCT) / 100',
  '["BASE_GSV", "BASE_LTA_ON", "LTA_OFF_PCT"]',
  17,
  'sku',
  'currency',
  2,
  'sum',
  false
);

-- KPI 14: Planned LTA Spend On-Invoice
INSERT INTO kpis VALUES (
  'PLANNED_LTA_ON',
  'Planned LTA Spend On-Invoice',
  'LTA Spend',
  'expression',
  '(PLANNED_GSV * LTA_ON_PCT) / 100',
  '["PLANNED_GSV", "LTA_ON_PCT"]',
  18,
  'sku',
  'currency',
  2,
  'sum',
  false
);

-- KPI 15: Planned LTA Spend Off-Invoice
INSERT INTO kpis VALUES (
  'PLANNED_LTA_OFF',
  'Planned LTA Spend Off-Invoice',
  'LTA Spend',
  'expression',
  '((PLANNED_GSV - PLANNED_LTA_ON) * LTA_OFF_PCT) / 100',
  '["PLANNED_GSV", "PLANNED_LTA_ON", "LTA_OFF_PCT"]',
  19,
  'sku',
  'currency',
  2,
  'sum',
  false
);

-- KPI 16: Total Base LTA Spend
INSERT INTO kpis VALUES (
  'TOTAL_BASE_LTA',
  'Total Base LTA Spend',
  'LTA Spend',
  'expression',
  'BASE_LTA_ON + BASE_LTA_OFF',
  '["BASE_LTA_ON", "BASE_LTA_OFF"]',
  20,
  'sku',
  'currency',
  2,
  'sum',
  false
);

-- KPI 17: Total Planned LTA Spend
INSERT INTO kpis VALUES (
  'TOTAL_PLANNED_LTA',
  'Total Planned LTA Spend',
  'LTA Spend',
  'expression',
  'PLANNED_LTA_ON + PLANNED_LTA_OFF',
  '["PLANNED_LTA_ON', "PLANNED_LTA_OFF"]',
  21,
  'sku',
  'currency',
  2,
  'sum',
  false
);
```

#### GROUP 5: Promo Spend by Mechanic (11 KPIs)

```sql
-- KPI 18: CPP On-Invoice % Spend
INSERT INTO kpis VALUES (
  'CPP_ON_SPEND',
  'CPP On-Invoice % Spend',
  'Promo Spend',
  'expression',
  '((PLANNED_GSV - PLANNED_LTA_ON) * CPP_ON_PCT) / 100',
  '["PLANNED_GSV", "PLANNED_LTA_ON", "CPP_ON_PCT"]',
  22,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 19: CPP Off-Invoice % Spend
INSERT INTO kpis VALUES (
  'CPP_OFF_SPEND',
  'CPP Off-Invoice % Spend',
  'Promo Spend',
  'expression',
  '((PLANNED_GSV - PLANNED_LTA_ON - CPP_ON_SPEND) * CPP_OFF_PCT) / 100',
  '["PLANNED_GSV", "PLANNED_LTA_ON", "CPP_ON_SPEND", "CPP_OFF_PCT"]',
  23,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 20: Price Support per Unit Spend
INSERT INTO kpis VALUES (
  'PRICE_SUPPORT_SPEND',
  'Price Support per Unit Spend',
  'Promo Spend',
  'expression',
  'PLANNED_VOL * PRICE_SUPPORT_PER_UNIT',
  '["PLANNED_VOL", "PRICE_SUPPORT_PER_UNIT"]',
  24,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 21-28: Display Fees, Visibility, TPR lumpsums
-- (Lumpsums distributed from FU level to SKUs proportionally)
-- Calculation: SKU_Share = SKU_PlannedVol / FU_TotalPlannedVol
-- SKU_LumpsumSpend = FU_Lumpsum * SKU_Share
```

#### GROUP 6: Total Planned Spend (6 KPIs)

```sql
-- KPI 29: Planned Promo Spend On-Invoice
INSERT INTO kpis VALUES (
  'TOTAL_PROMO_ON',
  'Total Planned Promo Spend On-Invoice',
  'Total Spend',
  'expression',
  'CPP_ON_SPEND', -- Can be extended: CPP_ON + DRIVE_ON + WS_TPR_ON
  '["CPP_ON_SPEND"]',
  25,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 30: Planned Promo Spend Off-Invoice
INSERT INTO kpis VALUES (
  'TOTAL_PROMO_OFF',
  'Total Planned Promo Spend Off-Invoice',
  'Total Spend',
  'expression',
  'CPP_OFF_SPEND + VISIBILITY_SPEND + DISPLAY_SPEND + PRICE_SUPPORT_SPEND',
  '["CPP_OFF_SPEND", "VISIBILITY_SPEND", "DISPLAY_SPEND", "PRICE_SUPPORT_SPEND"]',
  26,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 31: Total Planned Spend On-Invoice
INSERT INTO kpis VALUES (
  'TOTAL_ON_SPEND',
  'Total Planned Spend On-Invoice',
  'Total Spend',
  'expression',
  'PLANNED_LTA_ON + TOTAL_PROMO_ON',
  '["PLANNED_LTA_ON", "TOTAL_PROMO_ON"]',
  27,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 32: Total Planned Spend Off-Invoice
INSERT INTO kpis VALUES (
  'TOTAL_OFF_SPEND',
  'Total Planned Spend Off-Invoice',
  'Total Spend',
  'expression',
  'PLANNED_LTA_OFF + TOTAL_PROMO_OFF',
  '["PLANNED_LTA_OFF", "TOTAL_PROMO_OFF"]',
  28,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 33: Total Planned Spend (ALL)
INSERT INTO kpis VALUES (
  'TOTAL_PLANNED_SPEND',
  'Total Planned Spend',
  'Total Spend',
  'expression',
  'TOTAL_ON_SPEND + TOTAL_OFF_SPEND',
  '["TOTAL_ON_SPEND", "TOTAL_OFF_SPEND"]',
  29,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 34: Incremental Planned Spend
INSERT INTO kpis VALUES (
  'INCR_SPEND',
  'Incremental Planned Spend',
  'Total Spend',
  'expression',
  'TOTAL_PLANNED_SPEND - TOTAL_BASE_LTA',
  '["TOTAL_PLANNED_SPEND", "TOTAL_BASE_LTA"]',
  30,
  'sku',
  'currency',
  2,
  'sum',
  true
);
```

#### GROUP 7: Gross Profit (5 KPIs)

```sql
-- KPI 35: Base COGS
INSERT INTO kpis VALUES (
  'BASE_COGS',
  'Base COGS Value',
  'Cost',
  'expression',
  'BASE_VOL * COGS',
  '["BASE_VOL", "COGS"]',
  31,
  'sku',
  'currency',
  2,
  'sum',
  false
);

-- KPI 36: Planned COGS
INSERT INTO kpis VALUES (
  'PLANNED_COGS',
  'Planned COGS Value',
  'Cost',
  'expression',
  'PLANNED_VOL * COGS',
  '["PLANNED_VOL", "COGS"]',
  32,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 37: Base Gross Profit
INSERT INTO kpis VALUES (
  'BASE_GP',
  'Base Gross Profit',
  'Profit',
  'expression',
  'BASE_GSV - BASE_COGS',
  '["BASE_GSV", "BASE_COGS"]',
  33,
  'sku',
  'currency',
  2,
  'sum',
  false
);

-- KPI 38: Planned Gross Profit
INSERT INTO kpis VALUES (
  'PLANNED_GP',
  'Planned Gross Profit',
  'Profit',
  'expression',
  '(PLANNED_GSV - CPP_ON_SPEND) - PLANNED_COGS',
  '["PLANNED_GSV", "CPP_ON_SPEND", "PLANNED_COGS"]',
  34,
  'sku',
  'currency',
  2,
  'sum',
  true
);

-- KPI 39: Incremental Gross Profit (iGP)
INSERT INTO kpis VALUES (
  'INCR_GP',
  'Incremental Gross Profit',
  'Profit',
  'expression',
  'PLANNED_GP - BASE_GP',
  '["PLANNED_GP", "BASE_GP"]',
  35,
  'sku',
  'currency',
  2,
  'sum',
  true
);
```

#### GROUP 8: ROI & RAG (3 KPIs)

```sql
-- KPI 40: GP ROI %
INSERT INTO kpis VALUES (
  'GP_ROI_PCT',
  'Gross Profit ROI %',
  'ROI',
  'expression',
  '(INCR_GP / TOTAL_PLANNED_SPEND) * 100',
  '["INCR_GP", "TOTAL_PLANNED_SPEND"]',
  41,
  'fu', -- Calculated at FU level (aggregated from SKUs)
  'percentage',
  1,
  'avg', -- Weighted average when aggregating to Plan level
  true,
  20.0, -- Green threshold
  10.0 -- Amber threshold
);

-- KPI 41: TO ROI %
INSERT INTO kpis VALUES (
  'TO_ROI_PCT',
  'Turnover ROI %',
  'ROI',
  'expression',
  '(INCR_GSV / TOTAL_PLANNED_SPEND) * 100',
  '["INCR_GSV", "TOTAL_PLANNED_SPEND"]',
  42,
  'fu',
  'percentage',
  1,
  'avg',
  false
);

-- KPI 42: RAG Status
INSERT INTO kpis VALUES (
  'RAG_STATUS',
  'RAG Status',
  'ROI',
  'conditional',
  'IF(GP_ROI_PCT >= 20, "GREEN", IF(GP_ROI_PCT >= 10, "AMBER", "RED"))',
  '["GP_ROI_PCT"]',
  43,
  'fu',
  'text',
  0,
  null, -- No aggregation (visual only)
  true
);
```

### Calculation Engine Logic

#### Step 1: Dependency Graph Resolution

```typescript
// Pseudo-code
function buildDependencyGraph(kpis: KPI[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  
  for (const kpi of kpis) {
    graph.set(kpi.kpi_code, kpi.depends_on_kpis || []);
  }
  
  return graph;
}

function topologicalSort(kpis: KPI[]): KPI[] {
  // Sort by calculation_order (already stored in database)
  return kpis.sort((a, b) => a.calculation_order - b.calculation_order);
}
```

#### Step 2: Formula Parsing & Execution

```typescript
// Pseudo-code
function executeFormula(
  kpi: KPI,
  context: Map<string, number>
): number | string {
  
  switch (kpi.formula_type) {
    case 'user_input':
      // Value already in context
      return context.get(kpi.kpi_code);
      
    case 'external':
      // Load from master data or baseline
      return loadExternalValue(kpi);
      
    case 'expression':
      // Parse formula text, substitute values, evaluate
      let formula = kpi.formula_text;
      
      // Replace KPI codes with actual values
      for (const depCode of kpi.depends_on_kpis) {
        const value = context.get(depCode) || 0;
        formula = formula.replaceAll(depCode, value.toString());
      }
      
      // Evaluate mathematical expression
      return eval(formula); // In production: use safer parser (e.g., mathjs)
      
    case 'conditional':
      // Parse IF/THEN/ELSE logic
      return evaluateConditional(kpi.formula_text, context);
      
    case 'javascript':
      // Execute custom JavaScript function
      const fn = new Function('context', kpi.formula_text);
      return fn(context);
  }
}
```

#### Step 3: SKU-Level Calculation

```typescript
// Pseudo-code
async function calculateSKUKPIs(planId: string, skuId: string) {
  // Load all KPIs in calculation order
  const kpis = await loadKPIs('sku', sorted_by_calculation_order);
  
  // Build context with external values
  const context = new Map<string, number>();
  context.set('LIST_PRICE', getSKU(skuId).list_price);
  context.set('COGS', getSKU(skuId).cogs_per_unit);
  context.set('BASE_VOL', getBaseline(skuId).volume);
  context.set('PLANNED_VOL', getPlanSKU(planId, skuId).planned_volume);
  context.set('LTA_ON_PCT', getSKU(skuId).lta_on_pct || 0);
  context.set('LTA_OFF_PCT', getSKU(skuId).lta_off_pct || 0);
  
  // Load tactic values from FU level
  const fu = getFUForSKU(skuId);
  context.set('CPP_ON_PCT', getPlanFU(planId, fu.id).cpp_on_pct || 0);
  context.set('CPP_OFF_PCT', getPlanFU(planId, fu.id).cpp_off_pct || 0);
  // ... other tactics
  
  // Execute formulas in order
  for (const kpi of kpis) {
    const result = executeFormula(kpi, context);
    context.set(kpi.kpi_code, result);
  }
  
  // Store results
  await saveSKUKPIs(planId, skuId, context);
  
  return context;
}
```

#### Step 4: FU-Level Aggregation

```typescript
// Pseudo-code
async function aggregateSKUsToFU(planId: string, fuId: string) {
  const skus = await getSKUsUnderFU(fuId);
  const kpis = await loadKPIs('fu');
  
  const aggregatedContext = new Map<string, number>();
  
  for (const kpi of kpis) {
    let aggregatedValue;
    
    switch (kpi.aggregation_method_fu) {
      case 'sum':
        aggregatedValue = skus.reduce((sum, sku) => {
          return sum + getSKUKPI(planId, sku.id, kpi.kpi_code);
        }, 0);
        break;
        
      case 'avg':
        const values = skus.map(sku => getSKUKPI(planId, sku.id, kpi.kpi_code));
        aggregatedValue = values.reduce((a, b) => a + b, 0) / values.length;
        break;
        
      case 'weighted_avg':
        // Weight by planned volume
        const numerator = skus.reduce((sum, sku) => {
          const value = getSKUKPI(planId, sku.id, kpi.kpi_code);
          const weight = getSKUKPI(planId, sku.id, 'PLANNED_VOL');
          return sum + (value * weight);
        }, 0);
        const denominator = skus.reduce((sum, sku) => {
          return sum + getSKUKPI(planId, sku.id, 'PLANNED_VOL');
        }, 0);
        aggregatedValue = numerator / denominator;
        break;
    }
    
    aggregatedContext.set(kpi.kpi_code, aggregatedValue);
  }
  
  // Calculate FU-specific KPIs (e.g., GP_ROI_PCT)
  for (const kpi of kpis.filter(k => k.calculation_level === 'fu')) {
    const result = executeFormula(kpi, aggregatedContext);
    aggregatedContext.set(kpi.kpi_code, result);
  }
  
  // Store results
  await saveFUKPIs(planId, fuId, aggregatedContext);
  
  return aggregatedContext;
}
```

### Edge Case Handling

**Zero Baseline:**
- New product scenario (no historical sales)
- Formula: `VOL_UPLIFT_PCT = (INCR_VOL / BASE_VOL) * 100`
- Issue: Division by zero
- Solution: `IF(BASE_VOL = 0, NULL, (INCR_VOL / BASE_VOL) * 100)`

**Negative ROI:**
- Unprofitable promotion (Incremental GP < 0)
- Formula: `GP_ROI_PCT = (INCR_GP / TOTAL_PLANNED_SPEND) * 100`
- Result: Negative percentage (e.g., -15%)
- UI Treatment: Display in red, flag for review

**Zero Spend:**
- No tactics defined
- Formula: `GP_ROI_PCT = (INCR_GP / TOTAL_PLANNED_SPEND) * 100`
- Issue: Division by zero
- Solution: `IF(TOTAL_PLANNED_SPEND = 0, NULL, ...)`

---

## 5.4 ROI Simulation & What-If Analysis

### Purpose

What-If Analysis is the **optimization superpower** of Planning-First Mode. Planners can adjust inputs (volumes, discounts, tactics) and **instantly see** the impact on ROI without committing to changes.

**Core Capability:** Real-time recalculation (<500ms) enables iterative optimization until Green RAG status achieved.

### What-If Workflow

```
┌────────────────────────────────────────────────────────────┐
│            WHAT-IF OPTIMIZATION CYCLE                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ① INITIAL STATE                                           │
│     │ Base: 10,000 units                                  │
│     │ Planned: 12,000 units (20% uplift)                  │
│     │ CPP Discount: 15%                                    │
│     │ Result: GP ROI = 18.2% 🟡 (AMBER)                   │
│     ↓                                                      │
│                                                            │
│  ② WHAT-IF ADJUSTMENT #1                                  │
│     │ Planner reduces CPP: 15% → 10%                      │
│     │ System recalculates (300ms)                         │
│     │ Result: GP ROI = 24.5% 🟢 (GREEN)                   │
│     │ Decision: Accept change ✅                           │
│     ↓                                                      │
│                                                            │
│  ③ WHAT-IF ADJUSTMENT #2                                  │
│     │ Planner increases volume: 12,000 → 13,000          │
│     │ System recalculates (350ms)                         │
│     │ Result: GP ROI = 26.1% 🟢 (GREEN, better!)          │
│     │ Decision: Accept change ✅                           │
│     ↓                                                      │
│                                                            │
│  ④ WHAT-IF ADJUSTMENT #3                                  │
│     │ Planner adds Display Fee: 5,000 TL                  │
│     │ System recalculates (400ms)                         │
│     │ Result: GP ROI = 21.3% 🟢 (still GREEN)             │
│     │ Decision: Accept change ✅                           │
│     ↓                                                      │
│                                                            │
│  ⑤ OPTIMIZED STATE                                        │
│     Final configuration:                                  │
│     - Planned Volume: 13,000 units                        │
│     - CPP Discount: 10%                                    │
│     - Display Fee: 5,000 TL                               │
│     - GP ROI: 21.3% 🟢                                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### UI Features

#### Grand Totals Panel (Real-Time Updates)

```
┌─────────────────────────────────────────────────────────┐
│ GRAND TOTALS - PLAN OVERVIEW                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 📊 VOLUME                        💰 PROFIT              │
│ ┌────────────────────┐          ┌────────────────────┐ │
│ │ Base:    10,000    │          │ Incremental GP:    │ │
│ │ Planned: 13,000 ↑  │          │ 45,680 TL         │ │
│ │ Uplift:  30%       │          │                    │ │
│ └────────────────────┘          └────────────────────┘ │
│                                                         │
│ 💵 SPEND                         🎯 ROI                 │
│ ┌────────────────────┐          ┌────────────────────┐ │
│ │ Total Planned:     │          │ GP ROI: 21.3% 🟢   │ │
│ │ 32,150 TL         │          │                    │ │
│ │ (Budget: 50K)      │          │ Target: ≥20%       │ │
│ └────────────────────┘          └────────────────────┘ │
│                                                         │
│ ⚡ Updates in real-time as you edit the grid below     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Inline Optimization Hints

```
┌─────────────────────────────────────────────────────────┐
│ FU: Wella SP Shampoo Range              GP ROI: 18.2% 🟡│
│                                                         │
│ ⚠️ OPTIMIZATION SUGGESTION:                             │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ This FU is AMBER (18.2%). Try:                      │ │
│ │ • Reduce CPP discount by 3-5% → Estimated +4% ROI  │ │
│ │ • Increase planned volume by 500 units → +2% ROI   │ │
│ │ • Remove Display Fee → +1.8% ROI                   │ │
│ │                                                      │ │
│ │ [Apply Suggestion] [Dismiss]                        │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Undo/Redo Stack

```
Toolbar:
┌─────────────────────────────────────────┐
│ [↶ Undo] [↷ Redo]                      │
│ Last: Changed CPP from 15% to 10%      │
└─────────────────────────────────────────┘

History Panel (optional):
┌────────────────────────────────────────┐
│ Change History                         │
├────────────────────────────────────────┤
│ ● Now: CPP 10%, Volume 13K → 21.3% 🟢 │
│ ↓                                      │
│ ○ 2 min: CPP 10%, Volume 12K → 24.5%  │
│ ↓                                      │
│ ○ 5 min: CPP 15%, Volume 12K → 18.2%  │
│                                        │
│ [Restore Any Point]                    │
└────────────────────────────────────────┘

Keyboard: Ctrl+Z (Undo), Ctrl+Y (Redo)
```

### Performance Targets

| Action | Target Response Time |
|--------|---------------------|
| Change Volume (single SKU) | <200ms |
| Change Tactic (FU level) | <500ms |
| Expand FU (show SKUs) | <100ms |
| Recalculate all KPIs (50 SKUs) | <500ms |
| Update Grand Totals Panel | <300ms |

### Decision Support vs Decision Authority

**ROI Simulation provides decision support; final commercial responsibility remains with the approving roles.** The system calculates profitability metrics based on input assumptions, but does not guarantee actual promotion outcomes. Market conditions, competitive actions, and execution quality all affect real-world results.

**Legal/Organizational Clarity:**
- System shows: "Projected GP ROI: 21.3%" (based on input assumptions)
- System does NOT claim: "This promotion will generate 21.3% ROI" (outcome guarantee)
- Accountability: Category Manager/Finance approver owns the commercial decision
- System role: Provides analytical framework for informed decision-making

This distinction is critical for:
- Finance audit trails (who approved, on what basis)
- Variance analysis (planned vs actual, not system vs actual)
- Risk management (commercial risk sits with business, not system)

---

## 5.5 Planning Approval Workflow

### Purpose

Planning Approval in Planning-First Mode is **ROI-driven**, not just budget-based. Approvers evaluate profitability metrics (GP ROI%, Incremental GP) alongside budget availability before authorizing plan execution.

### Approval Trigger

**When Planner clicks "Submit for Approval":**
- Plan status: Draft → Pending
- System validates:
  - ✅ At least one FU with planned volumes
  - ✅ All required tactics defined
  - ✅ Budget availability (Total Spend ≤ Available Budget)
  - ✅ No validation errors in grid
- Approval request created
- Approval policy matched (based on: channel, amount, RAG status)

### Approval Policy (Planning-First Specific)

**Phase 1 Policy Configuration:**

In Phase 1, approval policies are **configurable but not user-authorable via UI**. Policies are defined in database configuration tables and can be adjusted by system administrators, but planners/managers cannot create custom policies through the interface.

**Example Policy:**
```json
{
  "policy_name": "NKA Plan Approval - Standard",
  "applies_to": {
    "entity_type": "PLAN",
    "channel": "NKA",
    "amount_range": [0, 100000]
  },
  "approval_levels": [
    {
      "order": 1,
      "role": "CATEGORY_MANAGER",
      "when": { "amount_gte": 0 }
    },
    {
      "order": 2,
      "role": "FINANCE",
      "when": {
        "OR": [
          { "amount_gte": 50000 },
          { "gp_roi_pct_lt": 15 } // Finance approval required if ROI <15%
        ]
      }
    }
  ],
  "auto_reject_conditions": [
    { "gp_roi_pct_lt": 5, "message": "ROI too low (<5%), plan rejected" }
  ]
}
```

### Approval UI (Approver View)

```
┌─────────────────────────────────────────────────────────┐
│ PLAN APPROVAL REQUEST                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Plan ID: PLAN-2026-NKA-001                             │
│ Planner: Ayşe Yılmaz (Category Manager)                │
│ Channel: NKA                                            │
│ CPL: Carrefour (National)                              │
│ Period: Q1 2026                                         │
│                                                         │
│ KEY METRICS:                                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ GP ROI:           21.3% 🟢 (Excellent)              │ │
│ │ Incremental GP:   45,680 TL                        │ │
│ │ Total Spend:      32,150 TL                        │ │
│ │ Budget Available: 50,000 TL (36% remaining)        │ │
│ │                                                     │ │
│ │ Volume Uplift:    30% (Base: 10K → Planned: 13K)   │ │
│ │ Turnover Uplift:  28%                               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ PROFITABILITY BREAKDOWN:                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ FU                     │ GP ROI │ Incr GP │ Status  │ │
│ ├────────────────────────┼────────┼─────────┼─────────┤ │
│ │ Wella SP Shampoo Range │ 24.1%  │ 28,500  │ 🟢 Green│ │
│ │ Wella EIMI Styling     │ 18.2%  │ 12,300  │ 🟡 Amber│ │
│ │ Koleston Perfect       │ 22.5%  │  4,880  │ 🟢 Green│ │
│ └────────────────────────┴────────┴─────────┴─────────┘ │
│                                                         │
│ TACTICAL MIX:                                           │
│ • CPP On-Invoice: 10% (22,100 TL)                      │
│ • Display Fee: 5,000 TL                                │
│ • Visibility Support: 5,050 TL                          │
│                                                         │
│ PLANNER NOTES:                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Q1 JBP aligned with Carrefour's promotional         │ │
│ │ calendar. Focus on SP Shampoo (high margin).        │ │
│ │ EIMI Styling included for portfolio balance.        │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ [📊 View Full Grid] [📄 Export PDF]                    │
│                                                         │
│ DECISION:                                               │
│ ○ Approve    ○ Reject    ○ Request Changes             │
│                                                         │
│ Comments: (Optional)                                    │
│ ┌─────────────────────────────────────────────────────┐ │
│ │                                                     │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ [✅ Submit Decision]                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Budget Commitment (Upon Approval)

**When plan approved:**
```typescript
// Pseudo-code
async function approvePlan(planId: string) {
  const plan = await getPlan(planId);
  
  // Step 1: Change budget state Reserved → Committed
  const envelope = await findBudgetEnvelope({
    channel: plan.channel,
    category: plan.category,
    period: plan.period_month
  });
  
  await createBudgetTransaction({
    envelope_id: envelope.id,
    tx_type: 'COMMIT', // New transaction type (Planning-First only)
    tx_status: 'POSTED',
    source_type: 'PLAN',
    source_id: plan.id,
    amount: plan.total_planned_spend,
    notes: `Plan ${plan.plan_code} approved`
  });
  
  // Step 2: Update plan status
  await updatePlan(planId, {
    status: 'APPROVED',
    approved_at: new Date(),
    approved_by: getCurrentUser().id
  });
  
  // Step 3: Notify planner
  await sendNotification({
    user_id: plan.created_by,
    type: 'PLAN_APPROVED',
    message: `Your plan ${plan.plan_code} has been approved`,
    action_url: `/plans/${planId}`
  });
  
  console.log(`Plan ${planId} approved. Budget committed: ${plan.total_planned_spend} TL`);
}
```

**Budget State Comparison:**

| State | When | Planning-First | Actuals-First |
|-------|------|----------------|---------------|
| **Reserved** | On approval | ❌ Not used | ✅ Agreement approved |
| **Committed** | On approval | ✅ Plan approved | ❌ Not used |
| **Consumed** | On spend actuals | ✅ Execution tracking | ✅ Invoice posted |

---

## 5.6 Use Case Scenarios

### Scenario 1: NKA Joint Business Plan (JBP)

**Context:**
- Channel: NKA (Carrefour)
- Situation: Q1 2026 JBP planning cycle
- Goal: Achieve 20%+ GP ROI on Wella Hair Care portfolio

**Planning Process:**

**Week 1, Day 1:**
- Category Manager opens CollMind
- Creates plan: "Q1 2026 - Carrefour JBP - Hair Care"
- System loads baseline volumes (Oct-Dec 2025 average)

**Week 1, Day 2:**
- Adds 3 FUs:
  - Wella SP Shampoo Range (10 SKUs)
  - Wella EIMI Styling (8 SKUs)
  - Koleston Perfect Hair Color (6 SKUs)
- System shows baseline: 10,000 units, 920,000 TL turnover

**Week 1, Day 3-4:**
- Volume planning (SKU level):
  - SP Shampoo: 3,000 → 3,600 units (+20%)
  - EIMI Styling: 2,500 → 3,000 units (+20%)
  - Koleston: 4,500 → 6,400 units (+42%)
- Total planned: 13,000 units (+30% uplift)

**Week 1, Day 5:**
- Tactic definition (FU level):
  - SP Shampoo: CPP 10%, Display Fee 5,000 TL
  - EIMI Styling: CPP 12%, Price Support 3 TL/unit
  - Koleston: CPP 8%, Visibility 3,000 TL
- System calculates: GP ROI = 18.2% 🟡 (AMBER)

**Week 2, Day 1-2 (Optimization):**
- Iteration 1: Reduce SP CPP: 10% → 8%
  - Result: GP ROI = 20.1% 🟢 (GREEN achieved!)
- Iteration 2: Increase Koleston volume: 6,400 → 7,000
  - Result: GP ROI = 21.3% 🟢 (Better!)
- Final configuration locked

**Week 2, Day 3:**
- Submit for approval
- Category Manager approves (1 hour)
- Finance approves (4 hours)
- Budget committed: 32,150 TL

**Result:**
- ✅ Planning time: 2 weeks (vs. 4-6 weeks with Excel/manual process)
- ✅ ROI visibility: Real-time optimization achieved Green status
- ✅ Budget confidence: Finance approved based on profitability metrics
- ✅ Execution ready: Plan terms communicated to Carrefour

---

### Scenario 2: New Product Launch (Baseline = Zero)

**Context:**
- Product: Wella Professionals Invigo Volume Boost (new SKU)
- Channel: Professional (Salon)
- Challenge: No historical baseline data

**Planning Process:**

**Baseline Handling:**
- System detects: Base Volume = 0 (new product)
- Warning: "No baseline available. ROI calculation will use planned volumes only."
- Planner proceeds with planned volume: 2,000 units

**KPI Calculation Adjustments:**
- Incremental Volume = Planned Volume (since Base = 0)
- Volume Uplift % = NULL (cannot calculate % uplift without baseline)
- GP ROI % = Calculated normally (Planned GP / Total Spend)

**Result:**
- ✅ System handles edge case gracefully
- ✅ ROI still calculable (based on planned profitability)
- ✅ Planner can evaluate: "Is this launch profitable?"

---

### Scenario 3: What-If Optimization (Real Session)

**Starting Point:**
- FU: Wella SP Shampoo Range
- Base Volume: 10,000 units
- Planned Volume: 12,000 units
- CPP Discount: 15%
- GP ROI: 18.2% 🟡 (AMBER - needs optimization)

**Optimization Session (15 minutes):**

**Attempt 1:**
```
Action: Reduce CPP: 15% → 10%
System recalculates (350ms)
Result: GP ROI = 24.5% 🟢
Decision: Good! But can we do better?
```

**Attempt 2:**
```
Action: Increase volume: 12,000 → 13,000
System recalculates (400ms)
Result: GP ROI = 26.1% 🟢
Decision: Better! Accept.
```

**Attempt 3:**
```
Action: Add Display Fee: 5,000 TL
System recalculates (450ms)
Result: GP ROI = 21.3% 🟢
Decision: Still green, but lower. Remove display fee.
```

**Attempt 4:**
```
Action: Undo display fee (Ctrl+Z)
Result: GP ROI = 26.1% 🟢
Decision: Final configuration achieved!
```

**Final State:**
- Planned Volume: 13,000 units (+30% uplift)
- CPP Discount: 10%
- No display fee
- GP ROI: 26.1% 🟢
- Time to optimize: 15 minutes

**Result:**
- ✅ From AMBER to GREEN in 4 iterations
- ✅ Real-time feedback enabled rapid decision-making
- ✅ ROI improved 8 percentage points (18.2% → 26.1%)

---

## 5.7 Phase 1 Implementation Scope

### ✅ Phase 1 Features (Planning-First MVP)

**Core Planning Grid:**
- ✅ Hierarchical FU/SKU structure with expand/collapse
- ✅ Volume input at SKU level (Base, Planned, Incremental, Uplift%)
- ✅ Tactic definition at FU level (CPP%, Display Fees, lumpsums)
- ✅ Dynamic column generation based on plan context
- ✅ Real-time KPI calculation (<500ms response)
- ✅ Grand Totals Panel (6 key metrics)

**KPI Calculation Engine:**
- ✅ 40+ KPIs with formula-driven architecture
- ✅ Dependency graph resolution (correct calculation order)
- ✅ Aggregation from SKU → FU → Plan levels
- ✅ Edge case handling (zero baseline, new products)
- ✅ Formula storage as text (admin-configurable)

**ROI Simulation:**
- ✅ What-If analysis (adjust inputs, see ROI instantly)
- ✅ RAG status evaluation (Green/Amber/Red)
- ✅ Optimization hints (inline suggestions)
- ✅ Undo/Redo stack (Ctrl+Z/Y)

**Approval Workflow:**
- ✅ ROI-based approval policies
- ✅ Multi-level sequential approvals
- ✅ Budget commitment (COMMIT transaction)
- ✅ Auto-reject conditions (ROI < threshold)

**Budget Integration:**
- ✅ Budget commitment on approval (Reserved → Committed)
- ✅ Budget availability checking
- ✅ Committed state (Planning-First only)

**Baseline Data:**
- ✅ Baseline import (CSV/Excel)
- ✅ Baseline validation (SKU matching)
- ✅ Historical volume storage (12 months)
- ✅ Baseline quality threshold enforcement

**Baseline Data Quality Enforcement:**

Baseline data is a **hard dependency** for Planning-First Mode. The system enforces minimum data quality thresholds:

**Quality Gates:**
- **Coverage Threshold:** ≥95% of plan SKUs must have valid baseline data
- **Recency Check:** Baseline data must be ≤90 days old
- **Volume Sanity:** Baseline volumes must be >0 (cannot plan from zero)

**Enforcement Logic:**
```typescript
// Pseudo-code
async function validateBaselineForPlan(planId: string) {
  const skus = await getPlanSKUs(planId);
  let validBaselineCount = 0;
  
  for (const sku of skus) {
    const baseline = await getBaseline(sku.id);
    
    if (baseline && 
        baseline.volume > 0 && 
        daysSince(baseline.period_end) <= 90) {
      validBaselineCount++;
    }
  }
  
  const coveragePct = (validBaselineCount / skus.length) * 100;
  
  if (coveragePct < 95) {
    throw new Error(
      `Insufficient baseline coverage (${coveragePct.toFixed(1)}%). ` +
      `Planning-First requires ≥95% SKU baseline data. ` +
      `Consider using Actuals-First for this promotion.`
    );
  }
  
  return { valid: true, coverage: coveragePct };
}
```

**User Feedback (Baseline Insufficient):**
```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ BASELINE DATA INSUFFICIENT                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Planning-First cannot be used for this plan:           │
│                                                         │
│ Baseline Coverage: 78% (18 of 23 SKUs)                │
│ Required: ≥95%                                          │
│                                                         │
│ Missing baseline for:                                   │
│ • Wella SP Silver Blond 250ml (new product)            │
│ • Wella EIMI Glam Mist 200ml (no data)                 │
│ • Koleston Perfect 7/1 (baseline too old: 120 days)    │
│ • [+2 more]                                             │
│                                                         │
│ RECOMMENDATIONS:                                         │
│ 1. Import baseline data for missing SKUs               │
│ 2. Remove SKUs without baseline from plan              │
│ 3. Use Actuals-First Mode instead                      │
│                                                         │
│ [Import Baseline] [Remove SKUs] [Switch to Actuals]   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Why This Matters:**
- Prevents garbage-in-garbage-out (GIGO) scenarios
- Protects ROI calculation integrity (ROI without baseline = meaningless)
- Forces discipline on data quality before planning
- Guides users to Actuals-First when Planning-First is inappropriate

---

### ❌ Explicitly NOT in Phase 1 (Deferred)

**Advanced Grid Features:**
- ❌ Bulk edit (select multiple SKUs, apply change)
- ❌ Copy/paste from Excel
- ❌ Custom column configuration (hide/show columns)
- ❌ Grid templates (save/load column sets)

**Advanced KPI Features:**
- ❌ Custom KPI builder (admin creates new KPIs via UI)
- ❌ Scenario comparison (compare 2 plans side-by-side)
- ❌ Time-series visualization (historical ROI trends)

**Integration:**
- ❌ Baseline auto-refresh (nightly sync from sales system)
- ❌ Master data sync (real-time COGS updates)
- ❌ Actuals import (execution variance tracking - Phase 2)

**Collaboration:**
- ❌ Multi-user editing (real-time co-editing)
- ❌ Comments on SKUs/FUs
- ❌ Version comparison (Plan v1 vs v2)

**Advanced Approval:**
- ❌ Parallel approvals (multiple approvers simultaneously)
- ❌ Delegated approvals (out-of-office delegation)
- ❌ Conditional routing (if ROI <15%, route to CFO)
- ❌ Policy authoring UI (admin creates policies via UI)

---

### 🔮 Phase 2+ Roadmap Items

**Phase 2 (Actuals Tracking):**
- Import actual sales volumes
- Variance analysis (Planned vs Actual)
- KPI recalculation with actuals
- Lessons learned reports

**Phase 3 (Optimization):**
- AI-driven volume recommendations
- Automatic tactic optimization (maximize ROI)
- Portfolio optimization (optimize across multiple plans)
- Price elasticity modeling

**Phase 4 (Collaboration):**
- Multi-user real-time editing
- Comments and annotations
- Version control with diff view
- Approval workflows with comments

---

**END OF SECTION 5 - PLANNING-FIRST MODE**

---



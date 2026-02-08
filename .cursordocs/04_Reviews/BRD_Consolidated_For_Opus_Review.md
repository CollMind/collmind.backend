# COLLMIND TPM PLATFORM
## Business Requirements Document - Consolidated for Opus Review

---

**Document Purpose:** This consolidated document contains the 6 most critical sections of the CollMind TPM BRD for comprehensive architectural and strategic review.

**Review Focus:**
1. Architecture soundness and data model consistency
2. Technical feasibility and performance considerations
3. Integration complexity and external dependencies
4. Business case strength and value proposition clarity
5. Delivery roadmap realism and phase boundaries
6. Risk mitigation adequacy and assumption validity

**Total Content:** ~70 pages covering:
- Section 1: Executive Summary (strategic overview)
- Section 3: Core Components (data model, architecture)
- Section 5: Planning-First Mode (most complex capability)
- Section 6: Data & Integration Model (external dependencies)
- Section 10: Phased Delivery & Roadmap (implementation strategy)
- Section 11: Assumptions, Dependencies & Risks (risk analysis)

---

**Document Version:** 1.0 Final
**Date:** January 7, 2026
**Total Original BRD:** 155 pages, 43,869 words, 12 sections

---
-e 

═══════════════════════════════════════════════════════════════════════════════

SECTION 1: EXECUTIVE SUMMARY
-e ═══════════════════════════════════════════════════════════════════════════════



---

# 1. EXECUTIVE SUMMARY

## 1.1 Product Vision

CollMind TPM Platform is a next-generation Trade Promotion Management solution designed to address the diverse operational needs of FMCG companies across all channel types. Unlike traditional TPM systems that force organizations into a single workflow paradigm, CollMind supports **multiple operational capabilities representing different maturity levels of trade management**, enabling companies to start with execution control and progressively evolve toward planning and optimization.

**Vision Statement:**  
*"One platform, any channel, any speed — from tactical execution to strategic planning."*

The platform recognizes that trade promotion management maturity is not binary but evolutionary. Organizations typically begin with execution tracking (Actuals-First capability) to gain spend visibility and control, then advance to forward planning (Planning-First capability) as data quality, process discipline, and forecasting confidence improve. CollMind supports this natural progression within a single unified platform, addressing different maturity levels:

- **Execution Control (Actuals-First capability):** Organizations begin here to gain spend visibility, establish baseline data, and implement governance
- **Strategic Planning (Planning-First capability):** As data quality and forecasting confidence mature, organizations progress to ROI-driven forward planning
- **Hybrid Operations:** Mature organizations leverage both capabilities contextually — planning where predictability exists, executing rapidly where market dynamics demand agility

CollMind uniquely addresses this evolutionary path within a single platform, eliminating the need for multiple disparate systems or forcing all business processes into a one-size-fits-all approach.

---

## 1.2 Business Problem

### Current State Challenges

FMCG companies today face a fundamental dilemma in trade promotion management:

**Challenge 1: One-Size-Fits-All Doesn't Work**
```
Traditional TPM Systems Force:
├─ Traditional channels into slow planning processes
│  └─ Result: Lost competitive opportunities, market share erosion
├─ Strategic channels into reactive mode
│  └─ Result: Poor ROI, budget overruns, missed targets
└─ Finance into fragmented visibility
   └─ Result: Budget surprises, compliance issues, audit gaps
```

**Challenge 2: Typical Traditional Trade Challenges**

| Pain Point | Current State | Business Impact |
|------------|---------------|-----------------|
| **Budget Visibility** | 30-40% - Fragmented tracking | Hidden spend, budget surprises |
| **Action Speed** | 2-5 days for approval | Lost competitive windows |
| **Off-Invoice Tracking** | Manual, delayed | Finance reconciliation nightmare |
| **Spend Attribution** | Unclear rationale | Compliance risk, no learning |
| **Data Silos** | Sales/Finance misaligned | Single truth missing |
| **Traditional Channel** | Reactive, untracked | Historically fragmented and reactive spend environments |

**Challenge 3: The Market Gap**

Existing TPM solutions fall into two camps, neither of which solves the complete problem:

**Camp A: Planning-First Systems**
- Designed for strategic planning (e.g., NKA quarterly JBPs)
- Require baseline data, volume forecasts, ROI simulation
- Too slow and rigid for Traditional trade dynamics
- ❌ **Failure Mode:** Traditional channels bypass the system entirely

**Camp B: Execution/Actuals Systems**  
- Track what happened, no forward planning capability
- No ROI optimization, no what-if scenarios
- Cannot support strategic promotion planning
- ❌ **Failure Mode:** NKA channels lack optimization tools

**The Real Need:**  
Companies need **BOTH** capabilities in a **SINGLE** platform because:
1. Most organizations operate across multiple channel types
2. Budget and spend visibility must be unified
3. Master data must be consistent
4. Reporting must show complete picture
5. Audit trail must be comprehensive

---

## 1.3 Solution Overview: Dual-Mode Architecture

### The CollMind Approach

CollMind TPM Platform is built on a **unified core** that supports **multiple operational capabilities** optimized for different trade management maturity levels and business contexts. Although multiple operational capabilities coexist within the platform, their activation is governed by organizational policies, user permissions, and contextual scope (channel, customer, or market), rather than manual mode switching.

```
┌─────────────────────────────────────────────────────────┐
│           COLLMIND TPM PLATFORM (Single)                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │        SHARED CORE (Mode-Agnostic)              │   │
│  ├─────────────────────────────────────────────────┤   │
│  │ Master Data │ RBAC │ Budget │ Approval Engine   │   │
│  │ Tactic Library │ Ledger │ Reporting Framework   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐   │
│  │ ACTUALS-FIRST        │  │ PLANNING-FIRST       │   │
│  │ CAPABILITY           │  │ CAPABILITY           │   │
│  ├──────────────────────┤  ├──────────────────────┤   │
│  │ • STA/LTA Agreements │  │ • Forward Planning   │   │
│  │ • Off-Invoice Import │  │ • ROI Simulation     │   │
│  │ • Spend Tracking     │  │ • KPI Engine         │   │
│  │ • Rapid Execution    │  │ • Planning Grid      │   │
│  └──────────────────────┘  └──────────────────────┘   │
│                                                         │
│        ANY CHANNEL              ANY CHANNEL             │
└─────────────────────────────────────────────────────────┘
```

### Capability 1: Actuals-First

**Designed for:** Rapid tactical execution, reactive markets, agreement-based promotions

**When to use:**
- Competitive response required within hours/days
- Baseline data unavailable or unreliable
- Spot opportunities arise unexpectedly
- Distributor negotiations and rebates
- Traditional trade dynamics

**Process Flow:**
```
Execute Action → Record Agreement → Get Approval → Track Spend
    (Hours)         (Minutes)         (< 24h)        (Real-time)
```

**Key Capabilities:**
- Short-Term Agreements (STA): ≤30 days, rapid setup
- Long-Term Agreements (LTA): >30 days, strategic terms
- Off-Invoice batch import (40-50 invoices in <5 minutes)
- Near real-time spend visibility with reconciliation-grade audit trail
- Policy-driven validation and approval
- Mandatory justification and audit trail

**Example:** Competitor launches 20% discount on shampoo category. Company's planner creates STA within 30 minutes, gets approval same day, executes promotion next day — vs. 5-day delay with traditional planning-only systems.

### Capability 2: Planning-First

**Designed for:** Strategic forward planning, ROI optimization, promotional calendars

**When to use:**
- Time available for optimization (weeks to months ahead)
- Quarterly/annual joint business plans (JBP)
- Monthly promotional calendars
- Campaigns requiring ROI simulation
- Baseline and uplift calculable

**Process Flow:**
```
Create Plan → Simulate ROI → Optimize → Approve → Execute → Track Actuals
  (Hours)      (Real-time)    (Hours)   (Days)    (Ongoing)  (Real-time)
```

**Key Capabilities:**
- Forward planning grid (FU/SKU hierarchy)
- Dynamic KPI calculation engine (GP ROI, Uplift%, etc.)
- Real-time ROI simulation with RAG status
- What-if scenario analysis
- Baseline and incremental volume planning
- Grand totals panel with visual feedback

**Example:** NKA customer requests Q2 promotional plan. Planner creates plan with 20 FUs, simulates ROI across 100+ SKUs, optimizes to hit 150% GP ROI target, submits for approval with full financial visibility.

### Hybrid Usage: The Real-World Pattern

Most customers use **both capabilities simultaneously** across different channels and contexts. Hybrid usage does not imply inconsistent governance — all execution and planning activities ultimately converge into a unified ledger and policy framework, ensuring financial control and auditability.

**Note:** Illustrative distribution only; actual ratios vary by organization, channel maturity, and competitive intensity.

```
TYPICAL FMCG COMPANY:
├─ NKA Channel
│  ├─ 80% Planning-First (quarterly plans)
│  └─ 20% Actuals-First (spot deals)
│
├─ Modern Trade  
│  ├─ 60% Planning-First (monthly calendar)
│  └─ 40% Actuals-First (opportunistic)
│
└─ Traditional Trade
   ├─ 20% Planning-First (seasonal campaigns)
   └─ 80% Actuals-First (daily competitive moves)
```

**Platform Value:**
- **Single master data** across all channels
- **Unified budget** with real-time visibility
- **One reporting framework** (no reconciliation needed)
- **Consistent approval workflow** (policy-driven)
- **Complete audit trail** (all spend tracked)

---

## 1.4 Key Differentiators

### What Makes CollMind TPM Unique?

| Feature | CollMind TPM | Traditional TPM | Impact |
|---------|--------------|-----------------|--------|
| **Dual-Capability Architecture** | ✅ Both capabilities in one platform | ❌ Pick one paradigm | Serves all channels |
| **Mode-Agnostic Core** | ✅ Shared master data, budget, ledger | ❌ Separate systems | Single source of truth |
| **Speed + Strategy** | ✅ Hours (Actuals) + Days (Planning) | ❌ Only one speed | No trade-offs |
| **Off-Invoice Automation** | ✅ Batch import, idempotency, staging | ❌ Manual or basic | Finance efficiency |
| **Policy-Driven Approval** | ✅ JSON-configurable rules engine | ❌ Hard-coded workflows | Business agility |
| **Unified Ledger** | ✅ Single spend tracking for both capabilities | ❌ Fragmented logs | Reconciliation-grade visibility |
| **Tactic Flexibility** | ✅ Mode-specific policies per tactic | ❌ One-size-fits-all | Channel optimization |
| **ROI Simulation** | ✅ Real-time KPI engine (Planning) | ⚠️ Limited or offline | Decision quality |
| **Justification Mandate** | ✅ Every spend requires rationale | ❌ Optional or absent | Audit + learning |
| **Channel Independence** | ✅ Any capability for any channel | ❌ Channel-locked | True flexibility |

### Technical Differentiators

1. **Cloud-Native Architecture**
   - Modern tech stack (PostgreSQL, React, Node.js)
   - Scalable, performant (<2s page loads)
   - Mobile-responsive (tablet-optimized)

2. **Formula-Driven KPI Engine**
   - Admin-configurable formulas (no code changes)
   - Dependency graph for complex calculations
   - Real-time recalculation (<500ms)

3. **Idempotency at Scale**
   - File-level duplicate prevention (hash)
   - Row-level duplicate prevention (idempotency key)
   - Transaction-level duplicate prevention (unique constraints)

4. **RBAC with Granularity**
   - Mode-agnostic roles
   - Permission overrides for exceptions
   - Capability-based access control

---

## 1.5 Expected Business Value

### Value Proposition Framework

CollMind TPM Platform delivers value across multiple dimensions, creating both immediate operational improvements and long-term strategic advantages. The specific financial impact varies by organization based on trade spend volume, channel mix, and current process maturity.

### Operational Value Drivers

**1. Speed & Agility**
- **Faster Action:** Compress decision cycles from days to hours in reactive scenarios
- **Market Responsiveness:** Capture competitive windows that would otherwise be missed
- **Flexible Operations:** Match system workflow to business reality, not vice versa

**2. Financial Control & Visibility**
- **Comprehensive Tracking:** Near real-time spend visibility with full auditability across all channels and capabilities
- **Budget Governance:** Policy-driven controls prevent out-of-bounds commitments
- **Unified View:** Single source of truth eliminates reconciliation overhead
- **Proactive Alerts:** Threshold-based notifications enable intervention before overruns

**3. Compliance & Audit Readiness**
- **Complete Trail:** Every transaction documented with full approval chain
- **Mandatory Justification:** Business rationale captured for every spend decision
- **Automated Reconciliation:** Off-invoice batch processing reduces manual effort by 80-90%
- **Policy Enforcement:** Validation rules ensure compliance at point of entry

**4. Strategic Decision Quality**
- **ROI Optimization:** Planning-First mode enables what-if scenarios and profitability simulation
- **Data-Driven Insights:** Unified reporting reveals patterns across channels
- **Learning Loop:** Actuals inform future planning; plans provide baseline for variance analysis
- **Resource Optimization:** Planners focus on high-value activities vs. manual data wrangling

**5. Organizational Alignment**
- **Cross-Functional Consistency:** Sales, Finance, Trade Marketing work from same data
- **Process Standardization:** Consistent governance without sacrificing flexibility
- **Reduced Friction:** No reconciliation battles between departments
- **Shared Accountability:** Clear ownership and approval trails

### Typical Improvement Dimensions

Organizations implementing dual-mode TPM platforms typically realize improvements in the following areas:

| Dimension | Typical Improvement Range | Key Driver |
|-----------|---------------------------|------------|
| **Action Speed** | 70-95% reduction in cycle time | Actuals-First mode for reactive scenarios |
| **Budget Visibility** | 30-40% → 95-100% | Unified ledger, real-time tracking |
| **Off-Invoice Processing** | 80-95% time savings | Automated batch import with validation |
| **Approval Turnaround** | 50-80% faster | Policy-driven workflows, notifications |
| **Finance Close Time** | 40-60% reduction | Automated reconciliation, clean data |
| **Planner Productivity** | 30-50% increase | Reduced manual work, better tools |
| **Audit Compliance** | 60-80% → 95%+ | Complete trail, mandatory justification |

*Note: Specific results depend on baseline maturity, implementation quality, and change management effectiveness.*

### Strategic Benefits (Long-Term)

Beyond immediate operational gains, the platform enables strategic capabilities:

**Foundation for Advanced Analytics**
- Clean, structured data enables AI/ML applications
- Historical patterns inform predictive models
- What-if scenario library grows over time

**Scalability & Growth**
- Platform grows with business (new channels, new tactics, new markets)
- Mode flexibility accommodates M&A integration
- Cloud-native architecture scales without re-implementation

**Competitive Advantage**
- Faster market response creates sustainable edge
- Better ROI optimization compounds over time
- Data-driven culture becomes organizational competency

### ROI Considerations

The business case for CollMind TPM varies significantly based on:
- **Trade Spend Volume:** Larger budgets = larger absolute savings
- **Channel Mix:** Traditional-heavy benefits more from Actuals-First
- **Process Maturity:** Lower baseline = larger improvement potential
- **Organization Size:** Larger teams = higher productivity multiplier
- **Current Systems:** Replacing manual processes yields more value than replacing modern systems

**Recommendation:** Conduct organization-specific ROI analysis using the ROI Business Case Framework (see Appendix X) with actual spend data, headcount, and baseline metrics.

---

## 1.6 Success Metrics

### Platform-Level KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| **System Uptime** | >99.5% | Monthly availability |
| **User Adoption** | >90% within 3 months | Active users / total users |
| **User Satisfaction** | >4.0/5.0 | Post-training survey |
| **Page Load Time** | <2 seconds | 95th percentile |
| **API Response Time** | <300ms | 95th percentile |

### Actuals-First Capability KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Agreement Creation Time** | <30 minutes | Median duration (draft → submit) |
| **Off-Invoice Batch Processing** | <5 minutes (50 invoices) | Processing time per batch |
| **Budget Visibility** | All tracked spend | % of spend recorded in ledger |
| **Approval Turnaround** | <24 hours | Median time (submit → decision) |
| **Effective Discount Tracking** | All agreements | % agreements with calculated discount |
| **Justification Compliance** | All agreements | % agreements with valid justification |

**Note:** Targets should be calibrated per baseline and organizational context.

### Planning-First Capability KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Plan Creation Time** | <2 hours | Median duration (start → submit) |
| **KPI Calculation Speed** | <500ms | Time from input change → UI update |
| **ROI Simulation Variance** | <15% deviation | Actuals vs. Planned variance (model & baseline dependent) |
| **Planning Approval Rate** | >90% | % plans approved first time |
| **Planner Productivity** | 10+ plans/week | Avg plans created per planner |

### Business Impact KPIs (6-12 Months Post Go-Live)

| Metric | Typical Baseline | Target Range | Measurement Method |
|--------|------------------|--------------|-------------------|
| **Action Speed** | 2-5 days | <1 day | Time from trigger → execution |
| **Budget Accuracy** | ±10-15% variance | ±2-5% variance | Forecast vs. Actual |
| **Compliance Score** | 60-80% | >95% | Audit checklist completion |
| **Finance Close Time** | 3-7 days/month | 1-2 days/month | Month-end close duration |
| **Planner Satisfaction** | Baseline (survey) | +30-50% improvement | Quarterly pulse survey |
| **Spend Visibility** | 30-60% tracked | 95-100% tracked | % spend in system |

*Note: Specific targets should be established based on organizational baseline during implementation planning.*

---

## 1.7 Strategic Alignment

### Organizational Readiness

**Prerequisites for Success:**
- ✅ Executive sponsorship secured (Trade Marketing + Finance)
- ✅ Dedicated project team (1 PM, 1 BA, 8-10 UAT users)
- ✅ Master data available (SKU, Customer, Pricing)
- ✅ Clear approval workflows defined
- ✅ Budget for training and change management

**Change Management Priorities:**
1. **Cultural Shift:** From "ad-hoc spend" to "tracked + justified spend"
2. **Process Discipline:** Mandatory system usage (no bypass)
3. **Cross-Functional Alignment:** Sales, Finance, Trade Marketing collaboration
4. **Skill Building:** User training on both operational modes
5. **Measurement Mindset:** KPI-driven decision making

### Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| User Resistance | Medium | High | Champions program, training, quick wins |
| Data Quality Issues | High | Medium | Data cleansing phase, validation rules |
| Integration Delays | Low | Medium | Phased approach, SSO prioritized |
| Scope Creep | High | Medium | Strict change control, backlog management |
| Budget Overrun | Low | High | Fixed-price contract, milestone payments |

---

## Next Steps

This BRD provides the foundation for:
1. **Stakeholder Alignment:** Confirm vision and scope
2. **Technical Planning:** Architecture and database design  
3. **ROI Analysis:** Customer-specific business case development (see Appendix X)
4. **Implementation Planning:** Phased roadmap, resource allocation
5. **Contract Development:** SOW, pricing based on scope and scale

**Recommendation:** Start with the capability that matches current operational maturity—typically Actuals-First for reactive environments—while establishing the shared core that enables Planning-First expansion. This phased approach delivers immediate value while building toward comprehensive trade management maturity.

---

**Document Status:** Draft v0.1  
**Next Review:** Stakeholder feedback session  
**Target Approval Date:** January 10, 2026

---

*End of Section 1: Executive Summary*
-e 

═══════════════════════════════════════════════════════════════════════════════

SECTION 3: CORE COMPONENTS
-e ═══════════════════════════════════════════════════════════════════════════════



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
-e 

═══════════════════════════════════════════════════════════════════════════════

SECTION 5: PLANNING-FIRST MODE
-e ═══════════════════════════════════════════════════════════════════════════════



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


-e 

═══════════════════════════════════════════════════════════════════════════════

SECTION 6: DATA & INTEGRATION MODEL
-e ═══════════════════════════════════════════════════════════════════════════════



---

# 6. DATA & INTEGRATION MODEL

## Introduction

This section defines **how data enters and flows through** the CollMind TPM platform. It addresses the critical question every enterprise IT team asks before kickoff: "What data do you need, from where, at what granularity, and how often?"

**Scope:** This section covers data domains, integration patterns, granularity decisions, idempotency rules, and data ownership. It does NOT prescribe specific ERP vendors, field-by-field mappings, or ETL tool selections — those are implementation details determined during technical design.

**Why This Matters:**
- **Enterprise IT:** Needs to know what systems to integrate, what APIs to expose
- **Data Engineering:** Needs to understand data quality requirements, refresh frequencies
- **Finance:** Needs to understand data lineage, audit trails
- **Product:** Needs to understand what's possible vs impossible without specific data

---

## 6.1 Data Domains

### Product Architecture Principle

**CollMind is intentionally not a data warehouse; it is a decision and execution system that consumes, validates, and contextualizes enterprise data.** This distinction is critical: CollMind does not replace existing ERP, MDM, or BI systems. Instead, it integrates with them to enable promotional planning and execution workflows.

**What This Means:**
- CollMind is NOT a "single source of truth" for all enterprise data
- CollMind IS the source of truth for planning artifacts (plans, agreements, budgets)
- Master data (customers, products) lives in ERP; CollMind consumes it
- Transactional data (sales, invoices) lives in ERP; CollMind imports it for analysis

**Why This Matters:**
- Prevents scope creep ("Can we store all customer contact info in CollMind?")
- Clarifies integration strategy (read from ERP, write to TPM ledger)
- Sets expectations (CollMind is not a BI reporting tool)

---

CollMind TPM operates on **three core data domains**, each with different characteristics, sources, and refresh patterns.

### Domain 1: Master Data

**Definition:** Relatively static, reference entities that define the business structure.

**Entities:**

| Entity | Description | Key Attributes | Refresh Frequency |
|--------|-------------|----------------|-------------------|
| **Customer** | Individual customers/accounts | ID, Name, Channel, Region, Status | Weekly or on-demand |
| **CPL (Customer Planning Level)** | Aggregation of customers for planning | ID, Name, Channel, Customer IDs | Weekly or on-demand |
| **Product (SKU)** | Stock Keeping Units | ID, Name, Brand, Category, List Price, COGS, UOM | Daily (price changes) |
| **FU (Forecasting Unit)** | Aggregation of SKUs for planning | ID, Name, Category, SKU IDs | Weekly or on-demand |
| **GU (Group Unit)** | Aggregation of FUs (optional) | ID, Name, Category, FU IDs | Weekly or on-demand |
| **Tactic** | Promotional mechanism types | ID, Name, Type, Spending Type, Applicability Rules | Monthly (rarely changes) |
| **Mechanic** | Specific implementations of tactics | ID, Name, Tactic ID, Calculation Rules | Monthly (rarely changes) |
| **Organizational Hierarchy** | Regions, channels, categories | Region ID, Channel, Category Tree | Quarterly (rarely changes) |

**Sources:**
- ERP system (Customer, Product)
- MDM (Master Data Management) system
- Manual configuration (CPL, FU, GU, Tactics)

**Data Quality Requirements:**
- **Completeness:** 100% of active customers/products must be present
- **Consistency:** IDs must match across source systems
- **Recency:** Master data must be ≤7 days old (price/COGS ≤1 day old)

**Integration Pattern:** API (read) + Manual entry (UI for FU/CPL/Tactic configuration)

---

### Domain 2: Transactional Data

**Definition:** High-volume, time-series data that represents business events.

**Data Types:**

| Data Type | Description | Granularity | Refresh Frequency | Use Case |
|-----------|-------------|-------------|-------------------|----------|
| **Sales Actuals** | Historical sales volumes | Customer × SKU × Day | Daily (batch) | Baseline calculation (Planning-First) |
| **Invoice Data** | Invoice headers and line items | Invoice × Line × SKU | Daily (batch) | Off-invoice spend tracking (Actuals-First) |
| **Shipment Data** | Physical shipments to customers | Shipment × SKU × Quantity | Daily (batch) | Volume actuals (if invoice unavailable) |
| **Payment Data** | Customer payments, deductions | Payment × Invoice × Amount | Weekly (batch) | Settlement tracking (future phase) |

**Sources:**
- ERP system (sales, invoices, shipments)
- Finance system (payments)

**Data Quality Requirements:**
- **Completeness:** ≥95% of transactions must be present (gaps flagged for review)
- **Timeliness:** T+1 refresh (data from yesterday available today)
- **Accuracy:** Volume/amount mismatches <2% tolerance

**Integration Pattern:** File-based (CSV/SFTP) or API (batch)

---

### Domain 3: Reference Data

**Definition:** Configuration data that defines system behavior.

**Data Types:**

| Data Type | Description | Managed By | Refresh Pattern |
|-----------|-------------|------------|-----------------|
| **Budget Templates** | Budget envelope structures | Finance Admin | Manual (quarterly) |
| **Approval Policies** | Workflow routing rules | System Admin | Manual (as needed) |
| **KPI Definitions** | Formula and calculation rules | System Admin | Manual (rarely) |
| **RAG Thresholds** | Green/Amber/Red boundaries | Finance Admin | Manual (annually) |
| **User Roles & Permissions** | Access control configuration | IT Admin | Manual (as needed) |

**Sources:**
- CollMind UI (Admin configuration)
- Configuration files (initial setup)

**Integration Pattern:** Manual (UI-based configuration)

---

## 6.2 Integration Patterns

CollMind supports **three integration patterns**, each appropriate for different data domains and organizational capabilities.

### Pattern 1: API Integration (Real-Time / Near Real-Time)

**Use Cases:**
- Master data lookups (Customer, Product)
- Validation checks (e.g., "Is this Customer ID valid?")
- Future: Real-time invoice posting (Phase 2+)

**Characteristics:**
- **Direction:** Bidirectional (read/write)
- **Frequency:** On-demand (sub-second response)
- **Protocol:** REST API (JSON)
- **Authentication:** OAuth 2.0 or API key

**Example Flow:**
```
CollMind → ERP API: GET /api/customers?channel=NKA
ERP API → CollMind: 200 OK, [{ id: "CUST001", name: "Carrefour", ... }]
Planner → Select customer in UI
CollMind → ERP API: GET /api/customers/CUST001/products
ERP API → CollMind: 200 OK, [{ sku: "SKU123", price: 95.00, ... }]
```

**Phase 1 API Endpoints (Required from ERP):**
- `GET /customers` - List active customers (filtered by channel/region)
- `GET /customers/{id}` - Customer details
- `GET /products` - List active SKUs
- `GET /products/{sku}` - SKU details (price, COGS, UOM)

**API Response Time Requirements:**
- Average: <500ms
- 95th percentile: <2s
- Timeout: 10s

---

### Pattern 2: File-Based Integration (Batch)

**Use Cases:**
- Sales actuals import (daily baseline refresh)
- Invoice data import (off-invoice tracking)
- Bulk master data updates (weekly full refresh)

**Characteristics:**
- **Direction:** Inbound (source system → CollMind)
- **Frequency:** Scheduled (daily, weekly)
- **Format:** CSV (preferred), Excel (.xlsx), JSON
- **Transport:** SFTP (preferred), S3 bucket, Azure Blob Storage

**File Naming Convention:**
```
{entity}_{YYYYMMDD}_{HHmmss}.{ext}

Examples:
sales_actuals_20260107_020000.csv
invoices_20260106_235900.csv
customers_master_20260101_000000.csv
```

**File Structure Example (Sales Actuals):**
```csv
customer_id,sku,date,quantity,list_price,invoice_value
CUST001,SKU123,2026-01-06,100,95.00,9500.00
CUST001,SKU124,2026-01-06,50,89.00,4450.00
CUST002,SKU123,2026-01-06,200,95.00,19000.00
```

**File Processing Flow:**
```
1. Source System → SFTP: Upload file
2. CollMind: Detect file (polling every 5 minutes)
3. CollMind: Download file to staging
4. CollMind: Validate file (schema, data types, mandatory fields)
5. CollMind: Import records (with idempotency check)
6. CollMind: Update processing status (success/failure)
7. CollMind: Archive file (retain 90 days)
8. CollMind: Send notification (email/webhook on failure)
```

**File Size Limits:**
- Max file size: 500 MB
- Max rows per file: 1,000,000
- Recommendation: Split large files (e.g., daily actuals by region)

---

### Pattern 3: Manual Entry (UI-Based)

**Use Cases:**
- Emergency data corrections
- New entity creation (CPL, FU)
- One-time configuration (tactics, policies)

**Characteristics:**
- **Direction:** Inbound (user → CollMind)
- **Frequency:** On-demand (ad-hoc)
- **Interface:** Web UI forms

**When to Use:**
- Data not available in source systems (e.g., new FU definition)
- Urgent corrections (e.g., baseline data error discovered mid-planning)
- Configuration tasks (e.g., create new approval policy)

**When NOT to Use:**
- High-volume data entry (>50 records) → Use file import
- Routine transactional data (sales, invoices) → Use batch import

---

## 6.3 Granularity Decisions

**Granularity = The level of detail at which data is stored and processed.**

CollMind's granularity choices balance **data precision** (more detail = better insights) with **system performance** (more detail = slower queries, larger storage).

### Decision 1: Sales Actuals Granularity

**Question:** At what level should baseline volumes be stored?

**Options:**
- Customer × SKU × Day (most granular)
- Customer × FU × Week (aggregated)
- CPL × SKU × Month (highly aggregated)

**Phase 1 Decision:**
```
Customer × SKU × Day (or Week)
```

**Rationale:**
- Enables SKU-level planning (Planning-First requirement)
- Supports uplift % calculation (planned vs baseline at SKU level)
- Allows future drill-down to daily patterns (seasonality analysis)

**Storage Impact:**
- ~10,000 customers × 5,000 SKUs × 365 days = 18.25 billion records/year
- With aggregation (weekly): 2.6 billion records/year
- Trade-off: Daily = precise, Weekly = performant

**Phase 1 Constraint:**
- Import weekly aggregates (balance precision and performance)
- Store daily data if available (for future use)

---

### Decision 2: Budget Granularity

**Question:** At what dimensions should budgets be allocated?

**Options:**
- Channel × Category × Period (simple)
- Channel × Category × Region × Period (more granular)
- Channel × Category × Brand × Region × CPL × Period (very granular)

**Phase 1 Decision:**
```
Channel × Category × Period
```

**Rationale:**
- Matches organizational budget planning processes (most companies budget by channel/category)
- Avoids over-engineering (brand/region splits can be simulated in planning)
- Future-proof: Budget schema supports multi-dimensional JSONB (can add dimensions without migration)

**Example:**
```
Budget Envelope:
- Channel: NKA
- Category: Hair Care
- Period: 2026-01 (January)
- Allocated: 215,000 TL
```

---

### Decision 3: Invoice Data Granularity

**Question:** At what level should off-invoice data be stored?

**Options:**
- Invoice header only (no line items)
- Invoice × Line (with SKU detail)
- Invoice × Line × Agreement (linked to source agreement)

**Phase 1 Decision:**
```
Invoice × Line (with optional Agreement link)
```

**Rationale:**
- Enables SKU-level spend tracking (required for KPI calculation)
- Agreement link enables spend attribution (which agreement consumed budget)
- Supports reconciliation (planned spend vs actual invoices)

**Example:**
```
Invoice: INV-2026-001
├─ Line 1: SKU123, 100 units, 1,500 TL → Agreement STA-2026-025
├─ Line 2: SKU124, 50 units, 750 TL → Agreement STA-2026-025
└─ Total: 2,250 TL
```

### Granularity Philosophy

**Granularity choices are driven by decision needs, not by data availability alone.** Just because a source system can provide SKU × Customer × Day granularity does not mean CollMind should store it at that level. The correct granularity balances:
- **Decision utility:** Does the planner need daily detail, or is weekly sufficient?
- **System performance:** More granularity = slower queries, larger storage
- **User experience:** Can a planner reasonably work with 10M rows in a planning grid?

**Example:**
- Source system has: Customer × SKU × Day (365 days/year)
- CollMind stores: Customer × SKU × Week (52 weeks/year)
- Benefit: 7× data reduction, same planning quality

This is a product decision, not a technical limitation.

---

## 6.4 Idempotency & Corrections

**Idempotency = The ability to apply the same data multiple times without causing duplicates or errors.**

### Idempotency Strategy

**Problem:**
- Files may be uploaded multiple times (network retry, operator error)
- Same invoice may be imported twice
- Sales actuals may be corrected after initial import

**Solution:**
CollMind uses **multi-level idempotency keys** to detect duplicates:

**Level 1: File Hash**
```typescript
// Pseudo-code
const fileHash = sha256(fileContent);
const existingImport = await checkImportHistory(fileHash);

if (existingImport) {
  return {
    status: 'DUPLICATE_FILE',
    message: `This file was already imported on ${existingImport.imported_at}`,
    original_batch_id: existingImport.batch_id
  };
}
```

**Level 2: Record-Level Key**
```typescript
// Sales Actuals: customer_id + sku + date
idempotency_key = `ACTUALS|${customer_id}|${sku}|${date}`;

// Invoice: invoice_number + line_number
idempotency_key = `INVOICE|${invoice_no}|${line_no}`;

// Agreement Transaction: agreement_id + invoice_no + invoice_date
idempotency_key = `AGR_TXN|${agreement_id}|${invoice_no}|${invoice_date}`;
```

**Level 3: Version Control**
```sql
CREATE TABLE import_batches (
  id UUID PRIMARY KEY,
  entity_type VARCHAR(50), -- 'SALES_ACTUALS', 'INVOICES'
  file_hash VARCHAR(64),
  imported_at TIMESTAMPTZ,
  imported_by UUID,
  status VARCHAR(20), -- 'PROCESSING', 'COMPLETED', 'FAILED'
  records_total INTEGER,
  records_inserted INTEGER,
  records_updated INTEGER,
  records_skipped INTEGER
);
```

---

### Correction Strategies

**Scenario 1: Sales Actuals Correction**

**Problem:** Week 1 sales data imported with wrong volumes (e.g., data entry error at source)

**Options:**
- **Option A: Overwrite** (replace entire period)
- **Option B: Adjustment** (create offsetting records)

**Phase 1 Decision: Overwrite (Simpler)**

```typescript
// Pseudo-code
async function importSalesActuals(file, period) {
  // Step 1: Validate period
  if (await hasApprovedPlansInPeriod(period)) {
    throw new Error(
      `Cannot overwrite actuals for ${period}. ` +
      `Approved plans exist. Contact Finance.`
    );
  }
  
  // Step 2: Delete existing actuals for period
  await deleteActuals({ period });
  
  // Step 3: Import new actuals
  await insertActuals(file.records);
  
  // Step 4: Recalculate baselines (if baseline depends on actuals)
  await recalculateBaselines(period);
}
```

**Guardrail:**
- Cannot overwrite actuals if **approved plans** reference that period
- Requires Finance override for corrections post-approval

---

**Scenario 2: Invoice Correction**

**Problem:** Invoice amount corrected after initial import (e.g., credit note issued)

**Phase 1 Decision: Adjustment (Audit Trail)**

```typescript
// Original invoice
{
  invoice_no: 'INV-001',
  amount: 10,000,
  status: 'POSTED'
}

// Correction (credit note)
{
  invoice_no: 'CN-INV-001', // Credit note
  original_invoice_no: 'INV-001',
  amount: -2,000, // Negative amount
  correction_reason: 'Pricing error',
  status: 'POSTED'
}

// Ledger impact
Original: +10,000 TL consumed
Correction: -2,000 TL consumed
Net: 8,000 TL consumed
```

**Why Adjustment (Not Overwrite):**
- Maintains audit trail (Finance requirement)
- Supports reconciliation (ERP invoice vs TPM ledger)
- Enables variance analysis (planned vs actual with corrections visible)

---

## 6.5 Data Ownership

**Data Ownership = Which system is the authoritative source of truth for each data type.**

| Data Type | Source of Truth | CollMind Role | Sync Pattern |
|-----------|----------------|---------------|--------------|
| **Customer Master** | ERP | Consumer (read-only) | API or daily file |
| **Product Master** | ERP | Consumer (read-only) | API or daily file |
| **Sales Actuals** | ERP / Sales System | Consumer (read-only) | Daily batch file |
| **Invoice Data** | ERP / Finance System | Consumer (read-only) | Daily batch file |
| **CPL (Customer Groups)** | **CollMind** | Owner (authoritative) | N/A (created in UI) |
| **FU (Forecasting Units)** | **CollMind** | Owner (authoritative) | N/A (created in UI) |
| **Tactics & Mechanics** | **CollMind** | Owner (authoritative) | N/A (configured in UI) |
| **Plans** | **CollMind** | Owner (authoritative) | N/A (created in Planning UI) |
| **Agreements** | **CollMind** | Owner (authoritative) | N/A (created in Actuals UI) |
| **Budget Allocations** | Finance System or CollMind | Hybrid (depends on org) | Manual entry or import |
| **Ledger Entries** | **CollMind** | Owner (authoritative) | N/A (generated from agreements/plans) |

**Key Principle:**
- **Master data:** ERP is source of truth (CollMind caches for performance)
- **Planning artifacts:** CollMind is source of truth (ERP may sync for reporting)
- **Actuals:** ERP is source of truth (CollMind imports for analysis)

### Data Governance Principle

**In case of discrepancies, the source-of-truth system always prevails; CollMind does not override enterprise financial records.** This is a non-negotiable rule for enterprise deployments:

**Examples:**
- If ERP shows Customer X has 10,000 TL invoice, but CollMind imported 9,500 TL → ERP is correct, CollMind data must be corrected
- If ERP shows SKU price = 95 TL, but CollMind cached 89 TL → ERP is correct, CollMind must refresh
- If CollMind shows Plan approved for 50K budget, but Finance system shows 45K allocated → Finance is correct, plan cannot proceed

**Why This Matters:**
- Legal compliance: Financial records must be traceable to authoritative sources
- Audit confidence: External auditors trust ERP, not TPM system
- Risk mitigation: CollMind bugs cannot corrupt enterprise financial data

**Implication:**
- CollMind is always in "read mode" for master/transactional data
- CollMind is in "write mode" only for its own domain (plans, agreements, ledger)

---

## 6.6 Data Refresh Frequencies

| Data Type | Frequency | Timing | Rationale |
|-----------|-----------|--------|-----------|
| **Customer/Product Master** | Daily | 02:00 AM | Catch new products, price changes |
| **Sales Actuals** | Daily | 03:00 AM | T+1 availability (yesterday's sales) |
| **Invoice Data** | Daily | 04:00 AM | T+1 availability |
| **Budget Allocations** | On-demand | Manual trigger | Infrequent changes (quarterly) |
| **CPL/FU Definitions** | Real-time | N/A | Created/edited in UI |
| **Plans/Agreements** | Real-time | N/A | Created/edited in UI |

**SLA:**
- Master data refresh: Complete by 06:00 AM (before business hours)
- Transactional data: Complete by 08:00 AM
- Failure notification: Immediate (email to Data Engineering)

---

## 6.7 Phase 1 Integration Scope

### ✅ Phase 1 Integration Capabilities

**Master Data:**
- ✅ Customer import (API or daily file)
- ✅ Product import (API or daily file)
- ✅ Manual CPL/FU/Tactic configuration (UI)

**Transactional Data:**
- ✅ Sales actuals import (daily batch file)
- ✅ Invoice import (daily batch file or manual batch upload)

**Reference Data:**
- ✅ Budget allocation (manual entry UI)
- ✅ Approval policy configuration (admin UI)

---

### ❌ Explicitly NOT in Phase 1

**Advanced Integration:**
- ❌ Real-time invoice posting (API push from ERP)
- ❌ Bi-directional sync (CollMind → ERP write-back)
- ❌ Automatic baseline calculation (requires data warehouse)
- ❌ Payment reconciliation (invoice vs payment matching)

**Data Quality:**
- ❌ Automated data cleansing (ML-based anomaly detection)
- ❌ Duplicate customer/product detection
- ❌ Fuzzy matching (approximate SKU name search)

**Integration Platforms:**
- ❌ Pre-built ERP connectors (SAP, Oracle, etc.)
- ❌ Integration with MDM platforms (Informatica, Talend)
- ❌ Event streaming (Kafka, Kinesis)

---

**END OF SECTION 6 - DATA & INTEGRATION MODEL**

---
-e 

═══════════════════════════════════════════════════════════════════════════════

SECTION 10: PHASED DELIVERY & ROADMAP
-e ═══════════════════════════════════════════════════════════════════════════════



---

# 10. PHASED DELIVERY & ROADMAP

## Introduction

This section defines **how CollMind will be built and delivered over time**. It establishes phase boundaries, gate criteria, and explicit out-of-scope protections to ensure predictable delivery and managed expectations.

**Scope:** This section covers phase definitions, feature allocation, delivery timelines, phase gate criteria, and explicit "will not build" declarations. It does NOT prescribe agile ceremonies, sprint planning, or specific project management methodologies — those are determined by the delivery team.

**Why This Matters:**
- **Project Management:** Needs clear milestones, dependencies, delivery dates
- **Sales/Commercial:** Needs to set customer expectations on feature availability
- **Finance:** Needs to budget implementation costs per phase
- **Product:** Needs to prioritize features, manage scope creep
- **Engineering:** Needs to plan technical architecture, sequencing

### Product Philosophy

**CollMind follows a "minimum viable product then iterate" strategy, not a "big bang" launch.** Phase 1 delivers core operational workflows (Actuals-First), Phase 2 activates strategic planning (Planning-First), and Phase 3+ adds optimization and intelligence. Each phase is production-ready and delivers standalone business value.

---

## 10.1 Phase Definitions

### Phase 1: Actuals-First MVP (13 Weeks)

**Objective:** Enable reactive trade spend management with speed, policy control, and financial discipline.

**Tagline:** "Capture execution, control budget, audit spend."

**Core Value Proposition:**
- Regional Managers can create agreements in <5 minutes (vs 30 minutes manual)
- Finance can track budget utilization in real-time (vs month-end reconciliation)
- Audit trail provides 100% traceability (vs Excel/email chaos)

**Included Capabilities:**

**Agreement Management (Actuals-First):**
- ✅ Create STA (Short-Term Agreement)
- ✅ Create LTA (Long-Term Agreement)
- ✅ CPL-based agreement creation
- ✅ Tactic selection with applicability rules
- ✅ Mechanic value entry (%, TL per unit, lumpsum)
- ✅ Cap-based budget validation
- ✅ Draft/Pending/Approved status lifecycle

**Approval Workflow:**
- ✅ Sequential approval (1-2 levels)
- ✅ Threshold-based routing (amount, channel)
- ✅ Email notifications (pending, approved, rejected)
- ✅ Approval comments
- ✅ Budget availability check (pre-approval)

**Off-Invoice Tracking:**
- ✅ Manual batch upload (Excel/CSV)
- ✅ File validation (schema, data types)
- ✅ Idempotency (duplicate detection)
- ✅ Agreement linking (transaction → agreement)
- ✅ Cap consumption tracking
- ✅ Cap breach alerts

**Budget Management:**
- ✅ Budget envelope creation (Channel × Category × Period)
- ✅ Budget allocation (manual entry)
- ✅ Budget reservation (agreement approval)
- ✅ Budget consumption (invoice posting)
- ✅ Utilization dashboard (RAG status)
- ✅ Alerts (80%, 95%, 100% thresholds)

**Master Data:**
- ✅ Customer import (API or file)
- ✅ Product import (API or file)
- ✅ CPL configuration (UI)
- ✅ Tactic configuration (Admin UI)
- ✅ Mechanic definition with formulas

**Reporting:**
- ✅ Trade Spend Summary
- ✅ Budget Utilization Report
- ✅ Agreement Status Report
- ✅ Export to Excel/PDF/CSV

**Security & Compliance:**
- ✅ 5 core roles (Planner, Approver, Finance, Admin, Read-Only)
- ✅ Capability-based permissions
- ✅ Audit logs (20 event types)
- ✅ Multi-tenant isolation (RLS)

**Integration:**
- ✅ Master data import (daily batch)
- ✅ Invoice import (daily batch via SFTP/manual upload)

---

**Explicitly NOT in Phase 1:**
- ❌ Planning-First Mode (deferred to Phase 2)
- ❌ KPI Calculation Engine (Planning-First dependency)
- ❌ Baseline data import (Planning-First dependency)
- ❌ ROI simulation (Planning-First feature)
- ❌ Parallel approvals
- ❌ SSO/SAML integration
- ❌ Real-time invoice posting (batch only)
- ❌ ERP write-back (read-only integration)

---

**Phase 1 Timeline:**

| Week | Milestone | Deliverables |
|------|-----------|--------------|
| **Week 1-2** | Setup & Architecture | Infrastructure provisioned, database schema, auth system |
| **Week 3-5** | Core Agreement Flows | Create STA/LTA, tactic selection, draft/submit |
| **Week 6-7** | Approval Workflow | Sequential approval, policy engine, notifications |
| **Week 8-9** | Off-Invoice Tracking | Batch upload, validation, agreement linking, cap tracking |
| **Week 10** | Budget Management | Envelope creation, reservation/consumption, alerts |
| **Week 11** | Reporting | 3 core reports, export functionality |
| **Week 12** | Integration & Testing | Master data import, invoice import, end-to-end testing |
| **Week 13** | UAT & Launch Prep | User acceptance testing, training materials, go-live |

**Phase 1 Success Criteria:**
- ✅ 10 agreements created and approved by pilot users
- ✅ 1 off-invoice batch imported successfully
- ✅ Budget utilization dashboard shows real-time data
- ✅ All 5 roles can perform their core workflows
- ✅ Response times meet NFR targets (<2s page load)

---

### Phase 1.1: Stabilization & Adoption (4 Weeks)

**Objective:** Monitor production usage, fix critical bugs, optimize performance, gather feedback.

**Tagline:** "Learn, stabilize, optimize."

**Activities:**
- Bug triage and fixes (daily releases)
- Performance optimization (slow query identification)
- User feedback collection (weekly surveys)
- Training sessions (regional teams)
- Documentation updates (user guides, FAQs)

**Success Criteria:**
- ✅ <5 critical bugs/week (down from initial spike)
- ✅ 90% user satisfaction score
- ✅ 50+ agreements created (proof of adoption)
- ✅ 99% uptime achieved

---

### Phase 2: Planning-First Activation (10 Weeks)

**Objective:** Enable strategic ROI-driven promotional planning with volume forecasting and profitability optimization.

**Tagline:** "Plan with intelligence, approve with confidence."

**Core Value Proposition:**
- Category Managers can simulate ROI before committing budget
- Finance can approve plans based on profitability metrics (GP ROI %)
- Plans achieve 10-15% higher ROI through what-if optimization

**Included Capabilities:**

**Planning Grid (Forward Planning):**
- ✅ Hierarchical FU/SKU grid
- ✅ Volume input (Base, Planned, Incremental, Uplift%)
- ✅ Tactic definition at FU level
- ✅ Real-time KPI calculation (<500ms)
- ✅ Grand Totals Panel (6 key metrics)
- ✅ Expand/collapse FU rows
- ✅ Auto-save (draft state)

**KPI Calculation Engine:**
- ✅ 40+ KPIs with formula-driven architecture
- ✅ Dependency graph resolution
- ✅ SKU → FU → Plan aggregation
- ✅ Edge case handling (zero baseline, new products)
- ✅ Admin-configurable formulas (database-stored)

**ROI Simulation:**
- ✅ What-if analysis (adjust inputs, see ROI instantly)
- ✅ RAG status evaluation (Green/Amber/Red)
- ✅ Optimization hints (inline suggestions)
- ✅ Undo/Redo stack (Ctrl+Z/Y)

**Baseline Data:**
- ✅ Baseline import (CSV/Excel)
- ✅ Baseline validation (SKU matching, coverage threshold)
- ✅ Historical volume storage (12 months)
- ✅ Baseline quality enforcement (≥95% coverage)

**Planning Approval:**
- ✅ ROI-based approval policies
- ✅ Multi-level sequential approvals
- ✅ Budget commitment (COMMIT transaction)
- ✅ Auto-reject conditions (ROI < threshold)

**Reporting (Planning-Specific):**
- ✅ Plan Performance Report
- ✅ Planner Performance Report
- ✅ ROI Distribution Dashboard

---

**Explicitly NOT in Phase 2:**
- ❌ Variance analysis (Plan vs Actual) — requires actuals linkage
- ❌ Bulk edit (multi-SKU select and edit)
- ❌ Copy/paste from Excel
- ❌ Custom KPI builder (UI-based)
- ❌ Scenario comparison (side-by-side plans)
- ❌ Multi-user real-time editing

---

**Phase 2 Timeline:**

| Week | Milestone | Deliverables |
|------|-----------|--------------|
| **Week 1-2** | Planning Grid Foundation | Hierarchical UI, column engine, data model |
| **Week 3-4** | KPI Engine Core | Formula parser, calculation cascade, aggregation |
| **Week 5-6** | Volume Planning & Tactics | SKU-level input, FU-level tactics, distribution logic |
| **Week 7** | ROI Simulation | What-if recalculation, RAG evaluation, undo/redo |
| **Week 8** | Baseline Integration | Import, validation, quality enforcement |
| **Week 9** | Planning Approval | ROI-driven policies, budget commitment |
| **Week 10** | Testing & Launch | UAT, performance testing (500ms target), go-live |

**Phase 2 Success Criteria:**
- ✅ 5 plans created with 10+ SKUs each
- ✅ KPI calculation <500ms (50 SKUs)
- ✅ ROI optimization: 10%+ improvement (draft → final)
- ✅ Baseline coverage ≥95% for all plans
- ✅ 70%+ plans achieve Green status (ROI ≥20%)

---

### Phase 3: Optimization & Integration (12 Weeks)

**Objective:** Advanced analytics, variance tracking, ERP integration, collaboration features.

**Tagline:** "Learn from execution, integrate with enterprise, collaborate at scale."

**Included Capabilities:**

**Variance Analysis:**
- ✅ Planned vs Actual volume comparison
- ✅ Planned vs Actual spend variance
- ✅ GP ROI variance (planned vs realized)
- ✅ Root cause analysis (volume shortfall, execution issues)
- ✅ Lessons learned reports

**ERP Integration (Advanced):**
- ✅ Real-time invoice posting (API push)
- ✅ Bi-directional sync (CollMind → ERP write-back)
- ✅ Automatic baseline calculation (nightly refresh from sales data)
- ✅ Payment reconciliation (invoice vs payment matching)

**Collaboration:**
- ✅ Multi-user real-time editing (planning grid)
- ✅ Comments on plans/agreements
- ✅ @mention notifications
- ✅ Version comparison (Plan v1 vs v2 diff)
- ✅ Approval workflow comments

**Advanced Budget:**
- ✅ Budget reallocation (move funds between envelopes)
- ✅ Budget forecasting (remaining period projection)
- ✅ Budget scenarios (what-if budget allocations)

**Bulk Operations:**
- ✅ Bulk edit (select multiple SKUs, apply changes)
- ✅ Copy/paste from Excel (into planning grid)
- ✅ Template plans (save/load plan templates)

**Advanced Reporting:**
- ✅ Custom report builder (drag-and-drop)
- ✅ Scheduled email delivery
- ✅ Shared dashboards with real-time updates

---

**Phase 3 Timeline:** 12 weeks

**Phase 3 Success Criteria:**
- ✅ Variance analysis for 10+ closed plans
- ✅ ERP integration live (real-time invoice posting)
- ✅ 3+ users collaborating on single plan simultaneously
- ✅ Custom reports created by Finance team

---

### Phase 4+: AI & Advanced Optimization (Future)

**Objective:** AI-driven insights, predictive analytics, autonomous optimization.

**Capabilities (Vision):**

**AI-Driven Volume Recommendations:**
- ML model predicts optimal planned volumes based on historical uplift
- Recommends tactic mix to maximize ROI

**Automatic Optimization:**
- "Optimize this plan" button: System adjusts volumes/tactics to maximize GP ROI
- Constraint-based optimization (minimum volume, maximum spend, ROI threshold)

**Predictive Analytics:**
- Promotion success prediction (likelihood of achieving Green status)
- Budget overrun early warning (predictive, not reactive)
- Competitive response prediction (market intelligence integration)

**Portfolio Optimization:**
- Optimize across multiple plans simultaneously
- Trade-off analysis (prioritize high-ROI plans, defer low-ROI)

**Advanced Collaboration:**
- AI-powered approval routing (learns from past decisions)
- Natural language queries ("Show me all NKA plans with ROI <15%")

---

## 10.2 Phase Gate Criteria

**Phase Gate = A decision point where the organization decides whether to proceed to the next phase.**

### Gate 1: Phase 1 → Phase 1.1 (Stabilization)

**Criteria:**
- ✅ All Phase 1 features deployed to production
- ✅ UAT sign-off by pilot users (3+ users)
- ✅ 10+ agreements created in production
- ✅ No critical/blocking bugs
- ✅ Performance targets met (response time <2s)

**Decision Makers:** Product Owner, Engineering Lead, Pilot Customer

**Outcome:** Proceed to stabilization OR defer if critical issues

---

### Gate 2: Phase 1.1 → Phase 2 (Planning Activation)

**Criteria:**
- ✅ Bug rate stabilized (<5 critical bugs/week)
- ✅ User satisfaction ≥80%
- ✅ 50+ agreements created (proof of adoption)
- ✅ Baseline data available (≥95% SKU coverage)
- ✅ Uptime ≥99% over 4-week period

**Decision Makers:** Product Owner, Engineering Lead, Finance Sponsor

**Outcome:** Proceed to Phase 2 OR extend stabilization if adoption low

**Risk Mitigation:**
- If baseline data unavailable: Defer Phase 2 until data ready
- If adoption <50 agreements: Extend training, identify blockers

---

### Gate 3: Phase 2 → Phase 3 (Optimization)

**Criteria:**
- ✅ 20+ plans created in Planning-First Mode
- ✅ KPI calculation performance met (<500ms)
- ✅ 70%+ plans achieve Green status (ROI ≥20%)
- ✅ User feedback: Planning grid usability ≥80% satisfaction
- ✅ ERP integration requirements finalized (API endpoints ready)

**Decision Makers:** Product Owner, Engineering Lead, Category Manager Sponsor

**Outcome:** Proceed to Phase 3 OR iterate on Phase 2 if ROI targets not met

---

## 10.3 Delivery Risks & Mitigation

### Risk 1: Baseline Data Unavailable (Blocks Phase 2)

**Impact:** Cannot activate Planning-First without historical volume data

**Probability:** Medium (30%)

**Mitigation:**
- Start baseline data collection in Phase 1 (parallel workstream)
- Use sales data warehouse as source (not ERP)
- Accept lower coverage (80% instead of 95%) for pilot

**Contingency:** Defer Phase 2 by 4-8 weeks, extend Phase 1 adoption

---

### Risk 2: KPI Calculation Performance (<500ms Target)

**Impact:** Planning grid becomes unusable if recalculation takes >2s

**Probability:** Medium (40%)

**Mitigation:**
- Prototype KPI engine in Phase 1 (proof of concept)
- Pre-compute KPIs where possible (materialized views)
- Limit SKU count per plan (soft limit: 100 SKUs)

**Contingency:** Reduce KPI count in UI (show only 10 KPIs instead of 40)

---

### Risk 3: User Adoption Low (Phase 1)

**Impact:** Pilot fails, business case weakens, funding at risk

**Probability:** Low (20%)

**Mitigation:**
- Intensive training (hands-on workshops, not just documentation)
- Co-create with pilot users (weekly feedback sessions)
- Incentivize usage (recognize early adopters)

**Contingency:** Extend Phase 1.1, add features based on user feedback

---

### Risk 4: ERP Integration Delays (Phase 3)

**Impact:** Cannot achieve real-time invoice posting, variance analysis delayed

**Probability:** High (60%)

**Mitigation:**
- Parallel workstream: ERP team prepares API endpoints during Phase 2
- Fallback: Continue batch integration (daily SFTP)
- API mocking: Test CollMind integration before ERP ready

**Contingency:** Defer ERP integration to Phase 4, deliver other Phase 3 features

---

## 10.4 Out-of-Scope Protection (Explicit "Will Not Build")

**Purpose:** Prevent scope creep by declaring features that CollMind will NEVER build (or at minimum, not in 2-3 year roadmap).

### ❌ Financial System Features

**Will NOT Build:**
- General Ledger (GL) functionality
- Accounts Payable (AP) processing
- Accounts Receivable (AR) management
- Full ERP replacement

**Rationale:** CollMind is a promotional planning/execution system, not an ERP. Financial systems are complex, regulated, and commodity. Integrate, don't replicate.

---

### ❌ Supply Chain Features

**Will NOT Build:**
- Demand forecasting (beyond promotional volume)
- Inventory management
- Production planning
- Logistics/distribution planning

**Rationale:** Supply chain is a separate domain. Volume forecasts from CollMind can feed supply chain systems, but CollMind is not a demand planning tool.

---

### ❌ CRM Features

**Will NOT Build:**
- Customer relationship management
- Sales pipeline tracking
- Opportunity management
- Contact management

**Rationale:** CRM systems handle customer relationships; CollMind handles promotional spend. Customer data imported from CRM, not managed in CollMind.

---

### ❌ BI/Data Warehouse Features

**Will NOT Build:**
- Free-form SQL query builder
- Data lake / data warehouse
- Advanced data transformation (ETL)
- ML model training platform

**Rationale:** CollMind provides curated reports. For advanced analytics, export to dedicated BI tools (Power BI, Tableau).

---

### ❌ Campaign Execution Features

**Will NOT Build:**
- Marketing automation (email campaigns, SMS)
- Digital advertising management
- Social media planning
- Content management system (CMS)

**Rationale:** CollMind plans promotions (budgets, tactics, ROI). Campaign execution (creative, messaging, media) happens in marketing automation tools.

---

## 10.5 Resource Planning

### Phase 1 Team (13 Weeks)

| Role | FTE | Duration | Responsibilities |
|------|-----|----------|------------------|
| **Product Owner** | 1.0 | 13 weeks | Backlog prioritization, UAT coordination |
| **Engineering Lead** | 1.0 | 13 weeks | Architecture, code review, performance |
| **Backend Engineers** | 3.0 | 13 weeks | API, database, business logic |
| **Frontend Engineers** | 2.0 | 13 weeks | React UI, planning grid |
| **QA Engineer** | 1.0 | 13 weeks | Test automation, UAT support |
| **DevOps Engineer** | 0.5 | 13 weeks | Infrastructure, CI/CD, monitoring |
| **UX Designer** | 0.5 | Weeks 1-6 | Wireframes, prototypes, design system |
| **Data Engineer** | 0.5 | Weeks 8-13 | Integration, data import scripts |

**Total:** 9.5 FTE-equivalents

---

### Phase 2 Team (10 Weeks)

| Role | FTE | Duration | Responsibilities |
|------|-----|----------|------------------|
| **Product Owner** | 1.0 | 10 weeks | Planning-First feature specs |
| **Engineering Lead** | 1.0 | 10 weeks | KPI engine architecture |
| **Backend Engineers** | 3.0 | 10 weeks | KPI engine, formula parser, aggregation |
| **Frontend Engineers** | 2.5 | 10 weeks | Planning grid (complex UI) |
| **QA Engineer** | 1.0 | 10 weeks | KPI validation testing |
| **DevOps Engineer** | 0.5 | 10 weeks | Performance optimization |
| **Data Engineer** | 1.0 | 10 weeks | Baseline import, validation |

**Total:** 10.0 FTE-equivalents

---

## 10.6 Success Metrics (18-Month View)

**Phase 1 Success (Month 3):**
- ✅ 100+ agreements created
- ✅ 1M+ TL spend tracked
- ✅ 10+ budget envelopes managed
- ✅ 99%+ uptime

**Phase 2 Success (Month 7):**
- ✅ 50+ plans created
- ✅ Average GP ROI: 22%+ (target: 20%+)
- ✅ 70%+ plans achieve Green status
- ✅ 15%+ ROI improvement (draft → final via optimization)

**Phase 3 Success (Month 12):**
- ✅ 100+ variance analyses completed
- ✅ Real-time ERP integration live
- ✅ 5+ users collaborating on plans simultaneously
- ✅ 20+ custom reports created by users

**18-Month Business Impact:**
- ✅ 20% reduction in trade spend (better ROI, eliminate unprofitable promotions)
- ✅ 50% reduction in planning time (2 weeks → 1 week for JBPs)
- ✅ 100% budget compliance (no overruns, proactive alerts)
- ✅ 90%+ user satisfaction

---

**END OF SECTION 10 - PHASED DELIVERY & ROADMAP**

---
-e 

═══════════════════════════════════════════════════════════════════════════════

SECTION 11: ASSUMPTIONS, DEPENDENCIES & RISKS
-e ═══════════════════════════════════════════════════════════════════════════════



---

# 11. ASSUMPTIONS, DEPENDENCIES & RISKS

## Introduction

This section documents **the conditions under which CollMind will succeed** and the factors that could cause failure. It establishes organizational, technical, and data assumptions; identifies external dependencies; and catalogs risks with mitigation strategies.

**Scope:** This section covers assumptions (what we believe to be true), dependencies (what we require from others), and risks (what could go wrong). It does NOT propose solutions to all risks — some are accepted, others require organizational commitment.

**Why This Matters:**
- **Management:** Needs to understand what the organization must provide (data, resources, commitment)
- **IT:** Needs to identify technical dependencies (ERP APIs, infrastructure)
- **Legal/Finance:** Needs to assess compliance and audit risks
- **Product:** Needs to prioritize risk mitigation in roadmap

### Product Philosophy

**CollMind's success depends more on organizational readiness than technical capability.** The hardest challenges are not engineering problems (KPI formulas, UI grids) but change management problems (user adoption, data quality, process redesign).

---

## 11.1 Assumptions

**Assumption = A condition we believe to be true but have not yet verified.**

### Organizational Assumptions

**A1: Executive Sponsorship**
- **Assumption:** C-level sponsor (CFO, CSO, CMO) actively champions TPM initiative
- **Why Critical:** TPM implementation requires budget approval, policy changes, cross-functional coordination
- **Risk if False:** Project stalls in bureaucracy, users resist change, budget reallocated
- **Validation:** Confirm executive sponsor in kickoff meeting, weekly sponsor check-ins

---

**A2: User Availability for Training**
- **Assumption:** Pilot users (planners, approvers) can dedicate 8+ hours to training over 2 weeks
- **Why Critical:** CollMind introduces new workflows; without training, adoption fails
- **Risk if False:** Users create incorrect agreements/plans, bypass system, revert to Excel
- **Validation:** Block calendar for pilot group during Phase 1 Week 13 (UAT)

---

**A3: Process Redesign Willingness**
- **Assumption:** Organization willing to change existing promotional processes to align with CollMind workflows
- **Why Critical:** CollMind is not Excel; some manual processes won't translate directly
- **Risk if False:** Users demand features that replicate broken processes, scope creep
- **Validation:** Process mapping workshop in pre-project phase, sign-off on "As-Is vs To-Be"

---

**A4: Data Governance Maturity**
- **Assumption:** Organization has (or will establish) data quality standards, data ownership, and correction procedures
- **Why Critical:** Garbage in = garbage out; poor master data quality breaks KPI calculations
- **Risk if False:** Plans show incorrect ROI, budgets misallocated, user trust erodes
- **Validation:** Data quality assessment before Phase 2 (baseline data readiness)

---

### Technical Assumptions

**A5: ERP API Availability**
- **Assumption:** ERP system exposes REST APIs for customer, product, and invoice data (or can export to SFTP daily)
- **Why Critical:** CollMind cannot function without master/transactional data
- **Risk if False:** Manual data entry becomes bottleneck, data staleness >7 days
- **Validation:** API documentation review, test credentials provided in Phase 1 Week 1

---

**A6: Network Connectivity**
- **Assumption:** Users have reliable internet (5 Mbps+, <200ms latency to cloud)
- **Why Critical:** CollMind is cloud-based SaaS; poor connectivity = unusable system
- **Risk if False:** Users complain about slow load times, blame system not network
- **Validation:** Network speed tests during pilot site selection

---

**A7: Browser Compliance**
- **Assumption:** Users' machines have modern browsers (Chrome, Edge, Firefox latest 2 versions)
- **Why Critical:** Planning grid requires modern JavaScript, CSS Grid
- **Risk if False:** UI broken on old browsers (IE11), support burden increases
- **Validation:** Browser audit during pilot prep, mandate browser upgrades if needed

---

**A8: Cloud Infrastructure Availability**
- **Assumption:** Cloud provider (AWS/Azure/GCP) maintains 99.9%+ uptime
- **Why Critical:** CollMind availability depends on cloud infrastructure
- **Risk if False:** Regional outages cause CollMind downtime
- **Validation:** Multi-region deployment (Phase 2+), SLA monitoring

---

### Data Assumptions

**A9: Baseline Data Exists**
- **Assumption:** Historical sales volumes available at Customer × SKU × Week granularity for past 12 months
- **Why Critical:** Planning-First Mode cannot function without baseline (see Section 5)
- **Risk if False:** Phase 2 delayed or Planning-First scope reduced to limited SKUs
- **Validation:** Data availability assessment in Phase 1, parallel data extraction workstream

---

**A10: Master Data Quality**
- **Assumption:** Customer and Product master data is 95%+ accurate (no duplicate IDs, correct attributes)
- **Why Critical:** Inaccurate master data causes agreement creation errors, reporting mismatches
- **Risk if False:** Users lose trust, manual corrections required, data team overwhelmed
- **Validation:** Data quality report before Phase 1 launch, cleansing if needed

---

**A11: Invoice Data Availability**
- **Assumption:** Off-invoice data (credit notes, rebates) can be extracted from ERP or provided by Finance
- **Why Critical:** Actuals-First Mode tracks off-invoice spend; without it, budget tracking incomplete
- **Risk if False:** Spend undercounted, budget appears underutilized (false signal)
- **Validation:** Invoice data sample extraction in Phase 1 Week 1

---

**A12: COGS Data Accuracy**
- **Assumption:** Cost of Goods Sold (COGS) per SKU is accurate and refreshed monthly
- **Why Critical:** GP ROI calculation depends on COGS; inaccurate COGS = wrong ROI
- **Risk if False:** Plans approved based on incorrect profitability, Finance loses confidence
- **Validation:** COGS data review by Finance before Phase 2

---

## 11.2 Dependencies

**Dependency = A condition that must be satisfied by external parties for CollMind to succeed.**

### External System Dependencies

**D1: ERP System Availability**
- **Owner:** IT Infrastructure / ERP Team
- **Requirement:** ERP APIs available 99%+ uptime during business hours (8 AM - 8 PM)
- **Impact if Not Met:** Master data stale, invoice imports fail, CollMind shows outdated data
- **Mitigation:** Cached data (tolerate 24-hour staleness), manual fallback

---

**D2: ERP API Performance**
- **Owner:** IT Infrastructure / ERP Team
- **Requirement:** API response time <2s (P95) for customer/product lookups
- **Impact if Not Met:** CollMind agreement creation slows down, user frustration
- **Mitigation:** Pre-cache master data in CollMind database (nightly refresh)

---

**D3: SFTP Server Provisioning**
- **Owner:** IT Infrastructure
- **Requirement:** SFTP server provisioned for file-based integration (baseline, invoices)
- **Timeline:** Before Phase 1 Week 8
- **Impact if Not Met:** Batch imports blocked, manual upload only
- **Mitigation:** Use cloud storage (S3) as interim solution

---

### Organizational Dependencies

**D4: Budget Allocation Data**
- **Owner:** Finance Team
- **Requirement:** Budget envelopes defined and loaded into CollMind before Phase 1 launch
- **Timeline:** Phase 1 Week 10
- **Impact if Not Met:** Budget validation cannot occur, agreements approved without checks
- **Mitigation:** Start with simplified budget structure (Channel × Category only)

---

**D5: Approval Policy Definition**
- **Owner:** Finance / Sales Leadership
- **Requirement:** Approval policies defined (thresholds, routing rules) before Phase 1 launch
- **Timeline:** Phase 1 Week 6
- **Impact if Not Met:** All approvals default to manual routing, workflow inefficiency
- **Mitigation:** Start with simple 2-level sequential approval for all

---

**D6: User Provisioning**
- **Owner:** IT / HR
- **Requirement:** User accounts created with correct roles/permissions before UAT
- **Timeline:** Phase 1 Week 12
- **Impact if Not Met:** UAT delayed, users locked out
- **Mitigation:** Self-service registration with admin approval

---

**D7: Training Content Approval**
- **Owner:** Sales / Trade Marketing Leadership
- **Requirement:** Training materials reviewed and approved before rollout
- **Timeline:** Phase 1 Week 12
- **Impact if Not Met:** Training content misaligned with business processes
- **Mitigation:** Iterative review (draft → feedback → final)

---

### Data Dependencies

**D8: Baseline Data Extraction**
- **Owner:** Data Engineering / BI Team
- **Requirement:** Historical sales data extracted, formatted, and loaded into CollMind
- **Timeline:** Before Phase 2 Week 1
- **Impact if Not Met:** Phase 2 (Planning-First) delayed
- **Mitigation:** Start extraction in Phase 1 (parallel workstream)

---

**D9: Customer-CPL Mapping**
- **Owner:** Sales Operations
- **Requirement:** Customers assigned to CPLs (customer planning levels)
- **Timeline:** Phase 1 Week 4
- **Impact if Not Met:** Agreement creation requires manual CPL selection (slow)
- **Mitigation:** Admin tool for bulk CPL assignment

---

**D10: Tactic Applicability Rules**
- **Owner:** Trade Marketing / Finance
- **Requirement:** Tactics defined with channel/category applicability rules
- **Timeline:** Phase 1 Week 3
- **Impact if Not Met:** Users see irrelevant tactics, create incorrect agreements
- **Mitigation:** Start with "all tactics available to all channels" (permissive)

---

## 11.3 Risks

**Risk = A potential future event that could negatively impact the project.**

### High-Priority Risks (P1)

**R1: Low User Adoption**
- **Impact:** High (project failure)
- **Probability:** Medium (30%)
- **Description:** Users resist new system, continue using Excel/email
- **Root Causes:** 
  - Insufficient training
  - System perceived as slow or complex
  - Users don't see value (ROI not evident)
- **Mitigation:**
  - Intensive hands-on training (not just documentation)
  - Co-creation with pilot users (weekly feedback)
  - Quick wins: Show time savings, budget visibility
  - Executive mandate: "No Excel, use CollMind"
- **Contingency:** If adoption <30% after 3 months, pause rollout, conduct user interviews, redesign workflows

---

**R2: Data Quality Issues**
- **Impact:** High (incorrect decisions, user distrust)
- **Probability:** High (60%)
- **Description:** Master data (customers, products, COGS) contains errors, duplicates, stale values
- **Root Causes:**
  - ERP data quality historically poor
  - No data governance process
  - Manual data entry errors
- **Mitigation:**
  - Pre-launch data cleansing (Phase 1 Week 1-2)
  - Data quality dashboard (admins can see error rates)
  - Validation rules (prevent invalid data entry)
  - Quarterly data audits
- **Contingency:** If error rate >10%, pause new user onboarding, focus on data cleanup

---

**R3: Baseline Data Unavailable (Blocks Phase 2)**
- **Impact:** High (Phase 2 delayed)
- **Probability:** Medium (40%)
- **Description:** Historical sales data not extractable from ERP/data warehouse
- **Root Causes:**
  - Data warehouse doesn't exist
  - Historical data deleted or archived
  - Data format incompatible
- **Mitigation:**
  - Start data extraction in Phase 1 (parallel)
  - Accept lower granularity (monthly instead of weekly)
  - Accept lower coverage (80% instead of 95% SKUs)
- **Contingency:** Defer Phase 2 by 2-3 months, extend Phase 1 adoption, manually reconstruct baseline for top SKUs

---

**R4: Performance Degradation (KPI Calculation)**
- **Impact:** High (Planning-First unusable)
- **Probability:** Medium (30%)
- **Description:** KPI calculation takes >2s for 50 SKUs, planning grid becomes sluggish
- **Root Causes:**
  - Complex formulas (nested dependencies)
  - Database query inefficiency
  - Frontend rendering bottleneck
- **Mitigation:**
  - Performance testing in Phase 2 Week 1 (prototype)
  - Database indexing, query optimization
  - Client-side caching (memoization)
  - Limit SKU count per plan (soft cap: 100 SKUs)
- **Contingency:** Reduce UI KPI count (show 10 instead of 40), async calculation (progress bar)

---

### Medium-Priority Risks (P2)

**R5: ERP Integration Delays**
- **Impact:** Medium (manual workarounds needed)
- **Probability:** High (70%)
- **Description:** ERP API endpoints not ready on time, or API performance poor
- **Root Causes:**
  - ERP team backlog
  - API design changes
  - Security approval delays
- **Mitigation:**
  - Start API discussions in pre-project phase
  - Fallback: File-based integration (SFTP)
  - Mock APIs for CollMind development
- **Contingency:** Continue with file-based integration, defer real-time API to Phase 3

---

**R6: Scope Creep**
- **Impact:** Medium (timeline slip, cost overrun)
- **Probability:** High (80%)
- **Description:** Users request features not in Phase 1/2 scope, project expands
- **Root Causes:**
  - Unclear scope (BRD ambiguity)
  - Users discover needs during UAT
  - Sales overpromises features
- **Mitigation:**
  - Strict scope lock: No new features mid-phase
  - Change request process (requires sponsor approval)
  - Explicit "Out of Scope" section (see Section 10.4)
- **Contingency:** If scope increases >20%, negotiate timeline extension or defer features to Phase 3

---

**R7: Key Personnel Turnover**
- **Impact:** Medium (knowledge loss, delays)
- **Probability:** Low (20%)
- **Description:** Product Owner, Engineering Lead, or pilot users leave during project
- **Root Causes:**
  - Job changes, company restructuring
- **Mitigation:**
  - Knowledge documentation (design docs, runbooks)
  - Pair programming, code reviews (knowledge sharing)
  - Shadowing (backup personnel)
- **Contingency:** Hire replacement ASAP, onboard with 2-week overlap

---

**R8: Budget Overrun**
- **Impact:** Medium (project pause or scope reduction)
- **Probability:** Medium (40%)
- **Description:** Implementation costs exceed budget due to scope changes, integration complexity
- **Root Causes:**
  - Underestimated effort (ERP integration, data cleansing)
  - Resource cost increases (contractor rates)
- **Mitigation:**
  - 20% contingency buffer in budget
  - Monthly cost tracking (burn rate)
  - Prioritize Phase 1 features (defer Phase 2 if needed)
- **Contingency:** Negotiate additional funding or reduce Phase 2 scope

---

### Low-Priority Risks (P3)

**R9: Cloud Provider Outage**
- **Impact:** Low (temporary unavailability)
- **Probability:** Low (10%)
- **Description:** AWS/Azure/GCP regional outage causes CollMind downtime
- **Mitigation:** Multi-region deployment (Phase 2+), SLA monitoring
- **Contingency:** Users informed via status page, work resumes when cloud recovers

---

**R10: Security Breach**
- **Impact:** High (data loss, compliance violation, reputation damage)
- **Probability:** Very Low (5%)
- **Description:** Unauthorized access to CollMind, data exfiltration
- **Mitigation:** 
  - Encryption at rest and in transit
  - Penetration testing (annual)
  - Security training for dev team
  - MFA (Phase 2)
- **Contingency:** Incident response plan (isolate, investigate, notify), cyber insurance

---

## 11.4 Change Management Risks

**R11: Organizational Resistance**
- **Impact:** High (project failure despite technical success)
- **Probability:** Medium (50%)
- **Description:** Managers resist new approval workflows, Finance resists budget transparency
- **Root Causes:**
  - Loss of control (Excel flexibility → system constraints)
  - Visibility anxiety (spend transparency exposes inefficiencies)
  - "Not invented here" syndrome
- **Mitigation:**
  - Executive sponsorship (mandate adoption)
  - Change champions (identify early adopters, reward them)
  - Phased rollout (pilot → expand, not big bang)
  - Show value early (time savings, budget alerts)
- **Contingency:** If resistance high, slow rollout, conduct change workshops, address concerns 1-on-1

---

**R12: Process Redesign Conflict**
- **Impact:** Medium (delays, user dissatisfaction)
- **Probability:** Medium (40%)
- **Description:** Users demand CollMind replicate existing (inefficient) processes exactly
- **Root Causes:**
  - Comfort with status quo
  - Fear of change
- **Mitigation:**
  - Pre-project process mapping (As-Is → To-Be)
  - Explain rationale for changes (why new process is better)
  - Compromise where possible (configure, don't customize)
- **Contingency:** Escalate to executive sponsor for decision (change process or defer)

---

## 11.5 Risk Summary Matrix

| Risk | Impact | Probability | Priority | Mitigation Status |
|------|--------|-------------|----------|------------------|
| **R1: Low User Adoption** | High | Medium | P1 | Training plan, co-creation |
| **R2: Data Quality Issues** | High | High | P1 | Pre-launch cleansing, audits |
| **R3: Baseline Data Unavailable** | High | Medium | P1 | Parallel extraction workstream |
| **R4: Performance Degradation** | High | Medium | P1 | Performance testing, optimization |
| **R5: ERP Integration Delays** | Medium | High | P2 | Fallback to file-based |
| **R6: Scope Creep** | Medium | High | P2 | Change request process |
| **R7: Key Personnel Turnover** | Medium | Low | P2 | Knowledge documentation |
| **R8: Budget Overrun** | Medium | Medium | P2 | 20% contingency, monthly tracking |
| **R9: Cloud Provider Outage** | Low | Low | P3 | Multi-region (Phase 2+) |
| **R10: Security Breach** | High | Very Low | P3 | Encryption, pen testing |
| **R11: Organizational Resistance** | High | Medium | P1 | Change management plan |
| **R12: Process Redesign Conflict** | Medium | Medium | P2 | Process workshops, exec sponsor |

---

## 11.6 Critical Success Factors

**CollMind will succeed if:**
- ✅ Executive sponsor actively engaged (weekly check-ins)
- ✅ Pilot users committed (8+ hours training, daily usage)
- ✅ Data quality acceptable (95%+ accuracy)
- ✅ Baseline data available (Phase 2 dependency)
- ✅ ERP integration functional (API or file)
- ✅ Performance targets met (<500ms KPI calculation)
- ✅ Change management executed (training, communication, incentives)

**CollMind will fail if:**
- ❌ Users continue using Excel (adoption <30%)
- ❌ Data quality poor (error rate >10%)
- ❌ Baseline data unavailable (Phase 2 blocked indefinitely)
- ❌ Organizational resistance high (managers actively sabotage)
- ❌ Budget cut mid-project (Phase 2 defunded)

---

**END OF SECTION 11 - ASSUMPTIONS, DEPENDENCIES & RISKS**

---

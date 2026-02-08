# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 2

---

# 2. PRODUCT OVERVIEW

## 2.1 Platform Architecture

### 2.1.1 Dual-Mode Philosophy

CollMind TPM Platform is architected on a fundamental principle: **one platform, two operational paradigms**. This dual-mode approach recognizes that trade promotion management is not a monolithic process but rather encompasses two distinct operational patterns, each optimized for different business contexts.

**Core Architectural Principle:**
```
Single Platform Foundation
    ↓
Shared Core Components (Master Data, Budget, Approval, Ledger)
    ↓
Two Operational Modes (Actuals-First, Planning-First)
    ↓
Mode-Independent Reporting & Analytics
```

**Why Dual-Mode Matters:**

Traditional TPM systems force organizations to choose between two fundamentally incompatible paradigms:

| Planning-Centric Systems | Execution-Centric Systems | CollMind Dual-Mode |
|-------------------------|---------------------------|-------------------|
| Designed for forward planning | Designed for tracking actuals | **Supports both equally** |
| Requires baseline, forecasts | No planning capability | **Mode determines workflow** |
| Too slow for reactive markets | No ROI optimization | **Best of both worlds** |
| NKA-friendly, Traditional-hostile | Traditional-friendly, NKA-limited | **Channel-agnostic** |
| ❌ **Forces all channels into planning** | ❌ **Forces all channels into reactive mode** | ✅ **Match mode to business need** |

**Result:** Most organizations either:
1. Implement planning system → Traditional trade bypasses it
2. Implement actuals system → Strategic planning remains in Excel
3. Run two separate systems → Data chaos, no unified view

**CollMind Solution:** One platform, two modes, unified data.

**Product Scope Principle:**  
The platform does not attempt to standardize trade processes across all organizations, but instead provides a governed framework within which different execution and planning behaviors can coexist. This approach enables organizational flexibility while maintaining financial control and audit integrity.

---

### 2.1.2 Shared Core Components

The platform's power comes from its **mode-agnostic core** — a set of shared components that serve both operational modes equally, ensuring data consistency, governance uniformity, and reporting accuracy.

```
┌─────────────────────────────────────────────────────────────┐
│              COLLMIND TPM PLATFORM ARCHITECTURE             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │           SHARED CORE (Mode-Agnostic Layer)           │ │
│  ├───────────────────────────────────────────────────────┤ │
│  │                                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │ │
│  │  │ Master Data  │  │     RBAC     │  │   Budget   │ │ │
│  │  │ Management   │  │  Permissions │  │ Management │ │ │
│  │  └──────────────┘  └──────────────┘  └────────────┘ │ │
│  │                                                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │ │
│  │  │  Approval    │  │    Tactic    │  │   Ledger   │ │ │
│  │  │   Engine     │  │   Library    │  │  & Spend   │ │ │
│  │  └──────────────┘  └──────────────┘  └────────────┘ │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                              │                              │
│              ┌───────────────┴───────────────┐              │
│              ↓                               ↓              │
│  ┌──────────────────────────┐  ┌──────────────────────────┐│
│  │   ACTUALS-FIRST MODE     │  │   PLANNING-FIRST MODE    ││
│  ├──────────────────────────┤  ├──────────────────────────┤│
│  │                          │  │                          ││
│  │ • Agreement Management   │  │ • Forward Planning       ││
│  │   (STA/LTA)              │  │   Grid                   ││
│  │                          │  │                          ││
│  │ • Off-Invoice Batch      │  │ • Volume Planning        ││
│  │   Import & Staging       │  │   (Base/Incremental)     ││
│  │                          │  │                          ││
│  │ • Real-Time Spend        │  │ • KPI Calculation        ││
│  │   Tracking               │  │   Engine                 ││
│  │                          │  │                          ││
│  │ • Actuals-Specific KPIs  │  │ • ROI Simulation         ││
│  │   (Discount%, Coverage)  │  │   & RAG Status           ││
│  │                          │  │                          ││
│  │ • Rapid Approval         │  │ • What-If Scenarios      ││
│  │   Workflow               │  │                          ││
│  │                          │  │ • Plan-Based Approval    ││
│  └──────────────────────────┘  └──────────────────────────┘│
│              │                               │              │
│              └───────────────┬───────────────┘              │
│                              ↓                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │        UNIFIED REPORTING & ANALYTICS LAYER            │ │
│  ├───────────────────────────────────────────────────────┤ │
│  │ • Finance Dashboard (Actuals + Planning Spend)        │ │
│  │ • Budget Utilization (Real-Time, Unified)             │ │
│  │ • Approval Pipeline (Both Modes)                      │ │
│  │ • Audit Trail (Complete, Mode-Attributed)             │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Shared Core Components (Detail)

**1. Master Data Management**
- **Purpose:** Single source of truth for all reference data
- **Entities:** SKU hierarchy (GU→FU→SKU), Customer hierarchy (CPL→Customer→Outlet), Channels, Regions, Categories, UOM
- **Why Shared:** Both modes reference the same products, customers, and organizational dimensions
- **Extensibility:** Extensible via configuration, not custom development
- **Benefit:** No reconciliation between modes; one SKU code, one customer ID, everywhere

**2. User Management & RBAC (Role-Based Access Control)**
- **Purpose:** Consistent authentication, authorization, and access control
- **Roles:** Admin, Planner, Approver, Finance (mode-agnostic)
- **Permissions:** Capability-based (e.g., `can_create_agreement`, `can_create_plan`, `can_approve`)
- **Why Shared:** Users work across modes; one identity, one permission set
- **Benefit:** No separate user management per mode; unified audit trail

**3. Budget Management**
- **Purpose:** Near real-time budget allocation, reservation, and consumption tracking with reconciliation-grade visibility
- **Structure:** Channel → Category → Period (Year/Quarter/Month)
- **Control Principle:** Budget control operates independently of planning assumptions and applies equally to planned commitments and actualized agreements
- **Why Shared:** Budget is organizational constraint, not mode-specific
- **Benefit:** Both modes draw from and report to the same budget pool; no double-counting, no gaps

**4. Approval Engine**
- **Purpose:** Policy-driven, multi-level approval workflows
- **Mechanism:** JSON-configurable approval policies with role-based steps
- **Why Shared:** Governance principles apply regardless of mode
- **Benefit:** Consistent approval experience; Finance Manager approves both agreements and plans with same interface

**5. Tactic Library & Policies**
- **Purpose:** Centralized promotion tactic definitions with mode-specific rules
- **Structure:** Shared tactic catalog + mode-specific policy configurations
- **Why Shared:** A "Display Allowance" is conceptually the same tactic in both modes, but validation rules may differ
- **Benefit:** Consistent terminology; mode-specific enforcement (e.g., Actuals requires invoice, Planning requires baseline)

**6. Ledger & Spend Tracking**
- **Purpose:** Unified transaction log for all promotional spend
- **Mechanism:** Single `ledger_entries` table with `source_type` (AGREEMENT | PLAN)
- **Scope Clarity:** Ledger entries are not accounting postings but audit-grade promotional spend records
- **Why Shared:** Finance needs one view of total spend, not two separate logs
- **Benefit:** Single source of truth for reporting, reconciliation, audit

---

### 2.1.3 Mode-Specific Features

While the core is shared, each mode provides distinct capabilities optimized for its operational context.

#### Actuals-First Mode (Unique Features)

**Scope Note:** Agreements capture commercial intent and financial commitment, not operational execution such as order fulfillment or logistics.

| Feature | Description | Why Mode-Specific |
|---------|-------------|-------------------|
| **Agreement Management (STA/LTA)** | Create short-term (≤30 days) or long-term (>30 days) commercial agreements | Agreements represent *commercial terms*, not forecasts |
| **Off-Invoice Batch Import** | Upload 40-50+ invoices via CSV/Excel with validation, staging, and approval | High-volume transactional processing not needed in Planning |
| **Idempotency Mechanisms** | File hash, row-level keys, transaction-level unique constraints | Prevents duplicate postings in high-frequency execution scenarios |
| **Price Simulation (STA)** | Current price → Expected price after support | Competitive response scenarios unique to reactive promotions |
| **Spend-Only KPIs** | Effective Discount %, On/Off Split, Coverage (# agreements / # CPLs) | Planning mode has different KPIs (ROI, Uplift, etc.) |

#### Planning-First Mode (Unique Features)

**Phasing Note:** The planning layer is designed as a forward-looking capability that may be activated in later phases depending on organizational maturity and readiness.

**Specification Note:** Planning-First Mode is architecturally defined in Section 2 but functionally specified in Section 5. Detailed UI flows, KPI formulas, and grid interaction logic are documented in the Planning-First specification section.

| Feature | Description | Why Mode-Specific |
|---------|-------------|-------------------|
| **Planning Grid UI** | Hierarchical FU/SKU grid with inline editing | Forward planning requires multi-SKU volume entry |
| **Volume Planning** | Base + Planned Volume → Incremental | Actuals mode doesn't forecast |
| **KPI Calculation Engine** | Formula-driven, real-time ROI/Uplift calculation | ROI optimization requires simulation |
| **RAG Status** | Real-time thresholds with visual feedback | Planning optimizes future; Actuals tracks past |
| **What-If Scenarios** | Adjust inputs → Instant recalculation | Simulation not relevant post-facto |

---

### 2.1.4 Technology Foundation

**Frontend:**
- **Framework:** React 18+ (Single Page Application)
- **State Management:** Redux Toolkit / React Query
- **UI Library:** Material-UI / Ant Design (consistent design system)
- **Responsiveness:** Desktop-optimized, tablet-functional, mobile-viewable

**Backend:**
- **Runtime:** Node.js 18+ LTS
- **Framework:** Express.js / Fastify
- **API Style:** RESTful (JSON payloads)
- **Authentication:** JWT-based, SSO-ready (SAML 2.0 / OAuth 2.0)

**Database:**
- **RDBMS:** PostgreSQL 14+
- **Schema:** ~20 core tables (10 shared, 5 Actuals-specific, 5 Planning-specific)
- **Indexing:** Optimized for period-based queries and dimensional rollups
- **Materialized Views:** Pre-aggregated reporting views (refresh on schedule)

**Infrastructure:**
- **Deployment:** Cloud-native (AWS / Azure / GCP)
- **Containerization:** Docker + Kubernetes (optional)
- **CI/CD:** GitHub Actions / GitLab CI / Azure DevOps
- **Observability:** Logging (structured JSON), Metrics (Prometheus), Tracing (Jaeger)

**Integrations:**
- **SSO:** SAML 2.0 / OAuth 2.0 (Day 1)
- **Email/Notifications:** SMTP (approval notifications, alerts)
- **ERP Integration:** API-based (Phase 2) for master data sync
- **BI Tools:** SQL-over-REST or direct DB read replicas (Phase 2)

---

## 2.2 Mode Selection Framework

### 2.2.1 Business Process Characteristics

The choice between Actuals-First and Planning-First modes is **not** about channel type (Traditional vs. NKA) but about the **characteristics of the promotion process itself**.

**Key Decision Factors:**

| Factor | Actuals-First Mode | Planning-First Mode |
|--------|-------------------|---------------------|
| **Time Horizon** | Reactive, immediate | Proactive, future-looking |
| **Planning Window** | Hours to days | Weeks to months |
| **Baseline Availability** | Unknown or irrelevant | Required and reliable |
| **Decision Driver** | Competitive move, opportunity | Strategic calendar, ROI target |
| **Volume Predictability** | Unpredictable | Forecastable |
| **Approval Basis** | Commercial terms, justification | ROI projection, profitability |
| **Execution Trigger** | Agreement signed → Spend happens | Plan approved → Execution scheduled |
| **KPI Focus** | What was spent, how much discount | What will ROI be, what is uplift |

**Decision Tree:**

```
                    ┌────────────────────────────┐
                    │  Promotion Need Identified  │
                    └──────────────┬──────────────┘
                                   │
                     ┌─────────────┴─────────────┐
                     │                           │
            ┌────────▼──────────┐      ┌────────▼──────────┐
            │ Can baseline be    │      │ Is time available │
            │ established?       │      │ for planning?     │
            └────────┬───────────┘      └────────┬──────────┘
                     │                           │
              ┌──────┴──────┐             ┌──────┴──────┐
              │ NO / HARD   │             │   YES       │
              └──────┬──────┘             └──────┬──────┘
                     │                           │
            ┌────────▼──────────┐      ┌────────▼──────────┐
            │ Is immediate       │      │ Is ROI simulation │
            │ response required? │      │ required?         │
            └────────┬───────────┘      └────────┬──────────┘
                     │                           │
              ┌──────┴──────┐             ┌──────┴──────┐
              │    YES      │             │    YES      │
              └──────┬──────┘             └──────┬──────┘
                     │                           │
                     ▼                           ▼
          ┌──────────────────┐        ┌──────────────────┐
          │  ACTUALS-FIRST   │        │  PLANNING-FIRST  │
          │      MODE        │        │      MODE        │
          └──────────────────┘        └──────────────────┘
               │                              │
               ├─ Create Agreement            ├─ Create Plan
               ├─ Justify                     ├─ Enter Volumes
               ├─ Get Approval                ├─ Simulate ROI
               ├─ Execute                     ├─ Optimize
               └─ Track Spend                 ├─ Get Approval
                                             ├─ Execute
                                             └─ Track Actuals
```

---

### 2.2.2 Use Case Mapping (Channel-Agnostic)

**Important:** Mode selection is process-driven, not channel-driven. Any channel can use either mode.

#### Actuals-First Mode Use Cases

| Scenario | Channel Example | Why Actuals-First |
|----------|----------------|-------------------|
| **Competitive Response** | Traditional: Competitor launches 20% discount on shampoo | Need to react within 24-48 hours; no time for planning |
| **Distributor Rebate** | Traditional/Wholesale: Quarterly turnover rebate | Retrospective settlement; already happened |
| **Spot Opportunity** | NKA: Last-minute shelf space offer | Unplanned; must decide quickly |
| **Price Protection** | Any: Manufacturer price drop → Retailer claims protection | Reactive adjustment |
| **Ad-Hoc Display Fee** | Modern Trade: Store requests display fee outside plan | Not in annual plan; opportunistic |
| **Listing Fee** | NKA/Modern Trade: New SKU listing negotiation | One-time, immediate |

#### Planning-First Mode Use Cases

| Scenario | Channel Example | Why Planning-First |
|----------|----------------|-------------------|
| **Quarterly JBP** | NKA: Joint Business Plan with key account | Strategic, ROI-optimized, 3-month visibility |
| **Monthly Promo Calendar** | Modern Trade: Planned in-store activations | Scheduled, volume-forecast-driven |
| **Seasonal Campaign** | Traditional: Ramadan/New Year promotion | Planned in advance, ROI calculated |
| **Category Promotion** | Any: Category-wide 360° campaign | Multi-SKU, requires uplift simulation |
| **New Product Launch** | Any: Launch support with trial incentives | Forecasted, baseline proxied |
| **Annual Rebate Program** | NKA/Wholesale: Tiered annual rebate structure | Strategic, long-term, ROI-driven |

**Key Insight:**  
- Traditional channels use **both** modes (80% Actuals for daily tactics, 20% Planning for seasonal campaigns)
- NKA channels use **both** modes (70% Planning for quarterly plans, 30% Actuals for spot deals)
- The platform doesn't lock you into one mode per channel

---

### Workflow Resolution in Practice

The power of CollMind's policy-driven architecture becomes clear in real-world scenarios:

**Scenario: NKA Planner Responds to Competitive Move**

1. **Context:** Competitor launches unexpected 15% discount on category
2. **Planner Action:** Clicks "Create Promotion"
3. **System Prompts:** "Select Customer/Channel"
4. **Planner Selects:** "Migros (NKA Channel)"
5. **System Resolution:**
   - Queries scope_policies: channel='NKA' → execution_model='HYBRID', default='PLAN'
   - Checks user permissions: user has both 'plans.create' and 'agreements.create'
   - Presents modal:
     ```
     What would you like to create for Migros?
     
     [ ] Create Plan
         Strategic promotion with ROI simulation and volume planning
         Recommended for: Planned campaigns, JBPs
         
     [●] Create Agreement (Quick Response)
         Fast tactical response for spot deals
         Recommended for: Competitive responses, urgent deals
         
     [Continue]
     ```
6. **Planner Chooses:** "Create Agreement" (because it's urgent)
7. **System Opens:** Agreement form (Actuals-First workflow)
8. **Result:** Agreement created in 20 minutes, approved same day, executed next day

**Key Insight:** 
- User didn't "switch modes" manually
- System offered both workflows (HYBRID scope)
- User made informed choice based on urgency
- Same user, same channel, different workflow — true flexibility

**Contrasting Scenario: Traditional Planner, Same Situation**

1. **Planner Action:** Clicks "Create Promotion"
2. **Planner Selects:** "Distributor A (Traditional Channel)"
3. **System Resolution:**
   - Queries scope_policies: channel='TRADITIONAL' → execution_model='ACTUALS_FIRST'
   - Checks user permissions: user has 'agreements.create'
   - **No modal presented** — Agreement form opens directly
4. **Result:** Zero confusion, faster workflow (no choice to make)

**Best Practice:** Use ACTUALS_FIRST or PLANNING_FIRST (deterministic) wherever possible. Reserve HYBRID for contexts where both workflows are genuinely needed.

---

### 2.2.3 Hybrid Operations (Most Common Pattern)

In practice, most organizations operate in **hybrid mode** — using both operational modes simultaneously.

**Example: Typical FMCG Company**

```
ORGANIZATION: Regional FMCG Company
ANNUAL TRADE SPEND: $10M
CHANNELS: NKA (40%), Modern Trade (30%), Traditional (25%), Wholesale (5%)

MODE USAGE PATTERN:

┌─────────────────────────────────────────────────────────┐
│  NKA CHANNEL (40% of spend)                             │
├─────────────────────────────────────────────────────────┤
│  Planning-First: 75%                                    │
│    • Q1-Q4 Joint Business Plans                         │
│    • Monthly promotional calendars                      │
│  Actuals-First: 25%                                     │
│    • Spot shelf space deals                             │
│    • Ad-hoc display fees                                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  MODERN TRADE CHANNEL (30% of spend)                    │
├─────────────────────────────────────────────────────────┤
│  Planning-First: 60%                                    │
│    • Monthly in-store activation plans                  │
│    • Seasonal campaigns                                 │
│  Actuals-First: 40%                                     │
│    • Opportunistic promotions                           │
│    • Competitive responses                              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  TRADITIONAL TRADE CHANNEL (25% of spend)               │
├─────────────────────────────────────────────────────────┤
│  Actuals-First: 85%                                     │
│    • Daily competitive moves                            │
│    • Distributor rebates                                │
│  Planning-First: 15%                                    │
│    • Ramadan/holiday campaigns                          │
│    • Regional activation plans                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  WHOLESALE CHANNEL (5% of spend)                        │
├─────────────────────────────────────────────────────────┤
│  Actuals-First: 70%                                     │
│    • Volume rebates (quarterly settlement)              │
│    • Ad-hoc incentives                                  │
│  Planning-First: 30%                                    │
│    • Annual rebate programs                             │
└─────────────────────────────────────────────────────────┘

PLATFORM VALUE:
• All spend tracked in unified ledger
• Budget pool shared across modes
• Master data consistent
• Reporting shows complete picture
```

**Operational Benefits of Hybrid:**
1. **Flexibility:** Use the right tool for each job
2. **Completeness:** No spend escapes tracking
3. **Consistency:** Same master data, same approval principles
4. **Simplicity:** One platform to learn, not two systems

---

## 2.3 Operational Modes Comparison

### 2.3.1 Actuals-First Mode Deep Dive

**Operational Paradigm:** "Act first, track immediately, justify always."

**Process Flow:**
```
Trigger Event (e.g., competitor move)
    ↓
Create Agreement (STA/LTA) — 15-30 minutes
    ↓
Mandatory Justification — 2-5 minutes
    ↓
Policy Validation (automatic) — instant
    ↓
Submit for Approval — 1 click
    ↓
Approval Decision — <24 hours target
    ↓
Execute (agreement terms communicated to field)
    ↓
Spend Occurs (off-invoice batch import)
    ↓
Ledger Posting (automatic)
    ↓
Real-Time Reporting (Finance Dashboard updated)
```

**Core Objects:**
- **Agreement:** Commercial contract (STA ≤30 days, LTA >30 days)
- **Agreement Transaction:** Individual spend event (e.g., off-invoice invoice)
- **Ledger Entry:** Financial posting (double-entry optional, audit-focused)

**User Experience Highlights:**
- **Speed:** Agreement creation <30 minutes (vs. hours in planning systems)
- **Simplicity:** Minimal data entry (CPL, Tactic, Value, Duration, Justification)
- **Validation:** Policy engine checks limits, caps, budget availability in real-time
- **Transparency:** Agreement status visible; approval chain clear

**Typical User Journey (Example):**
1. **Planner:** Receives call from distributor about competitor promo
2. **Planner:** Opens CollMind → "Create Agreement" → STA
3. **Planner:** Selects CPL, Tactic (e.g., "Off-Invoice Rebate"), FU
4. **Planner:** Enters 10% discount, 30-day duration, ₺50K cap
5. **System:** Validates (tactic policy OK, budget available, duration within limit)
6. **Planner:** Writes justification: "Competitor X launched 12% discount; maintain shelf share"
7. **Planner:** Submits → Approval request created
8. **Regional Manager:** Receives notification → Reviews → Approves (4 hours later)
9. **Agreement:** Status → APPROVED
10. **Field:** Executes (communicated via email/field app)
11. **Finance:** Month-end, receives off-invoice from distributor
12. **Finance:** Batch uploads 40 invoices (including this one) → System validates, matches to agreement
13. **System:** Posts to ledger → Finance Dashboard updates

**Key Benefits:**
- Market responsiveness (hours vs. days)
- Complete tracking (no "dark spend")
- Justification mandate (learning + audit)
- Budget control (real-time availability check)

---

### 2.3.2 Planning-First Mode Deep Dive

**Operational Paradigm:** "Plan strategically, simulate ROI, execute deliberately."

**Process Flow:**
```
Strategic Planning Cycle (e.g., Q2 planning)
    ↓
Create Plan — 1-2 hours
    ↓
Add FUs (Family Units) to plan
    ↓
Enter SKU Volumes (Base + Planned)
    ↓
Assign Tactic per FU (e.g., 15% off-invoice)
    ↓
System Calculates KPIs (GP ROI, Uplift%, etc.) — real-time
    ↓
Optimize (adjust volume/discount → re-simulate ROI)
    ↓
RAG Status Check (all KPIs green?)
    ↓
Submit for Approval
    ↓
Category Manager Reviews → Approves
    ↓
Finance Approves Budget Allocation
    ↓
Plan Status → APPROVED
    ↓
Execute (calendar communicated, execution tracked)
    ↓
Actuals Posted to Ledger (as execution occurs)
    ↓
Variance Analysis (Planned vs. Actual)
```

**Core Objects:**
- **Plan:** Strategic promotion plan (typically quarterly or monthly)
- **Plan Item:** FU-level tactic assignment within plan
- **SKU Volume:** SKU-level volume forecast (base + planned)
- **KPI Calculation:** Real-time profitability metrics

**User Experience Highlights:**
- **Structured Entry:** Planning grid (FU hierarchy, expand/collapse)
- **Inline Editing:** Change volume/discount → Instant recalculation
- **Visual Feedback:** RAG colors (green = profitable, red = unprofitable)
- **Grand Totals:** Plan-level aggregates (total spend, total ROI, total incremental volume)
- **What-If:** Try different scenarios before committing

**Typical User Journey (Example):**
1. **Strategic Planner:** Q2 planning cycle begins
2. **Planner:** Opens CollMind → "Create Plan" → "Q2 2026 NKA Promotion"
3. **Planner:** Selects customer (CPL), quarter (Apr-Jun 2026)
4. **Planner:** Adds 10 FUs (e.g., Shampoo FU, Conditioner FU, etc.)
5. **System:** Pre-fills base volumes (historical average)
6. **Planner:** Expands Shampoo FU → Sees 20 SKUs
7. **Planner:** Adjusts planned volumes (+10% uplift target)
8. **Planner:** Assigns tactic: "15% Off-Invoice Discount" to Shampoo FU
9. **System:** Calculates GP ROI = 145% (AMBER, target is 150%+)
10. **Planner:** Reduces discount to 12% → GP ROI = 162% (GREEN)
11. **Planner:** Repeats for all FUs
12. **Grand Totals Panel:** Shows Total Spend = ₺500K, Total ROI = 155%, Incremental Volume = 12K units
13. **Planner:** Submits for approval
14. **Category Manager:** Reviews → Sees all GREEN → Approves
15. **Finance:** Checks budget (₺500K available) → Approves
16. **Plan:** Status → APPROVED
17. **Execution Phase:** Plan terms communicated; actuals posted monthly
18. **Month-End:** System compares Planned vs. Actual → Variance report

**Key Benefits:**
- ROI optimization before commitment
- Scenario analysis (what-if modeling)
- Volume-based planning (incremental forecasting)
- Profitability visibility (prevent bad deals)
- Strategic alignment (quarterly/annual cycles)

---

### 2.3.3 Side-by-Side Comparison

| Dimension | Actuals-First Mode | Planning-First Mode |
|-----------|-------------------|---------------------|
| **Primary Object** | Agreement (STA/LTA) | Plan (with FU items) |
| **Time Horizon** | 1-30 days (STA), 30-365 days (LTA) | 30-365 days (monthly/quarterly/annual) |
| **Creation Time** | 15-30 minutes | 1-2 hours |
| **Data Entry Volume** | Low (CPL, Tactic, Value, Duration) | Medium-High (FUs, SKUs, Volumes, Tactics) |
| **Volume Planning** | Not applicable | Core requirement (base + planned volumes) |
| **ROI Simulation** | Not included (post-facto tracking) | Core capability (real-time KPI calculation) |
| **Approval Basis** | Commercial terms, justification, budget | ROI metrics (GP ROI, Uplift%), budget |
| **Execution Trigger** | Agreement approved → Immediate | Plan approved → Scheduled execution |
| **Spend Tracking** | Agreement transactions → Ledger | Plan execution actuals → Ledger |
| **KPIs** | Effective Discount %, Coverage, On/Off Split | GP ROI, Uplift %, Incremental Volume, Incremental GP |
| **Flexibility** | High (create agreement anytime) | Medium (tied to planning cycle) |
| **Strategic Value** | Tactical agility, market responsiveness | ROI optimization, profitability management |
| **Use Case Fit** | Reactive, opportunistic, rapid response | Proactive, strategic, ROI-driven |
| **Reporting Focus** | What was spent, where, how much | What was planned vs. what happened (variance) |

---

## 2.4 Supported Organizational Patterns

CollMind TPM Platform serves FMCG organizations with trade promotion complexity across multiple channels. The platform's flexibility supports different organizational patterns through scope policy configuration:

### Pattern Summary

| Organization Pattern | Channel Mix | Primary Capability | Scope Policy Configuration |
|---------------------|-------------|-------------------|---------------------------|
| **Traditional-Heavy** | 60-70% Traditional | Actuals-First dominant | Traditional: ACTUALS_FIRST<br>NKA: HYBRID (optional planning) |
| **NKA-Centric Strategic** | 50-60% NKA | Planning-First dominant | NKA/MT: PLANNING_FIRST<br>Traditional: ACTUALS_FIRST |
| **Balanced Multi-Channel** | Mixed across all channels | True Hybrid usage | Channel-specific policies<br>Unified budget & reporting |
| **Premium Brand** | 70% NKA, high A&P | Planning-First with ROI rigor | NKA/MT: PLANNING_FIRST<br>Mandatory ROI thresholds |

### Implementation Approach by Pattern

**Traditional-Heavy Organizations:**
- **Phase 1 Focus:** Actuals-First MVP (13 weeks)
- **Value Driver:** Spend visibility, rapid execution, distributor tracking
- **Expected Usage:** 95% Actuals, 5% Planning (seasonal only)

**NKA-Centric Organizations:**
- **Phase 1 Focus:** Dual-mode deployment (23 weeks: Actuals + Planning)
- **Value Driver:** ROI optimization, strategic planning, what-if analysis
- **Expected Usage:** 70% Planning, 30% Actuals (spot deals)

**Multi-Channel Organizations:**
- **Phase 1 Focus:** Actuals-First foundation, phased Planning activation
- **Value Driver:** Unified visibility, consistent governance, no reconciliation
- **Expected Usage:** 50-60% Actuals, 40-50% Planning (channel-dependent)

**Premium Brands:**
- **Phase 1 Focus:** Planning-First accelerated (10-12 weeks)
- **Value Driver:** Trade ROI improvement (1-2% = millions impact)
- **Expected Usage:** 90% Planning, 10% Actuals (emergency responses)

**Note for Internal Teams:** Detailed customer scenarios and use case narratives are available in the Sales Enablement Deck and Implementation Playbook. This BRD focuses on product capabilities and technical architecture.

---

## 2.5 Platform Scalability & Extensibility

**Designed for Growth:**

The platform architecture supports scaling along multiple dimensions:

**1. Volume Scalability**
- **SKUs:** Tested with 10,000+ SKUs per organization
- **Agreements/Plans:** Handles 1,000+ active promotions concurrently
- **Users:** Supports 100+ concurrent users with <2s page loads
- **Transactions:** Off-invoice batch import scales to 500+ invoices per batch

**2. Functional Extensibility**
- **New Tactics:** Admin can define new tactics without code changes
- **New KPIs:** Formula engine supports admin-defined KPIs (Planning mode)
- **New Approval Rules:** JSON-configurable policies (no hard-coding)
- **New Dimensions:** Master data extensible (new hierarchies, attributes)

**3. Integration Readiness**
- **ERP Sync:** API-ready for master data and transaction sync
- **BI Tools:** SQL-over-REST or direct read replica access
- **Third-Party Systems:** Webhook support for event-driven integrations
- **Mobile Apps:** REST API supports native mobile (future)

**4. Multi-Tenancy (SaaS Roadmap)**
- Current: Single-tenant deployments
- Roadmap: Multi-tenant SaaS architecture (tenant-level data isolation)

---

## 2.7 Non-Goals & Explicit Exclusions

To maintain clear product scope and prevent misaligned expectations, the following capabilities are **explicitly excluded** from the platform's current scope:

### What CollMind TPM Is NOT

**1. Not an ERP Replacement**
- CollMind captures commercial intent and financial commitment (agreements, plans)
- **Does NOT handle:** Order fulfillment, logistics, warehouse management, accounts payable processing
- **Integration boundary:** CollMind posts financial transactions; ERP handles operational execution

**2. Not an Automatic Pricing Optimizer (Phase 1)**
- System provides ROI simulation based on user inputs
- **Does NOT:** Automatically suggest optimal price points or discount levels
- **Roadmap consideration:** AI-driven price recommendations are under evaluation for Phase 3+

**3. Not a Demand Forecasting System**
- Planning mode requires baseline volumes as input
- **Does NOT:** Generate demand forecasts or predict sales volumes
- **Integration expected:** Demand planning systems provide baseline data as input
- **Roadmap consideration:** Statistical forecasting module under evaluation for Phase 3+

**4. Not a Competitive Intelligence Platform**
- System does not automatically ingest competitor pricing or promotional data
- **User responsibility:** Market intelligence must be manually entered or integrated from external sources
- **Roadmap consideration:** API integration with market data providers under evaluation for Phase 3+

**5. Not a Consumer Analytics Platform**
- System tracks promotional spend and ROI, not consumer behavior
- **Does NOT:** Provide shopper segmentation, basket analysis, or consumer journey mapping
- **Integration boundary:** Syndicated data (Nielsen, IRI) remains in separate analytics platforms

### Scope Boundaries

| Capability | In Scope | Out of Scope |
|------------|----------|--------------|
| **Trade Promotion Management** | ✅ Agreements, Plans, ROI simulation | ❌ Consumer promotions, coupons |
| **Budget Management** | ✅ Allocation, tracking, alerts | ❌ GL accounting, AP processing |
| **Approval Workflows** | ✅ Multi-level, policy-driven | ❌ Purchase requisitions, expense approvals |
| **Spend Tracking** | ✅ Off-invoice, lumpsum, actuals | ❌ Manufacturing costs, COGS |
| **Master Data** | ✅ SKU, Customer, Tactic library | ❌ BOM, routing, supplier master |
| **Reporting** | ✅ Promo performance, budget utilization | ❌ P&L statements, balance sheets |

### Integration Strategy

For capabilities outside CollMind's scope, the platform provides:
- **APIs:** RESTful APIs for data exchange with ERP, demand planning, BI systems
- **Webhooks:** Event notifications for integration triggers
- **Batch Import/Export:** CSV/Excel interfaces for data synchronization
- **SSO Integration:** Single sign-on for seamless user experience

**Principle:** CollMind excels at trade promotion management while integrating cleanly with surrounding enterprise systems.

---

## 2.6 Scope Policies & Workflow Resolution

### Overview

CollMind TPM uses a **scope policy engine** to determine which operational workflows (Agreements, Plans, or both) are available in different business contexts. This policy-driven approach ensures users always see the right interface without manual mode selection.

**Capability Activation:** Capabilities are always available at platform level, but only activated per user, channel, or process through permissions and policies. This ensures governance while maintaining flexibility.

### The Challenge: Avoiding "Mode Confusion"

If users could freely choose between Agreement and Plan workflows for any context, several problems would emerge:
- Wrong workflow selection (Plan created for spot deal, Agreement for strategic campaign)
- Incomplete data entry (missing fields that are critical for the chosen workflow)
- Training complexity ("When do I use which screen?")
- Data quality issues (inconsistent usage patterns)

**CollMind Solution:** System automatically resolves the appropriate workflow based on business context.

---

### Scope Policy Configuration

Administrators define **execution models** per channel, subchannel, or specific CPL:

```sql
-- Example scope_policies table
CREATE TABLE scope_policies (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  
  -- Scope definition
  channel VARCHAR(30),              -- 'TRADITIONAL', 'NKA', 'MT', 'WHOLESALE', NULL (all)
  subchannel VARCHAR(30),           -- optional: finer segmentation
  cpl_id UUID,                      -- optional: CPL-specific override
  
  -- Execution model
  execution_model VARCHAR(20) NOT NULL, 
    -- 'ACTUALS_FIRST' | 'PLANNING_FIRST' | 'HYBRID'
  
  -- UI behavior
  default_workflow VARCHAR(20) NOT NULL, 
    -- 'AGREEMENT' | 'PLAN'
  
  -- Priority for conflict resolution
  priority INT DEFAULT 100,        -- lower = higher priority
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Example Configuration:**

| Channel | Execution Model | Default Workflow | Rationale |
|---------|----------------|------------------|-----------|
| Traditional | ACTUALS_FIRST | Agreement | Fast-moving, reactive market |
| NKA | HYBRID | Plan | Strategic planning + spot deals |
| Modern Trade | PLANNING_FIRST | Plan | Calendar-driven promotions |
| Wholesale | ACTUALS_FIRST | Agreement | Retrospective rebates |

**Special Cases:**
- Specific CPL override: "Carrefour" → PLANNING_FIRST (even if channel is Traditional)
- Subchannel granularity: "Traditional > Premium" → HYBRID (but "Traditional > Mass" → ACTUALS_FIRST)

---

### Workflow Resolution Logic

When a user initiates a promotion, the system follows this logic:

```typescript
function resolveWorkflow(context: {
  tenantId: string,
  userId: string,
  channel: string,
  cplId: string
}) {
  // Step 1: Find applicable scope policy (by priority)
  const policy = getScopePolicy(context.tenantId, {
    channel: context.channel,
    cplId: context.cplId
  }); // Returns highest priority match
  
  // Step 2: Check user permissions
  const perms = getUserPermissions(context.userId);
  
  // Step 3: Determine available workflows
  const workflows = [];
  
  if (policy.execution_model === 'ACTUALS_FIRST') {
    if (perms.includes('agreements.create')) {
      workflows.push({ type: 'AGREEMENT', isDefault: true });
    }
  } else if (policy.execution_model === 'PLANNING_FIRST') {
    if (perms.includes('plans.create')) {
      workflows.push({ type: 'PLAN', isDefault: true });
    }
  } else if (policy.execution_model === 'HYBRID') {
    if (perms.includes('plans.create')) {
      workflows.push({ 
        type: 'PLAN', 
        isDefault: policy.default_workflow === 'PLAN' 
      });
    }
    if (perms.includes('agreements.create')) {
      workflows.push({ 
        type: 'AGREEMENT', 
        isDefault: policy.default_workflow === 'AGREEMENT' 
      });
    }
  }
  
  // Step 4: Return resolution
  return {
    workflows,
    autoSelect: workflows.length === 1 // Auto-open if only one option
  };
}
```

**User Experience:**

**Scenario A: Traditional Planner (Single Workflow)**
1. Planner clicks "Create Promotion"
2. Selects CPL: "Distributor A (Traditional Channel)"
3. System resolves: Traditional = ACTUALS_FIRST, user has `agreements.create`
4. **Result:** Agreement form opens automatically (no choice presented)

**Scenario B: NKA Planner (Hybrid Context)**
1. Planner clicks "Create Promotion"
2. Selects CPL: "Carrefour (NKA Channel)"
3. System resolves: NKA = HYBRID, user has both permissions
4. **Result:** Modal shows two options:
   ```
   What would you like to create?
   
   [●] Create Plan (Recommended)
       Strategic promotion with ROI simulation
       
   [ ] Create Agreement  
       Quick spot deal or opportunistic promotion
   
   [Continue]
   ```
5. Planner chooses based on immediate need

**Scenario C: Permission-Restricted User**
1. Finance Analyst (read-only permissions)
2. Selects any CPL
3. System resolves: No `create` permissions
4. **Result:** View-only mode (no create options)

---

### Permission Model Integration

Scope policies work **in combination** with RBAC permissions:

```typescript
// User permissions control capability
permissions = [
  'agreements.create',  // Can create agreements
  'agreements.view',    // Can view agreements
  'agreements.approve', // Can approve agreements
  'plans.create',       // Can create plans (Phase 2)
  'plans.view',         // Can view plans (Phase 2)
  'plans.approve',      // Can approve plans (Phase 2)
];

// Scope policies control context
scope_policy = {
  channel: 'NKA',
  execution_model: 'HYBRID', // Both workflows available
  default_workflow: 'PLAN'
};

// Result: User with 'plans.create' sees Plan option (default)
//         User with only 'agreements.create' sees only Agreement option
```

**Key Insight:** Permissions are **user-level**, Scope Policies are **context-level**. Both must align for a workflow to be available.

---

### Phase 1 vs. Phase 2 Behavior

**Phase 1 (Actuals-First MVP):**
```sql
-- Tenant feature flag
UPDATE tenant_features 
SET planning_mode_enabled = false;

-- All scope policies default to ACTUALS_FIRST
UPDATE scope_policies 
SET execution_model = 'ACTUALS_FIRST';

-- Planning permissions not assigned to any role
-- Result: No user sees Plan workflows
```

**Frontend Behavior:**
- "Plans" menu item: **Hidden** (not disabled, hidden)
- "Create Promotion" → Always resolves to Agreement workflow
- No "mode confusion" because Planning doesn't exist yet

**Phase 2 (Planning Activation):**
```sql
-- Enable planning tenant-wide
UPDATE tenant_features 
SET planning_mode_enabled = true;

-- Update scope policies for strategic channels
UPDATE scope_policies 
SET execution_model = 'HYBRID', default_workflow = 'PLAN'
WHERE channel IN ('NKA', 'MT');

-- Assign planning permissions to relevant roles
UPDATE role_permissions 
SET permission_id = 'plans.create'
WHERE role_id IN ('NKA_Planner', 'Strategic_Planner');
```

**Frontend Behavior:**
- "Plans" menu item: **Visible** (feature flag check passes)
- "Create Promotion" → May show both options (if HYBRID + permissions)
- Feature activation requires no code deployment

---

### Administrative Interface

Admins can configure scope policies via the Settings panel:

**UI Features:**
1. **Policy List View**
   - Table showing all active policies
   - Columns: Scope (Channel/CPL), Execution Model, Default, Priority, Actions

2. **Add/Edit Policy**
   - Select scope: Channel dropdown, optional CPL selector
   - Choose execution model: ACTUALS_FIRST / PLANNING_FIRST / HYBRID
   - Set default workflow (if HYBRID)
   - Set priority (for conflict resolution)

3. **Policy Preview**
   - "Test Mode": Select a user and CPL → See what they would see
   - Example: "Show me what NKA Planner will see for Carrefour"

4. **Conflict Resolution**
   - If multiple policies match (e.g., both channel and CPL policies), priority determines winner
   - System shows warning if policies conflict

**Example Admin Workflow:**
1. Admin creates policy: NKA = HYBRID
2. Admin tests: Selects user "John (NKA Planner)", CPL "Migros"
3. Preview shows: "User will see both Plan (default) and Agreement options"
4. Admin confirms → Policy activated

---

### Best Practices

**1. Start Simple, Add Complexity**
- Phase 1: All channels = ACTUALS_FIRST (single workflow everywhere)
- Phase 2: Strategic channels = HYBRID (introduce choice where needed)
- Phase 3: Fine-tune with CPL-specific overrides

**2. Use HYBRID Sparingly**
- HYBRID adds cognitive load (user must choose)
- Reserve for contexts where both workflows are genuinely needed
- Most channels should be ACTUALS_FIRST or PLANNING_FIRST (deterministic)

**3. Document Rationale**
- Add comments to scope policies: "NKA = HYBRID because quarterly plans + spot deals"
- Training materials should reference scope policies

**4. Review Quarterly**
- Usage analytics: "Are users choosing Plan or Agreement in HYBRID contexts?"
- Adjust policies based on actual behavior

---

### Benefits Summary

| Benefit | Description |
|---------|-------------|
| **Eliminates Confusion** | Users don't choose mode; system presents right workflow |
| **Reduces Errors** | Wrong workflow selection prevented by policy |
| **Simplifies Training** | "For Traditional, you create Agreements. For NKA, you create Plans." |
| **Enables Flexibility** | HYBRID contexts support both workflows where needed |
| **Scales Easily** | Add new channels/CPLs without code changes |
| **Phased Activation** | Planning can be enabled seamlessly in Phase 2 |

---

**Next Section Preview:**  
Section 3 will detail Core/Shared Components in summary form, preparing for the full Actuals-First Mode specification in Section 4.

---

*End of Section 2: Product Overview*

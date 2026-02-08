# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 8

---

# 8. REPORTING & ANALYTICS

## Introduction

This section defines **how CollMind presents insights** back to users through reports, dashboards, and analytics. It addresses the critical question: "Once data is in the system, how do we get actionable intelligence out?"

**Scope:** This section covers core reports, mode-aware reporting patterns, drill-down principles, and explicit non-goals. It does NOT prescribe pixel-perfect dashboard designs or specific chart libraries — those are UX implementation details.

**Why This Matters:**
- **Finance:** Needs spend visibility, budget tracking, variance analysis
- **Category Managers:** Need plan performance, ROI tracking, optimization insights
- **Executives:** Need high-level summaries, KPI dashboards, trend analysis
- **Analysts:** Need data exports, custom slicing, ad-hoc queries

### Product Philosophy

**CollMind is an operational system with analytical capabilities, not a full-featured BI tool.** The reporting layer provides curated, role-specific reports that support decision-making. For advanced analytics (predictive modeling, ML-driven insights, custom dashboards), users should export data to dedicated BI platforms (Power BI, Tableau, Looker).

---

## 8.1 Core Reports (Phase 1)

CollMind Phase 1 includes **8 standard reports**, each optimized for specific user roles and decision contexts.

### Report 1: Trade Spend Summary

**Purpose:** High-level overview of promotional spending across channels, periods, and tactics

**Primary Users:** Finance, Executives

**Dimensions:**
- Period (Month, Quarter, YTD)
- Channel (NKA, Modern Trade, Traditional Trade, etc.)
- Category (Hair Care, Personal Care, etc.)
- Tactic Type (CPP, Display, Price Support, etc.)

**Metrics:**
- Total Spend (On-Invoice + Off-Invoice)
- Spend by Channel (%)
- Spend by Tactic (%)
- Spend vs Budget (% utilization)
- Period-over-Period Change (%)

**Visualization:**
```
┌─────────────────────────────────────────────────────────┐
│ TRADE SPEND SUMMARY - January 2026                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ TOTAL SPEND: 1,245,600 TL                             │
│ Budget: 1,800,000 TL (69% utilized) 🟢                │
│ vs Prior Month: +12.3%                                 │
│                                                         │
│ BY CHANNEL:                                             │
│ ┌─────────────────────────────────────────────────┐   │
│ │ ████████████████ Traditional    58% (722K)      │   │
│ │ ████████ NKA                    28% (348K)      │   │
│ │ ████ Modern Trade               14% (174K)      │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ BY TACTIC:                                              │
│ ┌─────────────────────────────────────────────────┐   │
│ │ CPP On-Invoice      45%  560,520 TL             │   │
│ │ Off-Invoice Rebate  30%  373,680 TL             │   │
│ │ Display Fees        15%  186,840 TL             │   │
│ │ Price Support       10%  124,560 TL             │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ MONTHLY TREND (Last 6 Months):                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │        ╱╲                                        │   │
│ │       ╱  ╲      ╱╲                              │   │
│ │      ╱    ╲    ╱  ╲    ╱                        │   │
│ │     ╱      ╲  ╱    ╲  ╱                         │   │
│ │ ───╱        ╲╱      ╲╱                          │   │
│ │ Aug Sep Oct Nov Dec Jan                         │   │
│ │ 980K 1.1M 1.05M 1.15M 1.11M 1.24M              │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ [📊 View Details] [📥 Export Excel] [📄 Export PDF]   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Filters:**
- Date Range (preset: MTD, QTD, YTD, Custom)
- Channel (multi-select)
- Category (multi-select)
- Region (optional)

**Drill-Down:**
- Click channel → Channel detail report
- Click tactic → Tactic performance report
- Click month → Month detail (all transactions)

---

### Report 2: Budget Utilization Report

**Purpose:** Track budget consumption across dimensions, prevent overruns, identify underutilization

**Primary Users:** Finance, Budget Controllers, Category Managers

**Dimensions:**
- Budget Envelope (Channel × Category × Period)
- Time Period (Month, Quarter, YTD)

**Metrics:**
- Allocated Budget
- Reserved Budget (Actuals-First agreements approved)
- Committed Budget (Planning-First plans approved)
- Consumed Budget (actual spend occurred)
- Available Budget (Allocated - Reserved - Committed - Consumed)
- Utilization % ((Reserved + Committed + Consumed) / Allocated)
- RAG Status (🟢 Green <80%, 🟡 Amber 80-95%, 🔴 Red >95%)

**Visualization:**
```
┌─────────────────────────────────────────────────────────┐
│ BUDGET UTILIZATION - January 2026                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ENVELOPE: Traditional Trade / Hair Care / 2026-01     │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ Allocated:  215,000 TL                          │   │
│ │ Reserved:   128,000 TL (60%)                    │   │
│ │ Committed:   35,000 TL (16%)                    │   │
│ │ Consumed:    59,000 TL (27%)                    │   │
│ │ ────────────────────────────────────────────    │   │
│ │ Available:   -7,000 TL (-3%) 🔴 OVERRUN!       │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ VISUAL BREAKDOWN:                                       │
│ ┌─────────────────────────────────────────────────┐   │
│ │ ████████████████████████████████████████████    │   │
│ │ |←Res 60%→||←Comm 16%→||←Cons 27%→| Over 3%   │   │
│ │                                                 │   │
│ │ 0K        100K        150K        200K   215K  │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ ALL ENVELOPES (Top 10 by Utilization):                 │
│ ┌────────────────┬──────────┬──────────┬────────┐     │
│ │ Envelope       │ Allocated│ Consumed │ Util % │     │
│ ├────────────────┼──────────┼──────────┼────────┤     │
│ │ Trad/Hair Care │ 215,000  │ 222,000  │ 103% 🔴│     │
│ │ NKA/Hair Care  │ 180,000  │ 168,000  │  93% 🟡│     │
│ │ MT/Pers Care   │  95,000  │  76,000  │  80% 🟡│     │
│ │ NKA/Pers Care  │ 120,000  │  85,000  │  71% 🟢│     │
│ │ Trad/Pers Care │ 150,000  │  98,000  │  65% 🟢│     │
│ └────────────────┴──────────┴──────────┴────────┘     │
│                                                         │
│ [🔔 Set Alert] [📊 Budget History] [📥 Export]         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Alerts:**
- 🟡 Amber Alert (80% threshold): Email to Category Manager + Finance
- 🔴 Red Alert (95% threshold): Email to Finance Director + block new submissions
- 🔴 Overrun Alert (>100%): Immediate escalation to CFO

**Drill-Down:**
- Click envelope → List all agreements/plans consuming from this envelope
- Click agreement → Agreement detail (transactions, invoices)

---

### Report 3: Agreement Status Report

**Purpose:** Track all agreements (Actuals-First), monitor execution, identify stalled agreements

**Primary Users:** Planners, Approvers, Finance

**Dimensions:**
- Status (Draft, Pending, Approved, Active, Closed, Rejected)
- Channel
- Period
- CPL

**Metrics:**
- Total Agreements (count)
- Total Cap Amount (sum of cap_total_amount)
- Total Consumed Amount
- Average Cap Utilization % (consumed / cap)
- Average Approval Time (approved_at - created_at)

**Visualization:**
```
┌─────────────────────────────────────────────────────────┐
│ AGREEMENT STATUS - January 2026                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ SUMMARY:                                                │
│ Total Agreements: 42                                    │
│ ├─ Draft:    5 (12%)                                   │
│ ├─ Pending:  8 (19%)                                   │
│ ├─ Approved: 22 (52%)                                  │
│ ├─ Closed:   5 (12%)                                   │
│ └─ Rejected: 2 (5%)                                    │
│                                                         │
│ Total Cap Amount: 1,350,000 TL                         │
│ Total Consumed: 892,000 TL (66% utilization)           │
│                                                         │
│ ACTIVE AGREEMENTS (Top 10):                            │
│ ┌──────────┬──────────┬────────┬──────────┬──────┐    │
│ │ Code     │ CPL      │ Cap TL │ Consumed │ Util │    │
│ ├──────────┼──────────┼────────┼──────────┼──────┤    │
│ │ STA-2026-│ Özgür    │ 15,000 │  12,500  │ 83%  │    │
│ │ 025      │ Kozmetik │        │          │      │    │
│ ├──────────┼──────────┼────────┼──────────┼──────┤    │
│ │ LTA-2026-│ Güzellik │ 25,000 │   6,250  │ 25%  │    │
│ │ GS-001   │ Sarayı   │        │          │      │    │
│ ├──────────┼──────────┼────────┼──────────┼──────┤    │
│ │ STA-2026-│ Metro    │  8,000 │   8,000  │100% 🔴│   │
│ │ 032      │ Dağıtım  │        │          │      │    │
│ └──────────┴──────────┴────────┴──────────┴──────┘    │
│                                                         │
│ PENDING APPROVALS (8 agreements):                      │
│ ├─ Awaiting Regional Manager: 5                        │
│ ├─ Awaiting Finance: 3                                 │
│ └─ Avg Wait Time: 18 hours                             │
│                                                         │
│ [📋 View All] [⚠️ Stalled Approvals] [📥 Export]       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Filters:**
- Status (multi-select)
- Date Range (creation date, approval date)
- Channel, CPL, Tactic

**Drill-Down:**
- Click agreement → Agreement detail page (full lifecycle, transactions)
- Click CPL → All agreements for this CPL

---

### Report 4: Plan Performance Report (Planning-First)

**Purpose:** Analyze ROI performance, compare planned vs actual, identify optimization opportunities

**Primary Users:** Category Managers, Planners, Finance

**Dimensions:**
- Plan Status (Draft, Pending, Approved, Active, Closed)
- Channel
- Period
- CPL

**Metrics:**
- Total Plans (count)
- Total Planned Spend
- Total Incremental GP (planned)
- Average GP ROI % (weighted by spend)
- Plans by RAG Status (Green/Amber/Red count)
- Approval Rate (approved / submitted)

**Visualization:**
```
┌─────────────────────────────────────────────────────────┐
│ PLAN PERFORMANCE - Q1 2026                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ SUMMARY:                                                │
│ Total Plans: 18                                         │
│ ├─ Approved: 14 (78% approval rate)                    │
│ ├─ Pending:   3                                        │
│ └─ Rejected:  1                                        │
│                                                         │
│ APPROVED PLANS:                                         │
│ Total Planned Spend: 2,450,000 TL                      │
│ Total Incremental GP: 598,000 TL                       │
│ Weighted Avg GP ROI: 24.4% 🟢                          │
│                                                         │
│ RAG DISTRIBUTION:                                       │
│ ┌─────────────────────────────────────────────────┐   │
│ │ 🟢 Green (ROI ≥20%):  11 plans (79%)           │   │
│ │ 🟡 Amber (ROI 10-20%): 2 plans (14%)           │   │
│ │ 🔴 Red   (ROI <10%):   1 plan  (7%)            │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ TOP PERFORMERS (by GP ROI):                            │
│ ┌──────────┬──────────┬─────────┬────────┬────────┐   │
│ │ Plan     │ Channel  │ Spend   │ iGP    │ GP ROI │   │
│ ├──────────┼──────────┼─────────┼────────┼────────┤   │
│ │ Q1-NKA-  │ NKA      │ 180,000 │ 58,000 │ 32.2%  │   │
│ │ Carrefour│          │         │        │        │   │
│ ├──────────┼──────────┼─────────┼────────┼────────┤   │
│ │ Q1-MT-   │ Modern   │  95,000 │ 26,000 │ 27.4%  │   │
│ │ Hair     │ Trade    │         │        │        │   │
│ └──────────┴──────────┴─────────┴────────┴────────┘   │
│                                                         │
│ BOTTOM PERFORMERS (GP ROI <15%):                       │
│ ├─ Q1-NKA-Styling: 12.3% ROI (needs optimization)     │
│ └─ [Review Details]                                    │
│                                                         │
│ [📊 ROI Distribution Chart] [📥 Export] [📈 Trends]    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Drill-Down:**
- Click plan → Plan detail (planning grid view)
- Click channel → All plans for channel
- Filter by RAG → Show only Green/Amber/Red plans

---

### Report 5: Planner Performance Report

**Purpose:** Track planner productivity, approval rates, plan quality

**Primary Users:** Sales Directors, Trade Marketing Managers

**Dimensions:**
- Planner (user)
- Period
- Channel

**Metrics:**
- Plans Created (count)
- Plans Approved (count)
- Approval Rate (%)
- Average Time to Approval (days)
- Average GP ROI % (of approved plans)
- Total Planned Spend (of approved plans)

**Visualization:**
```
┌─────────────────────────────────────────────────────────┐
│ PLANNER PERFORMANCE - Q1 2026                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ┌──────────┬────────┬─────────┬──────────┬────────┐   │
│ │ Planner  │ Plans  │ Approved│ Approval │ Avg ROI│   │
│ │          │ Created│         │ Rate     │        │   │
│ ├──────────┼────────┼─────────┼──────────┼────────┤   │
│ │ Ayşe Y.  │   8    │   7     │  87.5%   │ 26.1%  │   │
│ │ Mehmet K.│   6    │   4     │  66.7%   │ 21.3%  │   │
│ │ Elif S.  │   5    │   5     │ 100.0%   │ 23.8%  │   │
│ │ Can T.   │   4    │   2     │  50.0%   │ 15.2%  │   │
│ └──────────┴────────┴─────────┴──────────┴────────┘   │
│                                                         │
│ INSIGHTS:                                               │
│ • Elif S. has 100% approval rate (best practice)       │
│ • Can T. has low approval rate → Review plan quality   │
│ • Ayşe Y. leads in ROI performance (26.1% avg)         │
│                                                         │
│ AVG TIME TO APPROVAL: 2.3 days                         │
│ (Target: <2 days)                                       │
│                                                         │
│ [📊 Individual Breakdown] [📥 Export]                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Use Case:**
- Performance reviews
- Best practice identification
- Training needs assessment

---

### Report 6: Spend by Tactic Report

**Purpose:** Understand which tactics are driving spend, identify optimization opportunities

**Primary Users:** Finance, Category Managers

**Dimensions:**
- Tactic (CPP, Display, Price Support, etc.)
- Channel
- Period

**Metrics:**
- Total Spend by Tactic
- Spend % (of total trade spend)
- Agreements/Plans Using Tactic (count)
- Average Spend per Use

**Visualization:**
```
┌─────────────────────────────────────────────────────────┐
│ SPEND BY TACTIC - January 2026                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ┌──────────────────┬───────────┬─────────┬────────┐   │
│ │ Tactic           │ Spend (TL)│ % Total │ # Uses │   │
│ ├──────────────────┼───────────┼─────────┼────────┤   │
│ │ CPP On-Invoice   │  560,520  │  45%    │   28   │   │
│ │ Off-Invoice Rebate│ 373,680  │  30%    │   18   │   │
│ │ Display Fees     │  186,840  │  15%    │   12   │   │
│ │ Price Support    │  124,560  │  10%    │   15   │   │
│ └──────────────────┴───────────┴─────────┴────────┘   │
│                                                         │
│ PIE CHART:                                              │
│ ┌─────────────────────────────────────────────────┐   │
│ │         CPP 45%                                 │   │
│ │     ╱────────╲                                  │   │
│ │    │  CPP    │                                  │   │
│ │     ╲────────╱                                  │   │
│ │       │                                         │   │
│ │       │   Off-Inv 30%                           │   │
│ │       └─────────                                │   │
│ │                 Display 15%                     │   │
│ │                      Price 10%                  │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ TREND (Last 6 Months):                                 │
│ • CPP spend increasing (+8% MoM)                       │
│ • Display fees stable                                  │
│ • Off-Invoice rebates declining (-5% MoM)              │
│                                                         │
│ [📊 By Channel] [📊 By Category] [📥 Export]           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### Report 7: Variance Analysis Report (Planning-First)

**Purpose:** Compare planned vs actual performance, identify gaps, learn from execution

**Primary Users:** Category Managers, Finance (Phase 2 feature, included for completeness)

**Note:** Requires actuals import and variance calculation (deferred to Phase 2)

**Metrics:**
- Planned Volume vs Actual Volume (variance %)
- Planned Spend vs Actual Spend (variance %)
- Planned GP ROI vs Actual GP ROI (variance pp)
- Root cause analysis (volume shortfall, price changes, execution issues)

---

### Report 8: Executive Dashboard

**Purpose:** High-level KPI overview for leadership, trend spotting, anomaly detection

**Primary Users:** CEO, CFO, CMO, Sales Director

**Widgets (6 KPIs):**
1. Total Trade Spend (MTD, QTD, YTD)
2. Budget Utilization % (RAG status)
3. Active Agreements/Plans (count)
4. Average GP ROI % (Planning-First plans)
5. Spend by Channel (pie chart)
6. Monthly Spend Trend (line chart, 12 months)

**Visualization:**
```
┌─────────────────────────────────────────────────────────┐
│ EXECUTIVE DASHBOARD - January 2026                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ┌─────────────┬─────────────┬─────────────────────┐   │
│ │ TRADE SPEND │ BUDGET UTIL │ ACTIVE AGMT/PLANS   │   │
│ │ 1.24M TL    │ 69% 🟢      │ 42 agmts / 14 plans │   │
│ │ ↑12% vs Dec │             │                     │   │
│ └─────────────┴─────────────┴─────────────────────┘   │
│                                                         │
│ ┌─────────────┬─────────────┬─────────────────────┐   │
│ │ AVG GP ROI  │ SPEND BY CH │ MONTHLY TREND       │   │
│ │ 24.4% 🟢    │ Trad: 58%   │ [Trend Chart]       │   │
│ │ (14 plans)  │ NKA:  28%   │                     │   │
│ │             │ MT:   14%   │                     │   │
│ └─────────────┴─────────────┴─────────────────────┘   │
│                                                         │
│ ALERTS:                                                 │
│ • 🔴 Budget overrun: Traditional / Hair Care (+3%)     │
│ • 🟡 8 pending approvals (avg 18h wait)                │
│                                                         │
│ [📊 Full Reports] [📥 Export] [⚙️ Configure]           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Refresh:** Real-time (updates every 5 minutes)

---

## 8.2 Mode-Aware Reporting

**Challenge:** CollMind has two operational modes (Actuals-First and Planning-First) that produce different types of data. Reports must handle both gracefully.

### Reporting Strategy

**Option 1: Separate Reports (Phase 1)**
- Agreement Status Report (Actuals-First only)
- Plan Performance Report (Planning-First only)
- Trade Spend Summary (Combined: both modes contribute to spend)

**Option 2: Unified Reports with Mode Filter (Phase 2+)**
- Single "Promotional Performance" report with mode toggle

### Combined Views (Where Applicable)

**Trade Spend Summary:**
- Includes spend from both Actuals-First agreements AND Planning-First plans
- No differentiation needed (spend is spend, regardless of origin)

**Budget Utilization:**
- Reserved = Actuals-First agreements
- Committed = Planning-First plans
- Both consume from same budget envelopes

**Example:**
```
Budget Envelope: NKA / Hair Care / January 2026
├─ Allocated: 180,000 TL
├─ Reserved (Actuals-First): 85,000 TL (12 agreements)
├─ Committed (Planning-First): 45,000 TL (3 plans)
├─ Consumed: 62,000 TL (invoices posted)
└─ Available: -12,000 TL (overrun)
```

### Mode-Specific Metrics

**Actuals-First Only:**
- Agreement count, cap utilization, approval turnaround

**Planning-First Only:**
- GP ROI %, Incremental GP, Volume Uplift %, RAG distribution

**Both:**
- Total spend, budget utilization, channel/category breakdowns

---

## 8.3 Drill-Down Principles

**Drill-Down = The ability to navigate from summary to detail, progressively revealing more granular data.**

### Standard Drill-Down Paths

**Path 1: Period → Channel → CPL → Agreement/Plan**
```
Trade Spend Summary (January: 1.24M TL)
  ↓ Click "Traditional Trade"
Channel Detail (Traditional: 722K TL)
  ↓ Click "Özgür Kozmetik"
CPL Detail (Özgür: 48K TL, 5 agreements)
  ↓ Click "STA-2026-025"
Agreement Detail (Cap: 15K, Consumed: 12.5K, 8 invoices)
```

**Path 2: Budget → Envelope → Consuming Entities**
```
Budget Utilization (All Envelopes)
  ↓ Click "Traditional / Hair Care / Jan"
Envelope Detail (103% utilized, overrun 7K)
  ↓ Click "Consuming Agreements/Plans"
List of 18 agreements + 2 plans consuming from this envelope
  ↓ Click specific agreement
Agreement Detail
```

**Path 3: Plan Performance → Plan Detail → SKU Detail**
```
Plan Performance Report (14 approved plans)
  ↓ Click "Q1-NKA-Carrefour"
Plan Detail (GP ROI 32.2%, 3 FUs, 24 SKUs)
  ↓ Click FU "Wella SP Shampoo Range"
FU Detail (ROI 28.1%, 10 SKUs)
  ↓ Click SKU "Wella SP Balance 500ml"
SKU Detail (Base: 3K, Planned: 3.6K, iVol: 600)
```

### Drill-Down Implementation

**UI Pattern:**
- Summary row = Clickable link (blue text)
- Click → Navigate to detail page (preserve filters)
- Breadcrumb trail at top (e.g., "Home > Reports > Trade Spend > Traditional Trade")

**Performance:**
- Detail queries optimized (indexed on entity_id)
- Pre-aggregated summaries (materialized views)
- Lazy loading (load detail data only when expanded)

---

## 8.4 Export Capabilities

**Export = The ability to download report data for offline analysis or external BI tools.**

### Export Formats

**Excel (.xlsx):**
- Multiple sheets per report (e.g., Summary, Detail, Metadata)
- Formatted tables with headers, filters
- Charts embedded (if applicable)
- File size limit: 50 MB

**PDF:**
- Paginated, print-ready
- Executive-friendly layout
- Charts and tables rendered as images
- File size limit: 20 MB

**CSV:**
- Raw data, no formatting
- Fast export for large datasets
- One file per table (no multi-sheet support)
- File size limit: 100 MB

### Export Workflow

```
User clicks "Export Excel" on Trade Spend Summary
  ↓
System generates file (background job if >10K rows)
  ↓
User receives notification (email or in-app)
  ↓
File available for download (expires after 7 days)
```

**Export Metadata (Embedded in File):**
- Report Name
- Date Generated
- Filters Applied (Channel, Period, etc.)
- User Who Generated
- Data Freshness (e.g., "Data as of 2026-01-07 10:30 AM")

---

## 8.5 Explicit Non-Goals (Phase 1)

### ❌ Custom Report Builder

**Not Supported:**
- Drag-and-drop report designer
- User-defined metrics/dimensions
- Custom chart creation

**Why Deferred:**
- Complexity (requires visual query builder)
- Scope (8 standard reports sufficient for MVP)
- Alternative: Export to Excel/Power BI for custom analysis

---

### ❌ Advanced Analytics

**Not Supported:**
- Predictive modeling (sales forecasting, ROI prediction)
- ML-driven recommendations ("Try reducing CPP by 5%")
- Anomaly detection (automatic outlier flagging)
- Clustering/segmentation (customer similarity analysis)

**Why Deferred:**
- Requires ML infrastructure
- Needs historical data (6-12 months minimum)
- Phase 3 feature (AI/Optimization)

---

### ❌ Real-Time Collaboration

**Not Supported:**
- Shared dashboards with live updates (multiple users viewing)
- Comments on reports
- Scheduled email delivery of reports

**Why Deferred:**
- Operational system, not collaborative BI tool
- Phase 2 feature (Collaboration)

---

## 8.6 Phase 1 Reporting Scope

### ✅ Phase 1 Reporting Features

**Core Reports:**
- ✅ Trade Spend Summary
- ✅ Budget Utilization Report
- ✅ Agreement Status Report
- ✅ Plan Performance Report
- ✅ Planner Performance Report
- ✅ Spend by Tactic Report
- ✅ Executive Dashboard

**Export:**
- ✅ Excel export (formatted, multi-sheet)
- ✅ PDF export (print-ready)
- ✅ CSV export (raw data)

**Drill-Down:**
- ✅ Summary → Detail navigation
- ✅ Breadcrumb trails
- ✅ Filter preservation

**Mode-Aware:**
- ✅ Separate Actuals/Planning reports
- ✅ Combined spend reporting
- ✅ Mode-specific metrics

---

### ❌ Explicitly NOT in Phase 1

**Advanced Reporting:**
- ❌ Custom report builder (drag-and-drop)
- ❌ User-defined metrics
- ❌ Scheduled email delivery
- ❌ Real-time collaboration (shared dashboards)

**Advanced Analytics:**
- ❌ Predictive modeling
- ❌ ML-driven recommendations
- ❌ Anomaly detection
- ❌ Variance analysis (Phase 2, requires actuals import)

**Visualization:**
- ❌ Custom chart creation
- ❌ Geographic heatmaps
- ❌ Network graphs (customer-product relationships)

---

**END OF SECTION 8 - REPORTING & ANALYTICS**

---

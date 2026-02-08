# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 1

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

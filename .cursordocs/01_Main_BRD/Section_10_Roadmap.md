# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 10

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

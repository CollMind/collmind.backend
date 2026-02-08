# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 11

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

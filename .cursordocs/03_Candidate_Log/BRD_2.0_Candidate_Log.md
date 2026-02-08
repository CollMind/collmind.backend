# BRD 2.0 CANDIDATE LOG

**Purpose:**  
This document tracks all design elements, technical hypotheses, and implementation constraints that are explicitly out of scope for BRD v1.0, but are candidates for inclusion in BRD v2.0, subject to validation during Phase 1.

**Scope:** This log tracks all design elements, technical hypotheses, and implementation constraints that are explicitly out of scope for BRD v1.0, but are candidates for inclusion in BRD v2.0, subject to validation during Phase 1.

**Candidate Status Definitions:**
- 🟡 **Hypothesis:** Design assumed but not validated (requires prototype/benchmark)
- 🟡 **Design Constraint:** Requirement identified but not implemented (needs architecture decision)
- 🟡 **Open Design Question:** Multiple approaches possible, decision pending (requires spike/analysis)
- 🟠 **Partially Implemented (Phase 1):** Core logic exists, but validation/testing incomplete
- 🔴 **Risk Identified:** External dependency or blocker that could derail Phase 2

**Status:** Active  
**Owner:** Product  
**Applies to:** CollMind TPM Platform  
**Source Documents:**
- BRD v1.0 (155 pages, 12 sections)
- BRD Addendum – Technical Clarifications (30 pages, 5 HIGH PRIORITY items)
- Engineering Pack (in progress)

---

## GOVERNANCE NOTES

**Candidate Review Process:**
1. All candidates in this log must be reviewed before initiating BRD v2.0
2. No candidate may be merged into BRD v2.0 without:
   - ✅ Validation evidence (prototype, benchmark, user feedback)
   - ✅ Explicit Product sign-off
   - ✅ Engineering feasibility confirmation
3. This log is the **single source of truth** for deferred BRD decisions

**Log Maintenance:**
- Updated weekly during Phase 1
- Reviewed at each Phase Gate
- Archived candidates moved to separate section (with rationale)

---

## CANDIDATE-001: KPI Calculation Engine (Planning-First)

**Source:**
- BRD Addendum §H1 – KPI Engine Performance Validation
- BRD v1.0 Section 5 – Planning-First Mode

**Description:**  
Advanced KPI calculation engine supporting:
- 40+ formula-based KPIs with dependency graphs
- Real-time recalculation triggered by plan input changes
- SKU → FU → Plan aggregation cascade
- <500ms response time for 50 SKUs

**Reason for Deferral:**
- ❌ Not required for Actuals-First MVP (Phase 1)
- ❌ High computational and performance risk without real data validation
- ❌ Formula execution security model unproven
- ❌ No baseline data available to test against

**Current Status:**  
🟡 **Hypothesis** (design assumed, not proven)

**Impact Area:**
- 🔧 Backend (formula execution, dependency resolution)
- 📊 Data (baseline integration, KPI storage)
- ⚡ Performance (P95 <500ms requirement)
- 🎨 UX (planning grid real-time feedback)

**Validation Required:**

| Validation Item | Method | Owner | Timeline |
|----------------|--------|-------|----------|
| Performance benchmark | Prototype with 100 SKUs × 40 KPIs | Engineering | Phase 1 Week 2-3 |
| Dependency graph correctness | Unit tests (topological sort) | Engineering | Phase 1 Week 3 |
| Recalculation scope control | Spike (partial vs full recalc) | Engineering | Phase 1 Week 4 |
| Formula security sandbox | Proof-of-concept (restricted JS) | Security + Eng | Phase 1 Week 4 |
| Baseline data integration | Data availability audit | Data Eng + Product | Phase 1 Week 6 |

**Success Criteria for Promotion to BRD v2.0:**
- ✅ Prototype achieves P95 <500ms (100 SKUs)
- ✅ Load test passes: 10 concurrent users editing plans
- ✅ Formula sandbox prevents malicious code execution
- ✅ Baseline data available (MVB-2: 80% coverage)

**Phase Gate:**  
🔴 **Mandatory for Phase 2 entry**

**Customer Impact:**
- ❌ Not visible in Phase 1 (Actuals-First only)
- ✅ **Critical for Phase 2** (Planning-First experience depends on real-time ROI)
- 🎯 Customer value: "What-if" optimization without Excel, 10-15% ROI improvement
- ⚠️ Risk: If performance fails, Planning-First becomes unusable → customer churn

**Merge Target:**  
BRD v2.0 – Section 5 (Planning-First Mode)

**Owner:**  
Product / Engineering Lead

**Related Candidates:**  
CANDIDATE-002 (Formula Security), CANDIDATE-006 (Recalculation Strategy)

---

## CANDIDATE-002: KPI Formula Execution Sandbox

**Source:**
- BRD Addendum §H5 – Formula Engine Security Controls
- BRD v1.0 Section 9 – Non-Functional Requirements (Security)

**Description:**  
Secure execution environment for admin-configured KPI formulas to prevent:
- Arbitrary code execution (malicious formula injection)
- Infinite loops or resource exhaustion (DoS attacks)
- Tenant data leakage (cross-tenant formula access)

**Proposed Approaches:**
1. **Restricted JavaScript Subset** (recommended):
   - Whitelist allowed functions (Math.*, arithmetic operators)
   - AST validation before execution
   - Execution timeout (1 second)
   
2. **Domain-Specific Language (DSL)**:
   - Custom formula language (e.g., `SUM(kpi.INCR_GP) / SUM(kpi.TOTAL_SPEND)`)
   - Compiled to JavaScript or WASM
   - No arbitrary code execution
   
3. **WebWorker Isolation**:
   - Execute formulas in isolated browser context
   - No access to global variables or localStorage

**Reason for Deferral:**
- ❌ No formula execution in Phase 1 (Actuals-First has no KPI engine)
- ❌ Security model must be validated with real formulas and threat modeling
- ❌ Performance implications of sandboxing unknown

**Current Status:**  
🟡 **Design constraint identified** (not implemented)

**Impact Area:**
- 🔒 Security (malicious code prevention)
- 🔧 Backend (formula execution engine)
- 📋 Compliance (audit logging)

**Validation Required:**

| Validation Item | Method | Owner | Timeline |
|----------------|--------|-------|----------|
| Sandbox approach selection | Architecture spike (3 approaches) | Engineering + Security | Phase 1 Week 3 |
| Formula validation logic | Proof-of-concept (AST parser) | Engineering | Phase 1 Week 4 |
| Execution timeout enforcement | Load test (intentional infinite loops) | Engineering | Phase 1 Week 4 |
| Audit logging completeness | Security review (SIEM integration) | Security | Phase 1 Week 5 |
| Penetration test | External security audit | Security | Phase 1.1 (post-launch) |

**Success Criteria for Promotion to BRD v2.0:**
- ✅ Sandbox prevents all test attack vectors (10+ malicious formulas tested)
- ✅ Performance overhead <50ms per formula execution
- ✅ All formula changes logged in audit trail
- ✅ Security team sign-off

**Phase Gate:**  
🔴 **Mandatory for Phase 2 entry**

**Customer Impact:**
- ❌ Not visible in Phase 1 (no formula execution)
- ✅ **Enables Phase 2 customization** (admins can configure KPIs without code deployment)
- 🎯 Customer value: Self-service KPI management, faster iteration
- ⚠️ Risk: Security breach → data leak, regulatory violation → customer trust loss

**Merge Target:**  
BRD v2.0 – Section 9 (Non-Functional Requirements – Security)

**Owner:**  
Engineering Lead / CISO

**Related Candidates:**  
CANDIDATE-001 (KPI Engine), CANDIDATE-007 (Performance SLA)

---

## CANDIDATE-003: Budget Concurrency & Atomic Reservation Model

**Source:**
- BRD Addendum §H2 – Budget Race Condition Resolution
- BRD v1.0 Section 3.4 – Budget Management

**Description:**  
Guarantees around concurrent budget reservation to prevent race conditions when multiple agreements or plans compete for the same budget envelope:
- Pessimistic locking (SELECT FOR UPDATE) or optimistic locking (version check)
- Atomic reservation transaction (check availability + reserve in single transaction)
- Retry logic for lock contention
- Conflict resolution UI (user informed if budget unavailable after retry)

**Scenario:**
```
Budget Envelope: NKA / Hair Care / Jan 2026
Available: 10,000 TL

10:00:00.000 - Planner A submits agreement (8,000 TL)
10:00:00.100 - Planner B submits agreement (7,000 TL)

Expected Behavior:
- A acquires lock → reserves 8,000 TL → releases lock
- B waits for lock → sees 2,000 TL available → REJECTED
- Result: No overcommitment
```

**Reason for Deferral:**
- ❌ Conceptually defined in BRD v1.0, but not stress-tested
- ❌ Requires real concurrency scenarios (10+ simultaneous users)
- ❌ Database isolation level implications not validated in production-like environment

**Current Status:**  
🟠 **Partially Implemented (Phase 1)** (SQL logic written, load test pending)

**Impact Area:**
- 🔧 Backend (database transaction isolation)
- 💰 Finance (budget integrity)
- ⚡ Performance (lock contention overhead)

**Validation Required:**

| Validation Item | Method | Owner | Timeline |
|----------------|--------|-------|----------|
| Concurrent reservation test | Load test: 5 users, same envelope | Engineering + QA | Phase 1 Week 8 |
| Isolation level confirmation | Database profiling (SERIALIZABLE vs FOR UPDATE) | Engineering | Phase 1 Week 7 |
| Retry behavior validation | Chaos test (simulate lock timeouts) | Engineering | Phase 1 Week 8 |
| Performance impact | Benchmark: single vs concurrent reservations | Engineering | Phase 1 Week 8 |
| Conflict resolution UX | User testing (rejected approval scenario) | Product + UX | Phase 1 Week 9 |

**Phase 1 Action (Sprint 0 - HIGH Priority):**
- ✅ Define minimum concurrent user scenario (5 users minimum - see Sprint 0 Mandatory Items MC-001)
- ✅ Specify locking and retry behavior before implementation
- ✅ Document test acceptance criteria in Engineering Pack
- **Source:** Audit finding MC-001 (Budget concurrency test criteria not defined)

**Success Criteria for Promotion to BRD v2.0:**
- ✅ Load test passes: 10 users, zero overcommitments
- ✅ Lock contention <1% of transactions (acceptable performance)
- ✅ Retry logic handles 95%+ conflicts without user intervention
- ✅ UX validated: users understand rejection reason

**Phase Gate:**  
🟠 **Must be validated before scaling usage** (not blocking Phase 2, but required for production scale)

**Customer Impact:**
- ⚠️ **Visible in Phase 1** (budget overcommitment = Finance audit issue)
- ✅ **Critical for scale** (10+ concurrent users in peak periods)
- 🎯 Customer value: Budget integrity, no overspending surprises
- ⚠️ Risk: Budget overrun → Finance loses trust → manual override → system bypassed

**Merge Target:**  
BRD v2.0 – Section 3 (Core Components – Budget Management)  
BRD v2.0 – Section 9 (Non-Functional Requirements – Performance)

**Owner:**  
Engineering Lead

**Related Candidates:**  
None (standalone validation)

---

## CANDIDATE-004: Approval State Machine – Edge Cases

**Source:**
- BRD Addendum §H3 – Approval Workflow State Machine Specification
- BRD v1.0 Section 4.3 – Approval Workflow (Actuals-First)
- BRD v1.0 Section 5.6 – Approval Workflow (Planning-First)

**Description:**  
Explicit definition of approval state transitions, including:
- Valid transitions (DRAFT → PENDING → APPROVED, REJECTED → DRAFT, etc.)
- Invalid transitions (APPROVED → any state is terminal)
- Budget side effects per transition (RESERVE on approval, RELEASE on cancellation)
- Timeout/expiration behavior (7-day auto-expire for stale approvals)
- Who can trigger which transitions (requester can cancel, approver cannot cancel)

**Edge Cases to Validate:**
1. **Rejection → Resubmission:**
   - Can rejected agreement/plan return to PENDING without going through DRAFT?
   - Does budget check happen again on resubmission?
   
2. **Cancellation After Approval:**
   - Can requester cancel APPROVED agreement before execution?
   - Is budget RELEASED immediately or on next ledger sync?
   
3. **Partial Approval (Multi-Level):**
   - What if Level 1 approves but Level 2 rejects?
   - Is budget reserved at Level 1 or only after all levels approve?
   
4. **Concurrent Approval Attempts:**
   - Two approvers click "Approve" simultaneously (same agreement)
   - Expected: One succeeds, one gets "Already approved" error

**Reason for Deferral:**
- ❌ Core flow defined in BRD v1.0 (sufficient for Phase 1 happy path)
- ❌ Edge cases depend on real usage patterns (cannot be fully enumerated without production data)
- ❌ State machine diagram exists (Addendum §H3) but needs real-world validation

**Current Status:**  
🟠 **Partially Implemented (Phase 1)** (happy path complete, edge cases pending UAT validation)

**Impact Area:**
- 🔧 Backend (state machine logic)
- 💰 Finance (budget side effects)
- 🎨 UX (approval flow, rejection/cancellation)

**Validation Required:**

| Validation Item | Method | Owner | Timeline |
|----------------|--------|-------|----------|
| State transition testing | Integration tests (all transitions) | Engineering | Phase 1 Week 10 |
| Budget side effects validation | Ledger integrity tests | Engineering | Phase 1 Week 10 |
| Edge case observation | UAT feedback collection | Product | Phase 1 Week 13 |
| Timeout behavior test | Automated job test (7-day expiry) | Engineering | Phase 1 Week 11 |

**Success Criteria for Promotion to BRD v2.0:**
- ✅ All state transitions tested (15+ test cases)
- ✅ Budget integrity maintained across all edge cases
- ✅ UAT identifies no "surprising" state behavior
- ✅ Expiration job runs successfully for 2 weeks

**Phase Gate:**  
🟢 **Phase 2 refinement** (not blocking Phase 2, but should be documented for Planning-First)

**Customer Impact:**
- ✅ **Visible in Phase 1** (approval workflow is core user experience)
- 🟢 **Enhancement for Phase 2** (more complex multi-level approvals)
- 🎯 Customer value: Predictable approval behavior, clear rejection reasons
- ⚠️ Risk: Edge case bugs → frustrated approvers → workarounds → audit trail gaps

**Merge Target:**  
BRD v2.0 – Section 4 (Actuals-First Mode – Approval Workflow)  
BRD v2.0 – Section 5 (Planning-First Mode – Approval Workflow)

**Owner:**  
Product Owner / Engineering Lead

**Related Candidates:**  
CANDIDATE-003 (Budget Concurrency)

---

## CANDIDATE-005: Baseline Data Readiness Definition

**Source:**
- BRD Addendum §H4 – Baseline Data Extraction Plan
- BRD v1.0 Section 11.1 – Assumptions (A9: Baseline Data Exists)

**Description:**  
Minimum data requirements (time range, coverage, granularity) required to activate Planning-First Mode:

**Minimum Viable Baseline (MVB) Levels:**

| Level | SKU Coverage | Time Range | Granularity | Phase 2 Capability |
|-------|--------------|------------|-------------|-------------------|
| **MVB-1** | 50% | 6 months | Customer × SKU × Month | Limited planning (top SKUs only) |
| **MVB-2** | 80% | 6 months | Customer × SKU × Week | Standard planning (most products) |
| **MVB-3** | 95% | 12 months | Customer × SKU × Week | Full planning (all products) |

**Quality Requirements:**
- No duplicate records (customer + SKU + period uniqueness)
- No null values in critical fields (customer_id, sku, volume, period)
- Volume values ≥0 (negative volumes rejected)
- Date ranges consistent (no gaps in weekly periods)

**Reason for Deferral:**
- ❌ Depends on customer data availability (external dependency)
- ❌ Cannot be guaranteed at Phase 1 start (ERP data extraction timeline uncertain)
- ❌ Quality issues discovered only during extraction process

**Current Status:**  
🔴 **Risk identified** (blocking risk for Phase 2)

**Impact Area:**
- 📊 Data (baseline extraction, quality)
- 🔧 Backend (baseline import, validation)
- 🎨 UX (degraded-mode planning for missing baseline)

**Validation Required:**

| Validation Item | Method | Owner | Timeline |
|----------------|--------|-------|----------|
| Data availability audit | ERP/DW schema review | Data Engineering | Phase 1 Week 1 |
| Sample extraction | 1 month × 100 SKUs | Data Engineering | Phase 1 Week 2 |
| Quality assessment | Validation script execution | Data Engineering | Phase 1 Week 3 |
| Coverage calculation | SQL query on full dataset | Data Engineering | Phase 1 Week 4 |
| Import test | Load into CollMind staging | Data Engineering | Phase 1 Week 5 |
| **MVB-2 Gate** | 80% coverage confirmed | Product Owner | Phase 1 Week 6 |

**Success Criteria for Promotion to BRD v2.0:**
- ✅ MVB-2 achieved (80% SKU coverage, 6 months, weekly granularity)
- ✅ Data quality ≥95% (no critical errors)
- ✅ Import successful (zero validation errors)
- ✅ Degraded-mode planning tested (for SKUs without baseline)

**Phase Gate:**  
🔴 **Mandatory for Planning-First activation** (blocks Phase 2 if not achieved)

**Customer Impact:**
- ❌ Not visible in Phase 1 (Actuals-First only)
- 🔴 **Phase 2 BLOCKER** (no baseline = no Planning-First)
- 🎯 Customer value: ROI optimization depends on historical volume data
- ⚠️ Risk: Baseline unavailable → Phase 2 delayed 2-3 months → customer expectations unmet

**Merge Target:**  
BRD v2.0 – Section 10 (Phased Delivery & Roadmap – Phase 2 Prerequisites)

**Owner:**  
Product Owner / Data Engineering Lead

**Related Candidates:**  
CANDIDATE-001 (KPI Engine requires baseline for ROI calculation)

---

## CANDIDATE-006: KPI Recalculation Strategy (Incremental vs Full)

**Source:**
- BRD Addendum §H1 – KPI Engine Performance Notes
- BRD v1.0 Section 5.4 – KPI Calculation Engine

**Description:**  
Strategy for recalculating KPIs when upstream data changes:

**Option A: Incremental Recalculation**
```
User changes: Planned Volume for 1 SKU
Recalculation scope:
1. Recalculate only affected SKU KPIs (10 KPIs)
2. Recalculate parent FU aggregates (5 KPIs)
3. Recalculate Plan totals (5 KPIs)
Total: 20 KPI recalculations
```

**Option B: Full Recalculation**
```
User changes: Planned Volume for 1 SKU
Recalculation scope:
1. Recalculate ALL SKU KPIs (50 SKUs × 40 KPIs = 2,000)
2. Recalculate ALL FU aggregates
3. Recalculate Plan totals
Total: 2,000+ KPI recalculations
```

**Trade-offs:**

| Approach | Performance | Complexity | Correctness Risk |
|----------|------------|------------|------------------|
| **Incremental** | ✅ Fast (<100ms) | ⚠️ Complex (dependency tracking) | ⚠️ Medium (miss transitive deps) |
| **Full** | ⚠️ Slow (>500ms) | ✅ Simple (always correct) | ✅ Low (guaranteed correct) |

**Reason for Deferral:**
- ❌ No KPI recalculation in Phase 1 (Actuals-First has no KPI engine)
- ❌ Performance implications unknown (depends on dependency graph complexity)
- ❌ Correctness validation requires extensive testing

**Current Status:**  
🟡 **Open design question** (not decided)

**Impact Area:**
- 🔧 Backend (recalculation logic, change tracking)
- ⚡ Performance (incremental vs full recalc trade-off)
- 🎨 UX (perceived responsiveness)

**Validation Required:**

| Validation Item | Method | Owner | Timeline |
|----------------|--------|-------|----------|
| Dependency graph complexity | Spike: 40 KPIs, map dependencies | Engineering | Phase 1 Week 3 |
| Incremental recalc POC | Prototype with change tracking | Engineering | Phase 1 Week 4 |
| Performance profiling | Benchmark: incremental vs full | Engineering | Phase 1 Week 4 |
| Correctness validation | 100+ test cases (KPI consistency) | Engineering | Phase 1 Week 5 |

**Success Criteria for Promotion to BRD v2.0:**
- ✅ Approach selected (incremental or full) with rationale
- ✅ Performance target met (<500ms for chosen approach)
- ✅ Correctness validated (no transitive dependency bugs)
- ✅ Fallback strategy defined (if incremental fails, fall back to full)

**Phase Gate:**  
🟠 **Phase 2 design decision** (must be decided before Phase 2 Week 3)

**Customer Impact:**
- ❌ Not visible in Phase 1
- ✅ **Affects Phase 2 UX** (perceived responsiveness of planning grid)
- 🎯 Customer value: Instant feedback on ROI changes → better optimization
- ⚠️ Risk: Wrong choice → slow UI (>1s) → planners frustrated → Excel fallback

**Merge Target:**  
BRD v2.0 – Section 5 (Planning-First Mode – KPI Calculation Engine)

**Owner:**  
Engineering Lead

**Related Candidates:**  
CANDIDATE-001 (KPI Engine), CANDIDATE-007 (Performance SLA)

---

## CANDIDATE-007: KPI Engine SLA & Performance Targets

**Source:**
- BRD Addendum §H1 – KPI Engine Performance Validation
- BRD v1.0 Section 9.1 – Performance Requirements

**Description:**  
Formal SLA definitions for KPI computation latency under different data volumes:

**Proposed SLA Tiers:**

| Data Volume | P50 (Median) | P95 (95th %ile) | P99 (99th %ile) | Max Acceptable |
|-------------|--------------|-----------------|-----------------|----------------|
| **Small** (10 SKUs) | <100ms | <200ms | <300ms | 500ms |
| **Medium** (50 SKUs) | <300ms | <500ms | <800ms | 1,000ms |
| **Large** (100 SKUs) | <500ms | <800ms | <1,200ms | 2,000ms |
| **X-Large** (200 SKUs) | <1,000ms | <2,000ms | <3,000ms | 5,000ms |

**User Experience Implications:**
- P50 <300ms: Feels instant (no perceived delay)
- P95 <500ms: Acceptable (user notices slight delay)
- P99 <1,000ms: Tolerable (user may perceive lag)
- >2,000ms: Unacceptable (user abandons action)

**Reason for Deferral:**
- ❌ Phase 1 KPIs are simple aggregates (no complex formulas)
- ❌ Advanced SLAs depend on Phase 2 architecture (client vs server calculation)
- ❌ Performance targets are indicative only (not contractually binding)

**Current Status:**  
🟡 **Indicative only** (not enforced in Phase 1)

**Impact Area:**
- ⚡ Performance (SLA definition, monitoring)
- 🔧 Backend (latency optimization)
- 📊 Operations (alerting, dashboards)

**Validation Required:**

| Validation Item | Method | Owner | Timeline |
|----------------|--------|-------|----------|
| Benchmark execution | Load test: 10, 50, 100, 200 SKUs | Engineering | Phase 1 Week 3 |
| P95/P99 measurement | Performance profiling (10K requests) | Engineering | Phase 1 Week 4 |
| SLA feasibility analysis | Architecture review (client vs server) | Engineering Lead | Phase 1 Week 4 |
| Monitoring setup | Datadog/NewRelic KPI latency dashboard | DevOps | Phase 1 Week 11 |

**Success Criteria for Promotion to BRD v2.0:**
- ✅ SLA targets validated with benchmark data
- ✅ Monitoring in place (P50/P95/P99 tracked in production)
- ✅ Fallback strategy defined (if SLA breached, what happens?)
- ✅ User communication plan (SLA published in UI or docs)

**Phase Gate:**  
🟠 **Phase 2 readiness** (SLA must be defined before Phase 2 public launch)

**Customer Impact:**
- ❌ Not visible in Phase 1 (no Planning-First)
- ✅ **Transparency for Phase 2** (customers know expected performance)
- 🎯 Customer value: Predictable experience, no surprises
- ⚠️ Risk: Undefined SLA → customer expectations mismatch → "system is slow" complaints

**Merge Target:**  
BRD v2.0 – Section 9 (Non-Functional Requirements – Performance SLA)

**Owner:**  
Engineering Lead / Product Owner

**Related Candidates:**  
CANDIDATE-001 (KPI Engine), CANDIDATE-006 (Recalculation Strategy)

---

## ARCHIVED CANDIDATES

**Purpose:** Candidates that were considered but rejected, or merged into BRD v1.0 during development.

**Format:**
```
ARCHIVED-XXX: [Candidate Name]
Reason: [Rejected | Merged to BRD v1.0 | Superseded by CANDIDATE-YYY]
Date: YYYY-MM-DD
Rationale: [Brief explanation]
```

**Current Archived Count:** 0 (no candidates archived yet)

**Example Format (for future reference):**

```
ARCHIVED-001: KPI Caching Strategy
Status: Superseded by CANDIDATE-006 (Recalculation Strategy)
Date: 2026-01-15
Rationale: Initial design proposed Redis caching for KPI values, but 
performance benchmarks showed client-side recalculation with dependency 
tracking is faster and simpler. Caching adds complexity without benefit 
for <100 SKU plans.
Decision: Implement incremental recalculation instead of caching.
```

---

## CANDIDATE SUMMARY

**Total Active Candidates:** 7

| ID | Title | Priority | Phase Gate | Owner |
|----|-------|----------|------------|-------|
| **001** | KPI Calculation Engine | 🔴 Critical | Phase 2 entry | Engineering |
| **002** | Formula Execution Sandbox | 🔴 Critical | Phase 2 entry | Security + Eng |
| **003** | Budget Concurrency Model | 🟠 High | Scale validation | Engineering |
| **004** | Approval State Machine Edge Cases | 🟢 Medium | Phase 2 refinement | Product |
| **005** | Baseline Data Readiness | 🔴 Critical | Phase 2 blocker | Data Eng |
| **006** | KPI Recalculation Strategy | 🟠 High | Phase 2 design | Engineering |
| **007** | KPI Engine Performance SLA | 🟠 High | Phase 2 readiness | Engineering |

**Phase Gate Summary:**
- 🔴 **Mandatory for Phase 2 entry:** 3 candidates (001, 002, 005)
- 🟠 **High priority validation:** 3 candidates (003, 006, 007)
- 🟢 **Refinement/enhancement:** 1 candidate (004)

---

## REVIEW SCHEDULE

**Weekly Review (During Phase 1):**
- Owner: Product Owner + Engineering Lead
- Cadence: Every Monday, 10:00 AM
- Agenda:
  1. Review validation progress for each candidate
  2. Update status (hypothesis → validated → promoted)
  3. Identify blockers or risks
  4. Adjust timelines if needed

**Phase Gate Review:**
- Phase 1 Week 6: MVB-2 Gate (CANDIDATE-005)
- Phase 1 Week 13: Phase 2 Go/No-Go (ALL CANDIDATES)
- Phase 2 Entry: BRD v2.0 Kickoff (merge validated candidates)

---

## NEXT ACTIONS

**Immediate (Phase 1 Week 1):**
- [ ] Data Engineering: Begin baseline data audit (CANDIDATE-005)
- [ ] Engineering: Plan KPI engine prototype (CANDIDATE-001)
- [ ] Security: Review formula sandbox approaches (CANDIDATE-002)

**Short-term (Phase 1 Week 2-4):**
- [ ] Engineering: Execute KPI engine spike (CANDIDATE-001)
- [ ] Engineering: Build formula sandbox POC (CANDIDATE-002)
- [ ] Engineering: Test budget concurrency (CANDIDATE-003)

**Mid-term (Phase 1 Week 5-8):**
- [ ] Data Engineering: Deliver MVB-2 baseline (CANDIDATE-005)
- [ ] Engineering: Load test concurrency model (CANDIDATE-003)
- [ ] Engineering: Decide recalculation strategy (CANDIDATE-006)

**Pre-Phase 2 (Phase 1 Week 9-13):**
- [ ] Product: Review approval edge cases from UAT (CANDIDATE-004)
- [ ] Engineering: Finalize KPI engine SLA (CANDIDATE-007)
- [ ] All: Validate all CRITICAL candidates before Phase 2 Gate

---

**END OF BRD 2.0 CANDIDATE LOG**

**Document Status:** ✅ Active  
**Last Updated:** January 7, 2026  
**Next Review:** Phase 1 Week 1 (Monday standup)  
**Owner:** Product Owner + Engineering Lead

---

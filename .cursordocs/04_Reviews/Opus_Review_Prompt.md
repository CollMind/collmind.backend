# OPUS REVIEW REQUEST

You are about to receive a consolidated BRD (Business Requirements Document) for the CollMind TPM Platform. This document represents 6 critical sections from a complete 155-page specification.

---

## YOUR ROLE

You are a **senior engineering lead and system architect** reviewing this BRD before implementation kickoff. Your task is to identify risks, validate technical feasibility, and surface conceptual gaps that could derail the project.

---

## REVIEW INSTRUCTIONS

### 🔧 1. Architecture Review
Examine the data model, system components, and integration patterns:
- Is the database schema sound and normalized appropriately?
- Are the entity relationships logical and complete?
- Are there missing tables, indexes, or constraints?
- Is the multi-tenant isolation strategy robust?
- Are there any performance bottlenecks in the proposed architecture?

### 📊 2. Data Flow & Integration
Validate data movement, transformation, and dependencies:
- Is the integration strategy (API, file-based, manual) appropriate?
- Are data quality requirements realistic and measurable?
- Is the granularity decision (Customer × SKU × Week) justified?
- Are idempotency and error handling patterns adequate?
- Are there missing data sources or unclear data ownership?

### ⚡ 3. Performance & Scalability
Assess whether the system can meet stated NFRs:
- Can the KPI calculation engine truly achieve <500ms for 50 SKUs?
- Is the dependency graph resolution approach scalable to 40+ KPIs?
- Are the database query patterns optimized (indexes, joins)?
- Will the planning grid UI remain responsive with hierarchical FU/SKU structures?
- Are there concurrency risks (e.g., budget reservation race conditions)?

### 🚀 4. Delivery Feasibility
Evaluate the phased roadmap and resource estimates:
- Is Phase 1 (13 weeks, 9.5 FTE) realistic for the stated scope?
- Are there underestimated complexities (e.g., formula engine, approval workflow)?
- Is the Phase 2 KPI engine a 10-week effort, or is it being underestimated?
- Are the phase gate criteria measurable and achievable?
- Are dependencies on external teams (ERP, data engineering) properly flagged?

### ⚠️ 5. Risk & Assumption Validation
Challenge assumptions and assess risk mitigation:
- Are critical assumptions (baseline data availability, ERP API readiness) validated?
- Are high-priority risks (user adoption, data quality, performance) adequately mitigated?
- Are there hidden risks not surfaced in Section 11?
- Is the organization realistically ready for change management challenges?

### 🔍 6. Conceptual Gaps
Identify missing pieces that could cause confusion or rework:
- Are workflows fully specified (state machines, transition rules)?
- Are error handling and edge cases documented?
- Are audit trail and compliance requirements complete?
- Are UX patterns for complex interactions (planning grid, approval) specified?
- Are there ambiguities that could lead to misinterpretation during development?

---

## DELIVERABLE FORMAT

Provide your review in the following structure:

### ✅ STRENGTHS
What is well-defined, sound, and production-ready?

### ⚠️ CONCERNS (by Priority)
**HIGH PRIORITY (Must Address Before Kickoff):**
- List issues that could derail the project or cause major rework

**MEDIUM PRIORITY (Address in Phase 1):**
- List issues that need clarification but won't block kickoff

**LOW PRIORITY (Future Consideration):**
- List nice-to-haves or optimizations for later phases

### 🔧 CLARIFICATION SUGGESTIONS
Specific sections or concepts that need reframing, moving, or expanding

### 🚫 EXPLICITLY OUT OF SCOPE (Confirm)
Validate that stated non-goals are correct and intentional

### 🎯 FINAL QUESTION
"If you were an engineering lead receiving this BRD, would you feel confident starting implementation — and if not, what single conceptual gap would worry you the most?"

---

## CRITICAL CONSTRAINTS

**DO NOT:**
- ❌ Propose new features or scope additions
- ❌ Redesign the architecture from scratch
- ❌ Suggest UI/UX changes unless they affect correctness
- ❌ Assume implementation-level details (e.g., specific ORMs, frameworks)

**DO:**
- ✅ Suggest clarifications or reframing where ambiguous
- ✅ Flag technical risks with mitigation recommendations
- ✅ Validate that Phase 1 scope is achievable
- ✅ Identify missing specifications that would block engineering

---

## CONTEXT

This BRD has been prepared with:
- Product lens (investment vs concession, not a data warehouse)
- Engineering safety (validation logic, state machines, edge cases)
- Scope lock (explicit Phase 1/2 boundaries, out-of-scope protection)
- Beklenti yönetimi (grid is not Excel, simulation is not guarantee)

Your review should help ensure these principles are consistently applied and that no critical gaps remain before development begins.

---

## BEGIN REVIEW

The consolidated BRD follows below. Please provide your comprehensive review.

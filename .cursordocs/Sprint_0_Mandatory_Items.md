# SPRINT 0 MANDATORY ITEMS
## Derived from BRD Audit - HIGH Priority Findings

**Date:** January 7, 2026  
**Status:** 🔴 MUST BE COMPLETED BEFORE PHASE 1 WEEK 1  
**Source:** CollMind BRD Audit Report (Comprehensive Review)  
**Owner:** Engineering Lead + Product Owner

---

## 🎯 EXECUTIVE SUMMARY

**Audit Conclusion:** ✅ Phase 1 Implementation-Ready  
**Blockers:** ❌ None (no critical issues)  
**Action Required:** ⚠️ 4 HIGH items must be clarified in Sprint 0

**Timeline:** Sprint 0 (before Phase 1 Week 1 kickoff)

---

## 🔴 HIGH PRIORITY ITEMS (4 MANDATORY)

These items are **operational details** that must be defined before implementation. They do **NOT require BRD changes** - they belong in the **Engineering Pack**.

---

### **AI-001: Off-Invoice Batch Import Error Handling**

**Finding:**
> "Error handling strategy for batch imports is underspecified. What happens when 5 of 50 rows fail validation? All-or-nothing vs partial success behavior?"

**Risk:** Data integrity issues, user confusion, manual cleanup required

**Action Required:**

**Define in Engineering Pack:**
```markdown
## Off-Invoice Batch Import Error Handling

### Strategy: Partial Success with Error Report

**Behavior:**
1. Validation runs on all rows BEFORE any insert
2. Invalid rows are rejected (logged with reason)
3. Valid rows are committed to database
4. User receives:
   - Success count (e.g., 45/50 imported)
   - Error report (CSV with failed rows + reasons)
   - Option to fix and re-import failed rows

**Validation Rules:**
- Required fields: invoice_date, customer_id, sku, amount
- Date format: YYYY-MM-DD
- Amount: numeric, positive
- Customer/SKU: must exist in master data

**Error Report Format:**
CSV with columns:
- row_number
- error_type (MISSING_FIELD, INVALID_DATE, INVALID_AMOUNT, etc.)
- error_message
- original_row_data

**User Experience:**
- Import button → Processing → Results screen
- Green: "45 invoices imported successfully"
- Red: "5 invoices failed validation"
- Download link: "Download error report (5 rows)"
- Action: "Fix errors and re-import"

**Edge Cases:**
- Empty file → Error: "File contains no data"
- All rows invalid → Error: "No valid rows found"
- Duplicate invoices → Skip with warning: "Already exists"
```

**Owner:** Backend Engineer + UX Designer  
**Timeline:** Sprint 0 Week 1  
**Deliverable:** Engineering Pack - Workflows section

---

### **MC-001: Budget Concurrency Test Criteria**

**Finding:**
> "Budget reservation concurrency testing criteria not defined. How many simultaneous users? What's acceptable lock contention rate?"

**Risk:** Concurrent budget reservation failures in production, overcommitment

**Action Required:**

**Define in Engineering Pack:**
```markdown
## Budget Concurrency Test Criteria

### Minimum Test Scenario: 5 Concurrent Users

**Scope:** Budget concurrency guarantees apply **per envelope**, not globally. Multiple envelopes can be reserved simultaneously without contention.

**Test Setup:**
- Budget envelope: 10,000 TL available
- 5 users submit agreements simultaneously
- Each requests: 2,500 TL (total demand: 12,500 TL)

**Expected Behavior:**
- 4 agreements APPROVED (10,000 TL reserved)
- 1 agreement REJECTED (insufficient budget)
- Final available: 0 TL
- Zero overcommitment (critical!)

**Concurrency Model:**
- Same envelope: Serialized (one at a time, pessimistic lock)
- Different envelopes: Parallel (no contention)
- Example: User A reserves from "NKA/Hair/Jan" while User B reserves from "Traditional/Skin/Jan" → both succeed immediately

**Acceptance Criteria:**
✅ No budget overcommitment across 10 test runs
✅ Lock contention <2% of transactions (acceptable latency)
✅ Rejected users see clear error: "Insufficient budget available"
✅ Approved users receive immediate confirmation

**Load Test (Phase 1.1):**
- 10 concurrent users
- 20 concurrent users (peak scenario)
- 50 concurrent users (stress test - optional)

**Performance Target:**
- Pessimistic lock wait time: <500ms (P95)
- Retry logic: 3 attempts with exponential backoff
- Timeout: 5 seconds max wait

**Implementation:**
- Database isolation level: SERIALIZABLE
- Locking strategy: SELECT FOR UPDATE on budget_envelopes
- Retry on lock timeout (user-transparent)
```

**Owner:** Backend Engineer + QA  
**Timeline:** Sprint 0 Week 1 (define) → Phase 1 Week 8 (test)  
**Deliverable:** Engineering Pack - Testing Scenarios section

---

### **MC-002: Notification Specification**

**Finding:**
> "Notification system lacks specification. What triggers? Content/templates? In-app vs email? Escalation rules?"

**Risk:** Critical events (approval requests, budget alerts) missed by users

**Action Required:**

**Define in Engineering Pack:**
```markdown
## Notification Specification

### Phase 1 Notification Types (6 Core Events)

| Event | Trigger | Recipient | Channel | Priority |
|-------|---------|-----------|---------|----------|
| **Approval Requested** | Agreement submitted | Approver | Email + In-App | HIGH |
| **Approval Granted** | Approver approves | Requester | Email + In-App | MEDIUM |
| **Approval Rejected** | Approver rejects | Requester | Email + In-App | HIGH |
| **Budget Alert (80%)** | Envelope 80% consumed | Budget Owner | Email | MEDIUM |
| **Budget Alert (100%)** | Envelope 100% consumed | Budget Owner + Finance | Email | HIGH |
| **Agreement Expiring** | 5 days before end | Agreement Owner | Email | LOW |

### Email Templates

**Template: Approval Requested**
```
Subject: [Action Required] Agreement Approval: {agreement_name}

Hi {approver_name},

An agreement requires your approval:

Agreement: {agreement_name}
Requester: {requester_name}
Customer: {customer_name}
Amount: {total_amount} TL
Budget: {budget_envelope}

[Approve] [Reject] [View Details]

This request will expire in 7 days if not actioned.
```

**Template: Budget Alert (80%)**
```
Subject: [Budget Alert] {budget_envelope} is 80% consumed

Hi {budget_owner_name},

Budget envelope "{budget_envelope}" has reached 80% utilization:

Allocated: {allocated_amount} TL
Consumed: {consumed_amount} TL ({consumption_pct}%)
Available: {available_amount} TL

Recent reservations:
- {recent_agreement_1}
- {recent_agreement_2}

[View Budget Details]
```

### In-App Notifications

**Notification Center:**
- Bell icon (header)
- Badge count (unread)
- List view (last 30 days)
- Mark as read/unread
- Filter by type

**Real-Time Delivery:**
- WebSocket connection
- Toast notification (top-right)
- Auto-dismiss after 5 seconds (or user click)

### Escalation Rules

**Approval Requests:**
- Day 5: Reminder email to approver
- Day 7: Auto-expire + notify requester

**Budget Alerts:**
- 80%: Notify budget owner
- 95%: Notify budget owner + Finance Director
- 100%: Notify budget owner + Finance Director + Product Owner

### Phase 2 (Future):**
- SMS notifications (optional)
- Slack/Teams integration
- Custom notification preferences
```

**Owner:** Backend Engineer + Product Owner  
**Timeline:** Sprint 0 Week 1 (templates) → Phase 1 Week 6 (implementation)  
**Deliverable:** Engineering Pack - Workflows section

---

### **EA-001: Admin Role Restrictions**

**Finding:**
> "Admin capabilities described but not all restrictions clear. Should admins be able to approve their own agreements? Delete historical data?"

**Risk:** Security vulnerabilities, audit trail gaps, data integrity issues

**Action Required:**

**Define in Engineering Pack:**
```markdown
## Admin Role Restrictions

### Admin Capabilities (Permitted)

**System Configuration:**
✅ Create/edit budget envelopes
✅ Configure KPI definitions
✅ Manage user roles and permissions
✅ Configure approval workflows
✅ View all agreements/plans (read-only)
✅ Generate system-wide reports
✅ Export audit logs

**Data Management:**
✅ Import master data (customers, products)
✅ Bulk user operations (create, deactivate)

### Admin Restrictions (Prohibited)

**Self-Approval:**
❌ Admins CANNOT approve agreements they created
❌ Admins CANNOT bypass approval workflows
❌ Admins CANNOT modify their own role permissions

**Data Modification:**
❌ Admins CANNOT delete approved agreements
❌ Admins CANNOT delete consumed budget transactions
❌ Admins CANNOT modify ledger entries (append-only)
❌ Admins CANNOT delete audit logs

**Financial Actions:**
❌ Admins CANNOT create agreements (must use Planner role)
❌ Admins CANNOT commit budget (Finance role required)

### Audit Logging (Admin Actions)

**All admin actions logged:**
- Timestamp
- Admin user ID + email
- Action type (CREATE, UPDATE, DELETE, APPROVE, etc.)
- Entity affected (agreement_id, user_id, etc.)
- Before/after values (for updates)
- IP address
- Result (SUCCESS, FAILURE)

**High-Risk Admin Actions (Alert):**
- Role permission changes → Alert: Security team
- Bulk user deactivations (>10) → Alert: Product Owner
- Budget envelope deletions → Alert: Finance Director

### Separation of Duties

**Required for sensitive operations:**
- Budget allocation: Requires Finance Approver role (not Admin)
- Agreement approval: Requires Approver role (Admin can view, not approve)
- User role changes: Requires Super Admin (separate from Admin)

### Admin Accountability

**Monthly Review:**
- Product Owner reviews admin action log
- Security team reviews role changes
- Finance reviews budget modifications

**Justification Required:**
- Budget envelope changes >100,000 TL → Justification note mandatory
- User role escalations → Approval from Super Admin
```

**Owner:** Security Lead + Backend Engineer  
**Timeline:** Sprint 0 Week 1  
**Deliverable:** Engineering Pack - Security & RBAC section

---

## 📋 SPRINT 0 CHECKLIST

**Before Phase 1 Week 1 kickoff, confirm:**

- [ ] **AI-001:** Off-invoice error handling documented in Engineering Pack
- [ ] **MC-001:** Budget concurrency test criteria defined
- [ ] **MC-002:** Notification spec (6 events + templates) documented
- [ ] **EA-001:** Admin restrictions and audit logging specified

**Review & Sign-off:**
- [ ] Engineering Lead reviewed all 4 items
- [ ] Product Owner approved notification spec (MC-002)
- [ ] Security Lead approved admin restrictions (EA-001)
- [ ] QA Lead approved test criteria (MC-001)

---

## 🎯 INTEGRATION WITH OTHER DOCS

**Where These Belong:**

| Item | Engineering Pack Section | Related BRD Section |
|------|--------------------------|---------------------|
| **AI-001** | Workflows → Off-Invoice Import | Section 4.4 |
| **MC-001** | Testing Scenarios → Concurrency | Section 3.4 (Budget) |
| **MC-002** | Workflows → Notifications | Section 4.3, 5.6 (Approvals) |
| **EA-001** | Security & RBAC → Admin Controls | Section 7 (Security) |

**Reference in BRD v2.0 Candidate Log:**
- Add to CANDIDATE-004 (Approval edge cases) → MC-002 escalation
- Add to CANDIDATE-003 (Budget concurrency) → MC-001 test criteria

---

## ⚠️ WHAT DOES NOT NEED TO BE DONE

**BRD v1.0 remains LOCKED:**
- ❌ No BRD sections rewritten
- ❌ No "BRD Addendum 2"
- ❌ No scope expansion

**These are operational details:**
- ✅ Part of normal Sprint 0 preparation
- ✅ Expected for any production implementation
- ✅ Not product scope changes

---

## 🚀 NEXT STEPS

**Sprint 0 Week 1:**
1. Engineering Lead assigns owners for 4 items
2. Each owner drafts spec in Engineering Pack format
3. Review session (2 hours): Product + Engineering + Security
4. Sign-off on all 4 specs
5. Mark Sprint 0 checklist complete

**Phase 1 Week 1:**
- Begin implementation with clear operational guidelines
- No ambiguity on error handling, concurrency, notifications, admin controls

---

**END OF SPRINT 0 MANDATORY ITEMS**

**Status:** 🔴 ACTION REQUIRED  
**Deadline:** Before Phase 1 Week 1 kickoff  
**Owner:** Engineering Lead (coordination)  
**Document Location:** Engineering Pack (to be created)

---

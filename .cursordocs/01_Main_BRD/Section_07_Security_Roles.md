# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 7

---

# 7. SECURITY, ROLES & PERMISSIONS

## Introduction

This section defines **who can do what, in which context** within CollMind TPM. It establishes the role model, capability-based permissions, approval authority, and audit requirements necessary for enterprise-grade access control.

**Scope:** This section covers role definitions, permission models, approval authority logic, and audit trails. It does NOT prescribe specific IAM (Identity & Access Management) vendors, SSO configurations, or UI-level permission matrices — those are implementation details.

**Why This Matters:**
- **Security:** Prevents unauthorized access to sensitive financial data
- **Compliance:** Enables audit trails for financial transactions
- **Governance:** Enforces separation of duties (planner ≠ approver)
- **Scalability:** Supports multi-tenant, multi-role organizations

---

## 7.1 Role Model

CollMind uses a **capability-based role model** where roles grant access to capabilities, not just screens. This allows fine-grained control: a user can create plans but not approve them, view budgets but not modify them, etc.

### Core Roles (Phase 1)

#### Role 1: Planner

**Primary Responsibility:** Create and manage promotional plans (Planning-First) and agreements (Actuals-First)

**Capabilities:**
- ✅ Create plans (Planning-First Mode)
- ✅ Create agreements (Actuals-First Mode)
- ✅ Edit draft plans/agreements (own records only)
- ✅ Submit plans/agreements for approval
- ✅ View approved plans/agreements (within scope)
- ✅ Import off-invoice batches (Actuals-First)
- ✅ View budget utilization (read-only)
- ❌ Approve plans/agreements (separation of duties)
- ❌ Modify approved records
- ❌ Configure budgets, tactics, or KPIs

**Scope Constraints:**
- Channel-based: Can only create plans/agreements for assigned channels (e.g., NKA Planner → NKA only)
- Region-based (optional): Can only work on assigned regions
- CPL-based (optional): Can only plan for assigned customer groups

**Typical Users:**
- Category Managers
- Key Account Managers
- Regional Sales Managers

---

#### Role 2: Approver (Category Manager)

**Primary Responsibility:** Review and approve plans/agreements based on commercial merit and ROI

**Capabilities:**
- ✅ View pending approval requests (within scope)
- ✅ Approve plans/agreements (Level 1)
- ✅ Reject plans/agreements with comments
- ✅ Request changes (send back to planner)
- ✅ View approved plans/agreements (within scope)
- ✅ View budget utilization (read-only)
- ❌ Create or edit plans/agreements
- ❌ Approve own submissions (conflict of interest)
- ❌ Bypass approval workflow

**Scope Constraints:**
- Channel-based: Can only approve for assigned channels
- Amount threshold: May have approval limits (e.g., up to 50K TL)

**Typical Users:**
- Senior Category Managers
- Channel Directors
- Trade Marketing Managers

---

#### Role 3: Finance Approver

**Primary Responsibility:** Validate budget availability, ensure financial compliance, final approval gate

**Capabilities:**
- ✅ View all approval requests (cross-channel visibility)
- ✅ Approve plans/agreements (Level 2, typically final)
- ✅ Reject with financial justification
- ✅ Override budget warnings (with audit trail)
- ✅ View all budget envelopes and utilization
- ✅ Configure budget allocations
- ✅ Run financial reports (spend analysis, variance)
- ❌ Create or edit plans/agreements
- ❌ Modify approval policies (Admin only)

**Scope Constraints:**
- No channel/region constraints (global view)
- Approval triggered by: amount threshold OR ROI threshold

**Typical Users:**
- Finance Managers
- CFO / Finance Director
- Budget Controllers

---

#### Role 4: Admin

**Primary Responsibility:** System configuration, master data management, policy setup

**Capabilities:**
- ✅ Manage master data (Customer, Product, CPL, FU, Tactic)
- ✅ Configure KPIs and formulas
- ✅ Configure approval policies
- ✅ Configure budget templates
- ✅ Manage users and role assignments
- ✅ View audit logs
- ✅ Import baseline data
- ❌ Create plans/agreements (not an operational role)
- ❌ Approve plans/agreements (not part of approval workflow)

**Scope Constraints:**
- None (system-wide access to configuration)

**Typical Users:**
- IT Administrators
- System Administrators
- TPM Platform Owners

---

#### Role 5: Read-Only (Analyst / Executive)

**Primary Responsibility:** View-only access for reporting, analysis, or executive oversight

**Capabilities:**
- ✅ View all approved plans/agreements
- ✅ View budget utilization
- ✅ Run reports and export data
- ✅ View dashboards and analytics
- ❌ Create, edit, or approve anything
- ❌ Configure system

**Scope Constraints:**
- May have channel/region filters (e.g., NKA Analyst → NKA only)

**Typical Users:**
- Business Analysts
- Finance Analysts
- Executive Leadership (CEO, CMO)

---

### Role Assignment

**Single User, Multiple Roles:**
Users can hold multiple roles, but with explicit scope boundaries:

**Example:**
```
User: John Smith
├─ Role: Planner
│  └─ Scope: NKA Channel, Turkey Region
│
└─ Role: Approver (Category Manager)
   └─ Scope: Modern Trade Channel, Turkey Region
```

**Conflict of Interest Prevention:**
- User cannot approve own submissions (system blocks)
- User cannot be both Planner and Approver for the same channel/CPL (policy warning)

---

## 7.2 Capability-Based Permissions

**Capability = A specific action a user can perform.**

CollMind uses **capability-based access control (CBAC)** rather than screen-based permissions. This means permissions are defined at the **action level**, not the **UI level**.

### Core Capabilities (20 Capabilities)

| Capability Code | Description | Typical Roles |
|-----------------|-------------|---------------|
| `plan.create` | Create new plans (Planning-First) | Planner |
| `plan.edit` | Edit draft plans | Planner |
| `plan.submit` | Submit plans for approval | Planner |
| `plan.approve_L1` | Approve plans (Level 1) | Approver |
| `plan.approve_L2` | Approve plans (Level 2) | Finance Approver |
| `plan.view_all` | View all plans (approved + draft) | Admin, Finance, Analyst |
| `agreement.create` | Create new agreements (Actuals-First) | Planner |
| `agreement.edit` | Edit draft agreements | Planner |
| `agreement.submit` | Submit agreements for approval | Planner |
| `agreement.approve_L1` | Approve agreements (Level 1) | Approver |
| `agreement.approve_L2` | Approve agreements (Level 2) | Finance Approver |
| `budget.view` | View budget envelopes and utilization | All (read-only for most) |
| `budget.configure` | Create/modify budget allocations | Finance Approver, Admin |
| `budget.override` | Override budget warnings | Finance Approver |
| `master_data.manage` | CRUD on master data (CPL, FU, Tactic) | Admin |
| `kpi.configure` | Define KPIs and formulas | Admin |
| `policy.configure` | Define approval policies | Admin |
| `import.baseline` | Import baseline data | Admin, Planner (limited) |
| `import.invoice` | Import off-invoice batches | Planner, Finance |
| `audit.view` | View audit logs | Admin, Finance |

### Scope-Based Enforcement

**Scope = A filter that limits which records a user can access.**

**Example:**
```
User: Sarah Johnson
Role: Planner
Capabilities: [plan.create, plan.edit, plan.submit]
Scope:
  - channels: ['NKA', 'Modern Trade']
  - regions: ['Turkey']
  - cpls: null (all CPLs within channels)
```

**Permission Check Logic:**
```typescript
// Pseudo-code
async function canUserAccessPlan(userId: string, planId: string, action: string) {
  const user = await getUser(userId);
  const plan = await getPlan(planId);
  
  // Check 1: Does user have the capability?
  if (!user.capabilities.includes(action)) {
    return { allowed: false, reason: 'Missing capability' };
  }
  
  // Check 2: Is plan within user's scope?
  if (user.scope.channels && !user.scope.channels.includes(plan.channel)) {
    return { allowed: false, reason: 'Channel out of scope' };
  }
  
  if (user.scope.regions && !user.scope.regions.includes(plan.region)) {
    return { allowed: false, reason: 'Region out of scope' };
  }
  
  // Check 3: Conflict of interest (cannot approve own submission)
  if (action.startsWith('approve') && plan.created_by === userId) {
    return { allowed: false, reason: 'Cannot approve own submission' };
  }
  
  return { allowed: true };
}
```

---

## 7.3 Approval Authority Model

**Approval Authority = The rules that determine who can approve what, and in what order.**

### Approval Policy Structure

**Approval policies are entity-specific, threshold-based, and context-aware:**

```json
{
  "policy_id": "POL-NKA-PLAN-001",
  "policy_name": "NKA Plan Approval - Standard",
  "entity_type": "PLAN",
  "applies_to": {
    "channel": "NKA",
    "amount_range": [0, 100000]
  },
  "approval_levels": [
    {
      "order": 1,
      "role": "APPROVER_CATEGORY_MANAGER",
      "required": true,
      "when": { "amount_gte": 0 }
    },
    {
      "order": 2,
      "role": "APPROVER_FINANCE",
      "required": true,
      "when": {
        "OR": [
          { "amount_gte": 50000 },
          { "gp_roi_pct_lt": 15 }
        ]
      }
    }
  ],
  "auto_reject_conditions": [
    {
      "condition": { "gp_roi_pct_lt": 5 },
      "message": "ROI too low (<5%), plan auto-rejected"
    }
  ]
}
```

**Policy Matching Logic:**
```typescript
// Pseudo-code
async function getApprovalPolicy(plan: Plan) {
  const policies = await loadPolicies({
    entity_type: 'PLAN',
    channel: plan.channel
  });
  
  // Find policy where amount is within range
  const matchingPolicy = policies.find(p => 
    p.applies_to.amount_range[0] <= plan.total_spend &&
    p.applies_to.amount_range[1] >= plan.total_spend
  );
  
  if (!matchingPolicy) {
    throw new Error(`No approval policy found for channel ${plan.channel}, amount ${plan.total_spend}`);
  }
  
  return matchingPolicy;
}
```

### Threshold-Based Routing

**Example Scenarios:**

**Scenario 1: Small Plan (10K TL, ROI 22%)**
```
Plan: 10,000 TL, GP ROI: 22%
Policy Match: NKA Standard

Approval Levels:
✓ Level 1: Category Manager (required for all plans)
✗ Level 2: Finance (not required: amount <50K AND ROI ≥15%)

Result: 1-level approval, fast-track
```

**Scenario 2: Large Plan (60K TL, ROI 18%)**
```
Plan: 60,000 TL, GP ROI: 18%
Policy Match: NKA Standard

Approval Levels:
✓ Level 1: Category Manager (required for all plans)
✓ Level 2: Finance (required: amount ≥50K)

Result: 2-level approval (sequential)
```

**Scenario 3: Low-ROI Plan (25K TL, ROI 12%)**
```
Plan: 25,000 TL, GP ROI: 12%
Policy Match: NKA Standard

Approval Levels:
✓ Level 1: Category Manager (required for all plans)
✓ Level 2: Finance (required: ROI <15%)

Result: 2-level approval (ROI-triggered)
```

### Sequential vs Parallel Approvals

**Phase 1: Sequential Only**
- Level 1 must approve before Level 2 can see the request
- Each level approves/rejects independently

**Future (Phase 2+): Parallel**
- Multiple approvers at same level can review simultaneously
- Approval completes when all required approvers act

---

## 7.4 Audit & Traceability

**Audit Trail = Immutable record of who did what, when, and why.**

### Audit Log Schema

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  
  -- Event Identification
  event_type VARCHAR(50) NOT NULL, -- 'PLAN_CREATED', 'PLAN_APPROVED', etc.
  entity_type VARCHAR(50) NOT NULL, -- 'PLAN', 'AGREEMENT', 'BUDGET'
  entity_id UUID NOT NULL,
  
  -- Actor
  user_id UUID NOT NULL,
  user_email VARCHAR(255),
  user_role VARCHAR(50),
  
  -- Context
  action VARCHAR(100) NOT NULL, -- 'CREATE', 'APPROVE', 'REJECT', 'EDIT'
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  -- Details
  changes JSONB, -- Old value → New value (for edits)
  metadata JSONB, -- Additional context (e.g., approval comments)
  
  -- Indexes
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
```

### Auditable Events (20 Core Events)

| Event Type | Description | Logged Data |
|------------|-------------|-------------|
| `PLAN_CREATED` | New plan created | Plan ID, Created By, Channel, Category |
| `PLAN_EDITED` | Plan modified (draft) | Plan ID, Changed Fields, Old/New Values |
| `PLAN_SUBMITTED` | Plan submitted for approval | Plan ID, Submitted By, Timestamp |
| `PLAN_APPROVED` | Plan approved (any level) | Plan ID, Approved By, Approval Level |
| `PLAN_REJECTED` | Plan rejected | Plan ID, Rejected By, Reason |
| `PLAN_CANCELLED` | Plan cancelled by planner | Plan ID, Cancelled By, Reason |
| `AGREEMENT_CREATED` | New agreement created | Agreement ID, Created By, CPL, Tactic |
| `AGREEMENT_APPROVED` | Agreement approved | Agreement ID, Approved By |
| `BUDGET_ALLOCATED` | Budget envelope created | Envelope ID, Amount, Period |
| `BUDGET_RESERVED` | Budget reserved (agreement approved) | Envelope ID, Agreement ID, Amount |
| `BUDGET_COMMITTED` | Budget committed (plan approved) | Envelope ID, Plan ID, Amount |
| `BUDGET_CONSUMED` | Budget consumed (spend occurred) | Envelope ID, Ledger Entry ID, Amount |
| `INVOICE_IMPORTED` | Off-invoice batch imported | Batch ID, Imported By, Record Count |
| `BASELINE_IMPORTED` | Baseline data imported | Import ID, Period, Record Count |
| `KPI_CONFIGURED` | KPI formula changed | KPI Code, Old Formula, New Formula |
| `POLICY_CONFIGURED` | Approval policy changed | Policy ID, Changed Fields |
| `USER_LOGIN` | User logged in | User ID, IP Address, Timestamp |
| `USER_LOGOUT` | User logged out | User ID, Session Duration |
| `PERMISSION_DENIED` | User attempted unauthorized action | User ID, Action, Entity ID, Reason |
| `EXPORT_DATA` | User exported data | User ID, Report Type, Record Count |

### Audit Query Examples

**Query 1: Who approved this plan?**
```sql
SELECT 
  user_email,
  timestamp,
  metadata->>'approval_level' AS level,
  metadata->>'comments' AS comments
FROM audit_logs
WHERE entity_type = 'PLAN'
  AND entity_id = '...'
  AND event_type = 'PLAN_APPROVED'
ORDER BY timestamp;
```

**Query 2: What changes were made to this budget envelope?**
```sql
SELECT 
  user_email,
  timestamp,
  action,
  changes
FROM audit_logs
WHERE entity_type = 'BUDGET'
  AND entity_id = '...'
  AND action IN ('EDIT', 'ALLOCATE', 'REALLOCATE')
ORDER BY timestamp;
```

**Query 3: All actions by user in date range**
```sql
SELECT 
  timestamp,
  event_type,
  entity_type,
  entity_id,
  action,
  metadata
FROM audit_logs
WHERE user_id = '...'
  AND timestamp BETWEEN '2026-01-01' AND '2026-01-31'
ORDER BY timestamp DESC;
```

---

## 7.5 Data Security & Isolation

### Multi-Tenancy

**Tenant Isolation:**
- Every table has `tenant_id` column
- Row-Level Security (RLS) enforced at database level
- No cross-tenant data visibility (even for admins)

**Example RLS Policy:**
```sql
-- PostgreSQL RLS Policy
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON plans
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

**Application-Level Enforcement:**
```typescript
// Every query must filter by tenant_id
const plans = await db.plans.findMany({
  where: {
    tenant_id: currentUser.tenant_id, // Required!
    channel: 'NKA'
  }
});
```

### Data Encryption

**Encryption at Rest:**
- Database encryption (managed by cloud provider)
- All data encrypted on disk (AES-256)

**Encryption in Transit:**
- HTTPS/TLS 1.3 for all API calls
- Encrypted SFTP for file transfers

**Sensitive Fields:**
- Passwords: Hashed with bcrypt (never stored plaintext)
- API Keys: Encrypted at rest, rotatable
- PII (if any): Encrypted with tenant-specific keys

---

## 7.6 Session Management

**Session Timeout:**
- Idle timeout: 30 minutes (no activity)
- Absolute timeout: 8 hours (maximum session length)
- Concurrent sessions: Allowed (multiple devices)

**Session Invalidation:**
- User logout: Immediate
- Password change: All sessions invalidated
- Role change: All sessions invalidated (security measure)

---

## 7.7 Phase 1 Security Scope

### ✅ Phase 1 Security Features

**Access Control:**
- ✅ 5 core roles (Planner, Approver, Finance, Admin, Read-Only)
- ✅ Capability-based permissions (20 capabilities)
- ✅ Scope-based filtering (channel, region)
- ✅ Conflict-of-interest prevention

**Approval:**
- ✅ Sequential approval workflows
- ✅ Threshold-based routing
- ✅ Auto-reject conditions

**Audit:**
- ✅ Immutable audit logs (20 event types)
- ✅ User action tracking
- ✅ Change history (old/new values)

**Data Security:**
- ✅ Multi-tenant isolation (RLS)
- ✅ Encryption at rest and in transit
- ✅ Session management

---

### ❌ Explicitly NOT in Phase 1

**Advanced RBAC:**
- ❌ Custom role creation (UI-based)
- ❌ Dynamic role assignment (workflow-based)
- ❌ Attribute-based access control (ABAC)

**Advanced Approval:**
- ❌ Parallel approvals (multiple simultaneous)
- ❌ Delegated approvals (out-of-office)
- ❌ Escalation rules (approval SLA breaches)

**Advanced Audit:**
- ❌ Audit log retention policies (auto-archive)
- ❌ Tamper-proof audit (blockchain/immutable log service)
- ❌ Audit analytics (ML-based anomaly detection)

**Security:**
- ❌ SSO integration (SAML, OAuth)
- ❌ MFA (Multi-Factor Authentication)
- ❌ IP whitelisting
- ❌ Advanced threat detection

---

**END OF SECTION 7 - SECURITY, ROLES & PERMISSIONS**

---

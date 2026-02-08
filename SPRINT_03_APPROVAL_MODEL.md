# Sprint 03: Approval Model Design
## Actuals-First TPM System

**Purpose:** Design the approval model for Agreements in Actuals-First Mode  
**Status:** 📝 Design Phase  
**Reference:** Section 4.2 - Agreement Management (BRD), Sprint 01 & 02

---

## Overview

This document defines the approval model that governs Agreement approvals in Actuals-First Mode. The design supports **single-level approval in Phase 1** while being architected to support **multi-level approval in future phases** without breaking changes.

**Key Principles:**
- Approval is **mandatory** for all Agreements
- Single-level approval in Sprint 1 (Phase 1)
- Multi-level approval architecture ready (not implemented in Phase 1)
- Cannot be self-approval (EA-001)
- Complete audit trail
- Policy-driven (future: approval routing based on amount, channel, tactic)

---

## Approval Entity Design

### Core Entity: ApprovalRequest

**Purpose:** Represents a single approval request for an Agreement. Each Agreement has exactly one ApprovalRequest.

**Key Characteristics:**
- One-to-One relationship with Agreement
- Supports single-level approval (Phase 1)
- Architecture supports multi-level (future)
- Immutable approval decisions (audit trail)
- Status-driven lifecycle

### Entity Schema

```typescript
// Approval Status Enum
enum ApprovalRequestStatus {
  PENDING = 'PENDING',           // Awaiting approval
  APPROVED = 'APPROVED',          // All levels approved
  REJECTED = 'REJECTED',          // Rejected at any level
  CANCELLED = 'CANCELLED',        // Cancelled before approval
}

// Approval Decision Enum
enum ApprovalDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// Approval Request Entity
class ApprovalRequest extends BaseEntity {
  // Identification
  id: UUID;
  tenantId: UUID;
  
  // Entity Reference (One-to-One with Agreement)
  entityType: 'AGREEMENT';  // Phase 1: Only AGREEMENT
  entityId: UUID;           // FK to Agreement.id
  
  // Requester
  requestedById: UUID;      // User who created the agreement
  requestedByEmail: string;
  requestedByName: string;
  requestedAt: Timestamp;
  
  // Approval Status
  status: ApprovalRequestStatus;  // PENDING | APPROVED | REJECTED | CANCELLED
  
  // Single-Level Approval (Phase 1)
  approverId?: UUID;        // Assigned approver (Phase 1: single approver)
  approverEmail?: string;
  approverName?: string;
  approverRole?: UserRole;  // APPROVER | ADMIN | FINANCE
  
  // Approval Decision (Phase 1: single decision)
  decision?: ApprovalDecision;  // APPROVED | REJECTED
  decidedAt?: Timestamp;
  decidedBy?: UUID;            // User who made the decision
  rejectionReason?: string;     // Required if REJECTED
  
  // Comments
  approverComment?: string;     // Optional comment from approver
  
  // Future: Multi-Level Support (not used in Phase 1)
  // These fields exist in schema but are NULL in Phase 1
  approvalLevels?: JSONB;       // Future: Array of approval levels
  currentLevel?: number;       // Future: Current approval level
  approvalPolicyId?: UUID;      // Future: Policy that matched
  
  // Metadata
  totalAmount?: Decimal;        // Agreement amount (for future routing)
  priority: 'NORMAL' | 'HIGH' | 'URGENT';  // Default: NORMAL
  dueDate?: Date;               // Target completion date
  
  // Audit
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy?: UUID;
  updatedBy?: UUID;
}
```

### Phase 1 Implementation (Single-Level)

**Fields Used:**
- `entityType`, `entityId` (links to Agreement)
- `requestedById`, `requestedByEmail`, `requestedByName`, `requestedAt`
- `status` (PENDING | APPROVED | REJECTED | CANCELLED)
- `approverId`, `approverEmail`, `approverName`, `approverRole`
- `decision`, `decidedAt`, `decidedBy`, `rejectionReason`
- `approverComment`
- `totalAmount`, `priority`, `dueDate`

**Fields Not Used (Future):**
- `approvalLevels` (NULL in Phase 1)
- `currentLevel` (NULL in Phase 1)
- `approvalPolicyId` (NULL in Phase 1)

---

## Relationship to Agreement

### One-to-One Relationship

**Agreement → ApprovalRequest:**
- Each Agreement has exactly **one** ApprovalRequest
- Created when Agreement transitions: `DRAFT → SUBMITTED`
- Foreign Key: `ApprovalRequest.entityId = Agreement.id`
- Constraint: `UNIQUE(entityType, entityId)` (one approval per entity)

**Agreement Fields:**
```typescript
class Agreement extends BaseEntity {
  // ... other fields ...
  
  // Approval Reference
  approvalRequestId?: UUID;  // FK to ApprovalRequest.id
  
  // Agreement Status (matches BRD: DRAFT | PENDING | APPROVED | ACTIVE | CLOSED | REJECTED | CANCELLED)
  status: AgreementStatus;
  
  // Approval Metadata (denormalized)
  approvedAt?: Timestamp;
  approvedById?: UUID;
  rejectedAt?: Timestamp;
  rejectedById?: UUID;
  rejectionReason?: string;
}
```

**Relationship Diagram:**
```
┌─────────────┐         ┌──────────────────┐
│  Agreement  │────────│ ApprovalRequest  │
│             │ 1     1 │                  │
│ - id        │◄────────│ - entityId (FK) │
│ - approval  │         │ - entityType    │
│   RequestId│         │ - status        │
│   (FK)      │         │ - decision      │
└─────────────┘         └──────────────────┘
```

### Relationship Rules

1. **Creation:**
   - ApprovalRequest created when Agreement status changes to `PENDING`
   - Agreement.approvalRequestId set to ApprovalRequest.id
   - Agreement.status set to `PENDING`

2. **Approval:**
   - When ApprovalRequest.status = `APPROVED`:
     - Agreement.status changes to `APPROVED`
     - Agreement.approvedAt, Agreement.approvedById set
     - Budget reservation triggered

3. **Rejection:**
   - When ApprovalRequest.status = `REJECTED`:
     - Agreement.status changes to `REJECTED`
     - Agreement.rejectedAt, Agreement.rejectedById, Agreement.rejectionReason set
     - No budget reservation

4. **Cancellation:**
   - When ApprovalRequest.status = `CANCELLED`:
     - Agreement can return to `DRAFT` (if cancelled before any approval)
     - ApprovalRequest can be deleted (soft delete)

---

## Approval Decision Outcomes

### Decision Types

**1. APPROVED**
- All required approval levels completed (Phase 1: single level)
- Agreement can proceed
- Budget reservation triggered
- Agreement status: `PENDING → APPROVED`

**2. REJECTED**
- Any approver rejects at any level (Phase 1: single level)
- Agreement cannot proceed
- No budget reservation
- Agreement status: `PENDING → REJECTED`
- Rejection reason required

**3. CANCELLED**
- Request cancelled before any approval decision
- Only possible in `PENDING` status
- Agreement can return to `DRAFT`
- No budget impact

### Decision Flow (Phase 1 - Single Level)

```
┌──────────┐
│ PENDING  │
└────┬─────┘
     │
     ├─[approve()]──→ ┌──────────┐
     │                │ APPROVED │
     │                └──────────┘
     │
     ├─[reject()]──→ ┌──────────┐
     │                │ REJECTED │
     │                └──────────┘
     │
     └─[cancel()]──→ ┌──────────┐
                     │ CANCELLED │
                     └──────────┘
```

### Decision Validation Rules

**Approve:**
- User must have `APPROVER`, `ADMIN`, or `FINANCE` role
- Cannot be self-approval: `approverId != requestedById` (EA-001)
- ApprovalRequest.status must be `PENDING`
- Agreement.status must be `SUBMITTED`

**Reject:**
- User must have `APPROVER`, `ADMIN`, or `FINANCE` role
- Cannot be self-approval: `approverId != requestedById` (EA-001)
- Rejection reason is **mandatory**
- ApprovalRequest.status must be `PENDING`
- Agreement.status must be `SUBMITTED`

**Cancel:**
- Only requester can cancel: `userId == requestedById`
- ApprovalRequest.status must be `PENDING`
- No approval decisions made yet

---

## Approval Logic Location

### Architecture Layers

**Domain Layer (Business Rules):**
- Approval validation logic
- Self-approval prevention (EA-001)
- Approval decision rules
- State transition validation

**Application Layer (Orchestration):**
- Approval workflow orchestration
- Agreement state synchronization
- Budget reservation triggering
- Notification sending

**Infrastructure Layer (Persistence):**
- ApprovalRequest repository
- Database transactions
- Audit logging

### Domain Service: ApprovalDomainService

**Purpose:** Contains business rules and validation logic for approvals.

**Responsibilities:**
- Validate approval eligibility
- Enforce self-approval prevention (EA-001)
- Validate approval decisions
- Calculate approval routing (future: policy matching)

**Location:** `src/modules/approval/domain/approval-domain.service.ts`

**Methods:**
```typescript
class ApprovalDomainService {
  /**
   * Validates if a user can approve a request
   * Enforces EA-001: Cannot be self-approval
   */
  canApprove(
    approvalRequest: ApprovalRequest,
    approverId: UUID,
    approverRole: UserRole
  ): ValidationResult;
  
  /**
   * Validates if a user can reject a request
   * Enforces EA-001: Cannot be self-approval
   */
  canReject(
    approvalRequest: ApprovalRequest,
    approverId: UUID,
    approverRole: UserRole
  ): ValidationResult;
  
  /**
   * Determines approver for single-level approval (Phase 1)
   * Future: Policy-based routing for multi-level
   */
  determineApprover(
    agreement: Agreement,
    tenantId: UUID
  ): User | null;
  
  /**
   * Validates approval decision
   */
  validateDecision(
    decision: ApprovalDecision,
    rejectionReason?: string
  ): ValidationResult;
}
```

### Application Service: ApprovalService

**Purpose:** Orchestrates approval workflow and coordinates with other services.

**Responsibilities:**
- Create approval requests
- Process approval decisions
- Synchronize Agreement state
- Trigger budget reservation
- Send notifications

**Location:** `src/modules/approval/approval.service.ts`

**Methods:**
```typescript
class ApprovalService {
  constructor(
    private approvalRepository: ApprovalRequestRepository,
    private agreementService: AgreementService,
    private budgetService: BudgetService,
    private notificationService: NotificationService,
    private approvalDomainService: ApprovalDomainService
  ) {}
  
  /**
   * Creates approval request when agreement is submitted
   */
  async createApprovalRequest(
    agreement: Agreement,
    requestedBy: User
  ): Promise<ApprovalRequest>;
  
  /**
   * Approves an agreement
   * - Validates approval eligibility
   * - Updates ApprovalRequest
   * - Updates Agreement status
   * - Triggers budget reservation
   * - Sends notifications
   */
  async approve(
    approvalRequestId: UUID,
    approverId: UUID,
    comment?: string
  ): Promise<ApprovalRequest>;
  
  /**
   * Rejects an agreement
   * - Validates rejection eligibility
   * - Updates ApprovalRequest
   * - Updates Agreement status
   * - Sends notifications
   */
  async reject(
    approvalRequestId: UUID,
    approverId: UUID,
    rejectionReason: string
  ): Promise<ApprovalRequest>;
  
  /**
   * Cancels an approval request
   * - Only requester can cancel
   * - Returns agreement to DRAFT
   */
  async cancel(
    approvalRequestId: UUID,
    userId: UUID
  ): Promise<void>;
}
```

### Repository: ApprovalRequestRepository

**Purpose:** Data access layer for ApprovalRequest entity.

**Location:** `src/modules/approval/approval.repository.ts`

**Methods:**
```typescript
class ApprovalRequestRepository {
  /**
   * Find approval request by ID
   */
  findById(id: UUID, tenantId: UUID): Promise<ApprovalRequest | null>;
  
  /**
   * Find approval request by entity (Agreement)
   */
  findByEntity(
    entityType: string,
    entityId: UUID,
    tenantId: UUID
  ): Promise<ApprovalRequest | null>;
  
  /**
   * Find pending approvals for a user
   */
  findPendingForApprover(
    approverId: UUID,
    tenantId: UUID
  ): Promise<ApprovalRequest[]>;
  
  /**
   * Create approval request
   */
  create(approvalRequest: ApprovalRequest): Promise<ApprovalRequest>;
  
  /**
   * Update approval request
   */
  update(approvalRequest: ApprovalRequest): Promise<ApprovalRequest>;
  
  /**
   * Save approval request (create or update)
   */
  save(approvalRequest: ApprovalRequest): Promise<ApprovalRequest>;
}
```

---

## Approval Assignment (Phase 1)

### Single Approver Assignment

**Phase 1 Logic:**
- Simple assignment: Find first available user with `APPROVER` role
- Future: Policy-based routing (amount, channel, tactic)

**Assignment Algorithm (Phase 1):**
```typescript
async determineApprover(
  agreement: Agreement,
  tenantId: UUID
): Promise<User | null> {
  // Phase 1: Simple assignment
  // Find first active APPROVER in tenant
  const approvers = await userRepository.findByRole(
    tenantId,
    UserRole.APPROVER,
    UserStatus.ACTIVE
  );
  
  if (approvers.length === 0) {
    // Fallback: Use ADMIN
    const admins = await userRepository.findByRole(
      tenantId,
      UserRole.ADMIN,
      UserStatus.ACTIVE
    );
    return admins[0] || null;
  }
  
  return approvers[0];  // Simple: first approver
}
```

**Future (Multi-Level):**
- Policy engine matches approval policy
- Determines required approval levels
- Assigns approvers per level
- Sequential processing

---

## Approval Workflow Integration

### Agreement Submission Flow

```
1. Planner submits Agreement
   ↓
2. Agreement.status = SUBMITTED
   ↓
3. ApprovalService.createApprovalRequest()
   - Creates ApprovalRequest (status = PENDING)
   - Assigns approver (Phase 1: single approver)
   - Links to Agreement
   ↓
4. NotificationService.sendApprovalRequest()
   - Notifies assigned approver
   ↓
5. Agreement.approvalRequestId set
   Agreement.approvalStatus = PENDING
```

### Approval Decision Flow

```
1. Approver approves/rejects
   ↓
2. ApprovalService.approve() or ApprovalService.reject()
   ↓
3. ApprovalDomainService.canApprove() / canReject()
   - Validates eligibility
   - Enforces EA-001 (self-approval prevention)
   ↓
4. Update ApprovalRequest
   - status = APPROVED or REJECTED
   - decision, decidedAt, decidedBy set
   ↓
5. Update Agreement
   - status = APPROVED or REJECTED
   - approvedAt/rejectedAt set
   ↓
6. If APPROVED:
   - BudgetService.reserveBudget()
   - Creates BudgetTransaction.RESERVE
   ↓
7. NotificationService.sendApprovalDecision()
   - Notifies requester
```

---

## Database Schema

### ApprovalRequest Table

```sql
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  
  -- Entity Reference (One-to-One with Agreement)
  entity_type VARCHAR(20) NOT NULL DEFAULT 'AGREEMENT',
  entity_id UUID NOT NULL,
  
  -- Requester
  requested_by_id UUID NOT NULL,
  requested_by_email VARCHAR(200) NOT NULL,
  requested_by_name VARCHAR(200) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Approval Status
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  -- PENDING | APPROVED | REJECTED | CANCELLED
  
  -- Single-Level Approval (Phase 1)
  approver_id UUID,
  approver_email VARCHAR(200),
  approver_name VARCHAR(200),
  approver_role VARCHAR(20),  -- APPROVER | ADMIN | FINANCE
  
  -- Approval Decision
  decision VARCHAR(20),  -- APPROVED | REJECTED
  decided_at TIMESTAMPTZ,
  decided_by UUID,
  rejection_reason TEXT,
  approver_comment TEXT,
  
  -- Future: Multi-Level Support (NULL in Phase 1)
  approval_levels JSONB,  -- Future: Array of approval levels
  current_level INTEGER,  -- Future: Current approval level
  approval_policy_id UUID,  -- Future: Policy that matched
  
  -- Metadata
  total_amount NUMERIC(18,2),  -- Agreement amount
  priority VARCHAR(10) DEFAULT 'NORMAL',  -- NORMAL | HIGH | URGENT
  due_date DATE,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT uq_approval_entity UNIQUE (tenant_id, entity_type, entity_id),
  CONSTRAINT fk_approval_requester FOREIGN KEY (requested_by_id) REFERENCES users(id),
  CONSTRAINT fk_approval_approver FOREIGN KEY (approver_id) REFERENCES users(id),
  CONSTRAINT fk_approval_decided_by FOREIGN KEY (decided_by) REFERENCES users(id),
  CONSTRAINT chk_approval_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT chk_approval_decision CHECK (decision IS NULL OR decision IN ('APPROVED', 'REJECTED')),
  CONSTRAINT chk_rejection_reason CHECK (
    (decision = 'REJECTED' AND rejection_reason IS NOT NULL) OR
    (decision != 'REJECTED')
  )
);

-- Indexes
CREATE INDEX idx_approval_requests_tenant_status ON approval_requests(tenant_id, status);
CREATE INDEX idx_approval_requests_entity ON approval_requests(tenant_id, entity_type, entity_id);
CREATE INDEX idx_approval_requests_approver ON approval_requests(tenant_id, approver_id, status) WHERE status = 'PENDING';
CREATE INDEX idx_approval_requests_requester ON approval_requests(tenant_id, requested_by_id);
```

### Agreement Table Addition

```sql
-- Add approval fields to agreements table
ALTER TABLE agreements
  ADD COLUMN approval_request_id UUID REFERENCES approval_requests(id),
  ADD COLUMN approval_status VARCHAR(20),  -- PENDING | APPROVED | REJECTED
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN approved_by_id UUID REFERENCES users(id),
  ADD COLUMN rejected_at TIMESTAMPTZ,
  ADD COLUMN rejected_by_id UUID REFERENCES users(id),
  ADD COLUMN rejection_reason TEXT;

-- Indexes
CREATE INDEX idx_agreements_approval_status ON agreements(tenant_id, approval_status);
CREATE INDEX idx_agreements_approval_request ON agreements(approval_request_id) WHERE approval_request_id IS NOT NULL;
```

---

## Future: Multi-Level Approval Architecture

### Design Considerations

**Phase 1:** Single-level approval (one approver)

**Future:** Multi-level sequential approval
- Policy engine determines required levels
- Each level has assigned approver(s)
- Sequential processing (level 1 → level 2 → ...)
- All levels must approve

**Schema Support:**
- `approval_levels` JSONB field exists (NULL in Phase 1)
- `current_level` integer field exists (NULL in Phase 1)
- `approval_policy_id` UUID field exists (NULL in Phase 1)

**Future Schema Example:**
```json
{
  "approval_levels": [
    {
      "level": 1,
      "role": "REGIONAL_MANAGER",
      "approver_id": "uuid-1",
      "status": "APPROVED",
      "approved_at": "2026-01-08T14:15:00Z"
    },
    {
      "level": 2,
      "role": "FINANCE",
      "approver_id": "uuid-2",
      "status": "PENDING",
      "approved_at": null
    }
  ],
  "current_level": 2
}
```

**Migration Path:**
- Phase 1: Use `approver_id` (single approver)
- Future: Populate `approval_levels` array, use `current_level`
- Backward compatible: Can read both formats

---

## Validation Rules Summary

### EA-001: Self-Approval Prevention

**Rule:** User cannot approve their own agreement request.

**Enforcement:**
- Domain service validates: `approverId != requestedById`
- Database constraint (optional): Check constraint
- Application service enforces before approval

**Implementation:**
```typescript
canApprove(approvalRequest: ApprovalRequest, approverId: UUID): ValidationResult {
  if (approvalRequest.requestedById === approverId) {
    return {
      valid: false,
      error: 'EA-001: Cannot approve own request'
    };
  }
  // ... other validations
}
```

### Other Validation Rules

1. **Approval Request Status:**
   - Can only approve/reject if status is `PENDING`
   - Cannot approve/reject if already `APPROVED` or `REJECTED`

2. **User Role:**
   - Approver must have `APPROVER`, `ADMIN`, or `FINANCE` role
   - Requester must have `PLANNER` or `ADMIN` role

3. **Rejection Reason:**
   - Mandatory when decision is `REJECTED`
   - Minimum length: 10 characters

4. **Agreement Status:**
   - Can only create approval request if Agreement is `SUBMITTED`
   - Agreement must be `SUBMITTED` to approve/reject

---

## Summary

### Entity Design
- **ApprovalRequest**: Core approval entity
- **One-to-One** with Agreement
- Supports single-level (Phase 1) and multi-level (future)

### Decision Outcomes
- **APPROVED**: Agreement proceeds, budget reserved
- **REJECTED**: Agreement blocked, no budget impact
- **CANCELLED**: Request cancelled, agreement returns to DRAFT

### Logic Location
- **Domain Service**: Business rules, validation (EA-001)
- **Application Service**: Workflow orchestration, coordination
- **Repository**: Data access, persistence

### Phase 1 Scope
- Single-level approval
- Simple approver assignment
- Self-approval prevention (EA-001)
- Complete audit trail

### Future Support
- Multi-level approval architecture ready
- Policy-based routing (schema supports)
- Sequential approval processing (schema supports)

---

**Status:** 📝 Design Complete  
**Last Updated:** January 2026  
**Next Review:** Before Sprint 04 (Implementation)


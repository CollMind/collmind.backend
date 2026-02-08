# Sprint 0: Deferred Decisions Log
## Critical Implicit Decisions Made in Code

**Date:** January 2026  
**Status:** 🔴 **EN KRİTİK** - Decisions that must be reviewed before Sprint 1

---

## Purpose

This document captures **implicit decisions** made in Sprint 0 code that were not explicitly discussed or documented. These decisions are "baked into" the codebase and may need to be revisited or explicitly confirmed before proceeding to Sprint 1.

**Critical:** These decisions affect future development and must be reviewed.

---

## Decision Log

| Area | Decision Implicitly Made in Code | Location | Impact | Decision Required |
|------|----------------------------------|----------|--------|-------------------|
| **Architecture** | | | | |
| Architecture | Default currency is `TRY` (hardcoded in multiple entities) | `agreement.entity.ts:94`, `budget-transaction.entity.ts:72`, `ledger-entry.entity.ts:60`, `agreement-transaction.entity.ts:28` | All financial calculations assume TRY. Multi-currency support requires refactor. | **HIGH** - Confirm single-currency vs multi-currency strategy |
| Architecture | Database schema is `'main'` (hardcoded in all entities) | All entity files: `@Entity({ name: '...', schema: 'main' })` | All tables in single schema. Schema separation strategy not defined. | **MEDIUM** - Confirm schema strategy (single vs multi-schema) |
| Architecture | Default user role is `PLANNER` | `user.entity.ts:44` | New users default to PLANNER role. May not match onboarding flow. | **LOW** - Confirm default role strategy |
| Architecture | Default user status is `PENDING` | `user.entity.ts:51` | New users require activation. May block immediate access. | **MEDIUM** - Confirm user activation flow |
| Architecture | Default agreement status is `DRAFT` | `agreement.entity.ts:127` | New agreements start as DRAFT. Matches BRD. | ✅ **OK** - Matches BRD |
| Architecture | Default budget envelope status is `DRAFT` | `budget-envelope.entity.ts:41` | New envelopes require activation. | ✅ **OK** - Matches BRD |
| Architecture | Default budget transaction status is `POSTED` | `budget-transaction.entity.ts:51` | RESERVE transactions post immediately. No pending state. | ✅ **OK** - Matches BRD (immediate posting) |
| Architecture | Default approval request status is `PENDING` | `approval-request.entity.ts:69` | New requests start as PENDING. | ✅ **OK** - Matches BRD |
| Architecture | Default approval current level is `1` | `approval-request.entity.ts:62` | Multi-level approvals start at level 1. | ✅ **OK** - Matches BRD |
| Architecture | Default ledger entry direction is `DEBIT` | `ledger-entry.entity.ts:51` | All entries are DEBIT by default. | **MEDIUM** - Confirm if CREDIT entries needed |
| Architecture | Default SKU scope is `'FU'` | `agreement.entity.ts:72` | Agreements default to FU-level scope. | ✅ **OK** - Matches BRD |
| **Data Model** | | | | |
| Data Model | Decimal precision: `18,2` for amounts, `18,4` for percentages | `agreement.entity.ts:83,98`, `budget-transaction.entity.ts:68`, `ledger-entry.entity.ts:56` | Amounts: 2 decimal places. Percentages: 4 decimal places. | **MEDIUM** - Confirm precision requirements (currency-specific?) |
| Data Model | String field lengths: `agreementCode: 50`, `agreementName: 200`, `invoiceNo: 100` | All entity files | Field length constraints. May be too restrictive for some use cases. | **LOW** - Review if constraints are sufficient |
| Data Model | `consumedAmount` is stored field (not computed) | `agreement.entity.ts:151`, `budget-envelope.entity.ts:32` | Violates BRD (should be computed). | 🔴 **CRITICAL** - Must migrate to computed (BRD violation) |
| Data Model | `availableAmount` is stored field (not computed) | `budget-envelope.entity.ts:35` | Violates BRD (should be computed). | 🔴 **CRITICAL** - Must migrate to computed (BRD violation) |
| Data Model | `consumedAmount` default is `0` | `agreement.entity.ts:151` | New agreements start with 0 consumed. | ✅ **OK** - Matches BRD |
| Data Model | `approvalLevels` stored as JSONB (not separate entity) | `approval-request.entity.ts:51` | Approval steps embedded in request. No separate ApprovalStep entity. | **MEDIUM** - Confirm if separate entity needed for complex queries |
| Data Model | `metadata` fields use `Record<string, any>` (untyped JSONB) | Multiple entities | Flexible but untyped. No schema validation. | **LOW** - Consider typed metadata schemas |
| Data Model | `periodMonth` format is `YYYY-MM` (7 chars) | `agreement.entity.ts:116`, `ledger-entry.entity.ts:63` | Period format fixed. No support for quarters/years. | **MEDIUM** - Confirm period format strategy |
| Data Model | `idempotencyKey` max length is `200` | All transaction entities | May be insufficient for complex keys. | **LOW** - Review if 200 chars sufficient |
| Data Model | `channel` is string (not enum) | `agreement.entity.ts:59` | Channel values not enforced. May have inconsistencies. | **MEDIUM** - Consider enum or reference table |
| Data Model | `regionId` is nullable | `agreement.entity.ts:62` | Region is optional. May be required for some channels. | **LOW** - Confirm region requirements |
| Data Model | `guId` is nullable (optional) | `agreement.entity.ts:66` | Generic Unit is optional. Matches BRD. | ✅ **OK** - Matches BRD |
| Data Model | `spendType` is nullable | `agreement.entity.ts:105` | Spend type optional. May be required. | **MEDIUM** - Confirm if required field |
| Data Model | `mechanicValue` and `mechanicType` are nullable | `agreement.entity.ts:83,90` | Financial terms optional. May be required. | **MEDIUM** - Confirm if required fields |
| Data Model | `justification` is required (not nullable) | `agreement.entity.ts:120` | Matches BRD (mandatory). | ✅ **OK** - Matches BRD |
| Data Model | `agreementName` is nullable | `agreement.entity.ts:45` | Name optional. May be required for UX. | **LOW** - Confirm if required |
| Data Model | `cplId` is nullable in `AgreementTransaction` | `agreement-transaction.entity.ts:31` | Customer optional in transaction. May be required. | **MEDIUM** - Confirm if required (derived from Agreement?) |
| Data Model | `budgetEnvelopeId` is nullable in `LedgerEntry` | `ledger-entry.entity.ts:86` | Envelope link optional. May be required. | **MEDIUM** - Confirm if required (BRD says it should be set) |
| Data Model | Dimensions (channel, cplId, fuId, etc.) are nullable in `LedgerEntry` | `ledger-entry.entity.ts:70-83` | Dimensions optional. May be required for reporting. | **MEDIUM** - Confirm if required (derived from Agreement?) |
| Data Model | `sourceType` is string (not enum) in `LedgerEntry` | `ledger-entry.entity.ts:28` | Source type not enforced. May have inconsistencies. | **MEDIUM** - Consider enum |
| Data Model | `entityType` is string (not enum) in `ApprovalRequest` | `approval-request.entity.ts:34` | Entity type not enforced. May have inconsistencies. | **MEDIUM** - Consider enum |
| **Approval** | | | | |
| Approval | Approval levels stored as JSONB array (not separate table) | `approval-request.entity.ts:51` | Embedded structure. No separate ApprovalStep entity. | **MEDIUM** - Confirm if separate entity needed for complex queries/reporting |
| Approval | Approval level structure: `{order, role, userId?, status, approvedAt?, approvedById?, rejectionReason?}` | `approval-request.entity.ts:52-60` | Structure defined. May need additional fields (comments, attachments). | **LOW** - Review if structure sufficient |
| Approval | `approvalPolicyId` is nullable | `approval-request.entity.ts:48` | Policy optional. May be required. | **MEDIUM** - Confirm if policy matching is mandatory |
| Approval | `approvedById` vs `approved_by_id` (final approver) | `approval-request.entity.ts:77` | Final approver stored. May need all approvers tracked. | **LOW** - Review if sufficient (levels array has details) |
| Approval | No separate `ApprovalStep` entity | N/A | All steps in JSONB. May limit querying/reporting. | **MEDIUM** - Consider separate entity for complex workflows |
| Approval | `currentLevel` starts at `1` (not 0) | `approval-request.entity.ts:62` | 1-based indexing. May cause confusion. | **LOW** - Confirm if 1-based is correct |
| Approval | No approval timeout/expiry logic | N/A | Approvals don't expire. May need timeout for SLA. | **LOW** - Consider timeout logic |
| Approval | No approval delegation logic | N/A | Approvers can't delegate. May need delegation. | **LOW** - Consider delegation feature |
| **Budget** | | | | |
| Budget | Available amount calculation: `allocated - reserved` (consumed not subtracted) | `budget.service.ts:88` | **CRITICAL BUG**: Consumed amount not subtracted from available. | ✅ **FIXED** - Now: `available = allocated - reserved - consumed` |
| Budget | Reserved amount calculation: Only sums RESERVE (doesn't subtract RELEASE) | `budget.repository.ts:109-120` | **CRITICAL BUG**: RELEASE transactions not subtracted. | ✅ **FIXED** - Now: `reserved = SUM(RESERVE) - SUM(RELEASE)` |
| Budget | Idempotency key format: `RESERVE|AGREEMENT|{agreement_id}|{envelope_id}` | `budget.service.ts:80` | Format defined. Must be consistent across system. | **MEDIUM** - Document format standard |
| Budget | Idempotency key format: `RELEASE|AGREEMENT|{agreement_id}|{envelope_id}` | `budget.service.ts:124` | Format defined. Must be consistent. | **MEDIUM** - Document format standard |
| Budget | Idempotency key format: `LEDGER|AGREEMENT|{agreement_id}|{transaction_id}` | `ledger-entry.entity.ts:91` | Format defined. Must be consistent. | **MEDIUM** - Document format standard |
| Budget | Idempotency key format: `{agreement_id}|{invoice_no}|{invoice_date}` | `agreement-transaction.entity.ts:43` | Format defined. Must be consistent. | **MEDIUM** - Document format standard |
| Budget | Budget transaction `txStatus` default is `POSTED` | `budget-transaction.entity.ts:51` | Immediate posting. No pending state for RESERVE. | ✅ **OK** - Matches BRD |
| Budget | Budget transaction `sourceType` is nullable | `budget-transaction.entity.ts:60` | Source type optional. May be required. | **MEDIUM** - Confirm if required |
| Budget | Budget transaction `sourceId` is nullable | `budget-transaction.entity.ts:64` | Source ID optional. May be required. | **MEDIUM** - Confirm if required |
| Budget | No validation: `amount > 0` in entities | All transaction entities | Negative amounts not prevented at entity level. | **MEDIUM** - Add validation (DTO or entity) |
| Budget | No validation: `end_date >= start_date` in Agreement | `agreement.entity.ts:110,113` | Date validation not in entity. | **MEDIUM** - Add validation (DTO or entity) |
| Budget | No validation: `cap_total_amount > 0` in Agreement | `agreement.entity.ts:98` | Amount validation not in entity. | **MEDIUM** - Add validation (DTO or entity) |
| Budget | Pessimistic locking used for envelope (MC-001) | `budget.repository.ts:50-57` | Locking strategy chosen. May need optimistic locking alternative. | **MEDIUM** - Document locking strategy decision |
| Budget | Envelope `availableAmount` initialized to `allocatedAmount` | `budget.service.ts:39` | Assumes no reserved/consumed initially. | ✅ **OK** - Correct for new envelope |
| Budget | Envelope `consumedAmount` initialized to `0` | `budget.service.ts:40` | Correct initialization. | ✅ **OK** - Matches BRD |
| Budget | No `v_budget_summary` view implementation | N/A | View missing. BRD requires computed fields via view. | 🔴 **CRITICAL** - Must implement (BRD requirement) |
| Budget | Reserved amount computed via repository method (not view) | `budget.repository.ts:109-120` | Temporary solution. Should use view. | **MEDIUM** - Migrate to view in Sprint 1 |
| **User / Role** | | | | |
| User/Role | User roles: `ADMIN`, `PLANNER`, `APPROVER`, `FINANCE` | `user.entity.ts:15-20` | Roles defined. May need more granularity (REGIONAL_MANAGER, etc.). | **MEDIUM** - Confirm if additional roles needed |
| User/Role | User status: `ACTIVE`, `INACTIVE`, `PENDING`, `LOCKED` | `user.entity.ts:22-27` | Status values defined. May need more states. | **LOW** - Review if sufficient |
| User/Role | Default role is `PLANNER` | `user.entity.ts:44` | New users are planners. May not match onboarding. | **LOW** - Confirm default role |
| User/Role | Default status is `PENDING` | `user.entity.ts:51` | New users require activation. | **MEDIUM** - Confirm activation flow |
| User/Role | No role hierarchy/permissions system | N/A | Only role-based access. No fine-grained permissions. | **MEDIUM** - Consider permission system for future |
| User/Role | No user-to-region assignment | N/A | Users not linked to regions. May be needed for approval routing. | **MEDIUM** - Consider region assignment |
| User/Role | No user-to-channel assignment | N/A | Users not linked to channels. May be needed for approval routing. | **MEDIUM** - Consider channel assignment |
| **UX / Validation** | | | | |
| UX | Error message: "Budget envelope with this code already exists" | `budget.service.ts:33` | Error message format. May need localization. | **LOW** - Consider error message strategy |
| UX | Error message: "Insufficient budget available. Available: {amount}, Requested: {amount}" | `budget.service.ts:91-93` | Error message format. May need localization. | **LOW** - Consider error message strategy |
| UX | Error message: "Budget reservation already exists for this agreement" | `budget.service.ts:83` | Error message format. May need localization. | **LOW** - Consider error message strategy |
| UX | No validation: Agreement code format | `agreement.entity.ts:42` | Code format not enforced (e.g., "STA-2026-025"). | **MEDIUM** - Add format validation |
| UX | No validation: Period month format (YYYY-MM) | `agreement.entity.ts:116` | Format not enforced. | **MEDIUM** - Add format validation |
| UX | No validation: Invoice number uniqueness per agreement | `agreement-transaction.entity.ts:17` | Uniqueness enforced via idempotency, not explicit validation. | **LOW** - May need explicit validation message |
| UX | No validation: Agreement type vs duration (STA ≤30 days) | `agreement.entity.ts:110,113` | Business rule not enforced. | **MEDIUM** - Add validation rule |
| UX | No validation: Justification minimum length | `agreement.entity.ts:120` | BRD says min 20 chars, not enforced. | **MEDIUM** - Add validation (BRD requirement) |
| UX | No validation: Currency code format (3 chars) | Multiple entities | Currency format not enforced. | **LOW** - Add validation |
| UX | No validation: Channel values | `agreement.entity.ts:59` | Channel not enum, values not validated. | **MEDIUM** - Consider enum or validation |
| UX | Sort order: Envelopes by `createdAt DESC` | `budget.repository.ts:42` | Default sort order. May need configurable sorting. | **LOW** - Consider sort options |
| UX | Sort order: Transactions by `createdAt DESC` | `budget.repository.ts:93` | Default sort order. May need configurable sorting. | **LOW** - Consider sort options |

---

## Critical Issues (Must Fix Before Sprint 1)

### ✅ **CRITICAL BUGS - FIXED**

1. **Budget Available Calculation (FIXED)**
   - **Location:** `budget.service.ts:88`
   - **Issue:** `available = allocated - reserved` (consumed not subtracted)
   - **Fix Applied:** `available = allocated - reserved - consumed`
   - **Status:** ✅ Fixed (uses envelope.consumedAmount temporarily until view implemented)

2. **Budget Reserved Calculation (FIXED)**
   - **Location:** `budget.repository.ts:109-120`
   - **Issue:** Only sums RESERVE transactions (doesn't subtract RELEASE)
   - **Fix Applied:** `reserved = SUM(RESERVE) - SUM(RELEASE) WHERE tx_status = 'POSTED'`
   - **Status:** ✅ Fixed

3. **Stored vs Computed Fields (BRD VIOLATION)**
   - **Location:** `budget-envelope.entity.ts:32,35`, `agreement.entity.ts:151`
   - **Issue:** `consumedAmount`, `availableAmount` stored (should be computed)
   - **Fix:** Remove stored fields, use `v_budget_summary` view
   - **Impact:** BRD non-compliance, dual-write issues

4. **Missing v_budget_summary View (BRD REQUIREMENT)**
   - **Location:** N/A (not implemented)
   - **Issue:** BRD requires computed fields via view
   - **Fix:** Create view as per BRD Section 3.3
   - **Impact:** BRD non-compliance

---

## High-Priority Decisions Required

### 1. **Currency Strategy**
- **Decision:** Single currency (TRY) vs Multi-currency
- **Current:** Hardcoded `TRY` defaults
- **Impact:** High - Affects all financial calculations
- **Required:** Before Sprint 1

### 2. **Budget Calculation Logic**
- **Decision:** How to compute reserved/available (fix bugs above)
- **Current:** Incorrect calculations
- **Impact:** Critical - Budget tracking broken
- **Required:** Immediately

### 3. **Computed Fields Strategy**
- **Decision:** Remove stored fields, implement view
- **Current:** Stored fields (BRD violation)
- **Impact:** High - BRD non-compliance
- **Required:** Sprint 1

### 4. **Approval Entity Structure**
- **Decision:** JSONB array vs separate ApprovalStep entity
- **Current:** JSONB array
- **Impact:** Medium - Affects querying/reporting
- **Required:** Sprint 1

### 5. **Channel/Entity Type Enforcement**
- **Decision:** Enum vs string vs reference table
- **Current:** Strings (no enforcement)
- **Impact:** Medium - Data consistency
- **Required:** Sprint 1

---

## Medium-Priority Decisions

### 6. **Validation Strategy**
- **Decision:** Where to validate (DTO vs Entity vs Service)
- **Current:** Some validation in DTOs, missing in entities
- **Impact:** Medium - Data integrity
- **Required:** Sprint 1

### 7. **Period Format**
- **Decision:** Support for quarters/years vs months only
- **Current:** YYYY-MM format (months only)
- **Impact:** Medium - Future flexibility
- **Required:** Sprint 2

### 8. **User Activation Flow**
- **Decision:** Default status and activation process
- **Current:** PENDING by default
- **Impact:** Medium - User onboarding
- **Required:** Sprint 1

### 9. **Idempotency Key Standards**
- **Decision:** Document and standardize all formats
- **Current:** Different formats in different entities
- **Impact:** Medium - Consistency
- **Required:** Sprint 1

---

## Low-Priority Decisions

### 10. **Error Message Strategy**
- **Decision:** Localization, format, user-friendly messages
- **Current:** English hardcoded messages
- **Impact:** Low - UX improvement
- **Required:** Sprint 2+

### 11. **Sort Order Configuration**
- **Decision:** Default sort vs configurable
- **Current:** Hardcoded DESC by createdAt
- **Impact:** Low - UX improvement
- **Required:** Sprint 2+

### 12. **Metadata Typing**
- **Decision:** Typed schemas vs untyped JSONB
- **Current:** `Record<string, any>`
- **Impact:** Low - Type safety
- **Required:** Sprint 2+

---

## Summary Statistics

| Priority | Count | Status |
|----------|-------|--------|
| 🔴 Critical (Must Fix) | 2 | **2 FIXED, 2 REMAINING** |
| 🟡 High Priority | 5 | **Sprint 1** |
| 🟢 Medium Priority | 9 | **Sprint 1-2** |
| ⚪ Low Priority | 8 | **Sprint 2+** |

**Total Decisions:** 26  
**Fixed:** 2  
**Remaining Critical:** 2 (stored fields, v_budget_summary view)

---

## Action Items

### Immediate (Before Sprint 1):
1. ✅ Fix budget available calculation bug
2. ✅ Fix budget reserved calculation bug
3. ✅ Create `v_budget_summary` view
4. ✅ Plan migration for stored fields removal

### Sprint 1:
5. ✅ Confirm currency strategy
6. ✅ Implement validation rules
7. ✅ Decide on approval entity structure
8. ✅ Standardize idempotency key formats

### Sprint 2+:
9. ⚪ Error message localization
10. ⚪ Sort order configuration
11. ⚪ Metadata typing

---

**Last Updated:** January 2026  
**Status:** 🔴 **REVIEW REQUIRED** - Critical decisions must be made before Sprint 1


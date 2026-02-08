# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 6

---

# 6. DATA & INTEGRATION MODEL

## Introduction

This section defines **how data enters and flows through** the CollMind TPM platform. It addresses the critical question every enterprise IT team asks before kickoff: "What data do you need, from where, at what granularity, and how often?"

**Scope:** This section covers data domains, integration patterns, granularity decisions, idempotency rules, and data ownership. It does NOT prescribe specific ERP vendors, field-by-field mappings, or ETL tool selections — those are implementation details determined during technical design.

**Why This Matters:**
- **Enterprise IT:** Needs to know what systems to integrate, what APIs to expose
- **Data Engineering:** Needs to understand data quality requirements, refresh frequencies
- **Finance:** Needs to understand data lineage, audit trails
- **Product:** Needs to understand what's possible vs impossible without specific data

---

## 6.1 Data Domains

### Product Architecture Principle

**CollMind is intentionally not a data warehouse; it is a decision and execution system that consumes, validates, and contextualizes enterprise data.** This distinction is critical: CollMind does not replace existing ERP, MDM, or BI systems. Instead, it integrates with them to enable promotional planning and execution workflows.

**What This Means:**
- CollMind is NOT a "single source of truth" for all enterprise data
- CollMind IS the source of truth for planning artifacts (plans, agreements, budgets)
- Master data (customers, products) lives in ERP; CollMind consumes it
- Transactional data (sales, invoices) lives in ERP; CollMind imports it for analysis

**Why This Matters:**
- Prevents scope creep ("Can we store all customer contact info in CollMind?")
- Clarifies integration strategy (read from ERP, write to TPM ledger)
- Sets expectations (CollMind is not a BI reporting tool)

---

CollMind TPM operates on **three core data domains**, each with different characteristics, sources, and refresh patterns.

### Domain 1: Master Data

**Definition:** Relatively static, reference entities that define the business structure.

**Entities:**

| Entity | Description | Key Attributes | Refresh Frequency |
|--------|-------------|----------------|-------------------|
| **Customer** | Individual customers/accounts | ID, Name, Channel, Region, Status | Weekly or on-demand |
| **CPL (Customer Planning Level)** | Aggregation of customers for planning | ID, Name, Channel, Customer IDs | Weekly or on-demand |
| **Product (SKU)** | Stock Keeping Units | ID, Name, Brand, Category, List Price, COGS, UOM | Daily (price changes) |
| **FU (Forecasting Unit)** | Aggregation of SKUs for planning | ID, Name, Category, SKU IDs | Weekly or on-demand |
| **GU (Group Unit)** | Aggregation of FUs (optional) | ID, Name, Category, FU IDs | Weekly or on-demand |
| **Tactic** | Promotional mechanism types | ID, Name, Type, Spending Type, Applicability Rules | Monthly (rarely changes) |
| **Mechanic** | Specific implementations of tactics | ID, Name, Tactic ID, Calculation Rules | Monthly (rarely changes) |
| **Organizational Hierarchy** | Regions, channels, categories | Region ID, Channel, Category Tree | Quarterly (rarely changes) |

**Sources:**
- ERP system (Customer, Product)
- MDM (Master Data Management) system
- Manual configuration (CPL, FU, GU, Tactics)

**Data Quality Requirements:**
- **Completeness:** 100% of active customers/products must be present
- **Consistency:** IDs must match across source systems
- **Recency:** Master data must be ≤7 days old (price/COGS ≤1 day old)

**Integration Pattern:** API (read) + Manual entry (UI for FU/CPL/Tactic configuration)

---

### Domain 2: Transactional Data

**Definition:** High-volume, time-series data that represents business events.

**Data Types:**

| Data Type | Description | Granularity | Refresh Frequency | Use Case |
|-----------|-------------|-------------|-------------------|----------|
| **Sales Actuals** | Historical sales volumes | Customer × SKU × Day | Daily (batch) | Baseline calculation (Planning-First) |
| **Invoice Data** | Invoice headers and line items | Invoice × Line × SKU | Daily (batch) | Off-invoice spend tracking (Actuals-First) |
| **Shipment Data** | Physical shipments to customers | Shipment × SKU × Quantity | Daily (batch) | Volume actuals (if invoice unavailable) |
| **Payment Data** | Customer payments, deductions | Payment × Invoice × Amount | Weekly (batch) | Settlement tracking (future phase) |

**Sources:**
- ERP system (sales, invoices, shipments)
- Finance system (payments)

**Data Quality Requirements:**
- **Completeness:** ≥95% of transactions must be present (gaps flagged for review)
- **Timeliness:** T+1 refresh (data from yesterday available today)
- **Accuracy:** Volume/amount mismatches <2% tolerance

**Integration Pattern:** File-based (CSV/SFTP) or API (batch)

---

### Domain 3: Reference Data

**Definition:** Configuration data that defines system behavior.

**Data Types:**

| Data Type | Description | Managed By | Refresh Pattern |
|-----------|-------------|------------|-----------------|
| **Budget Templates** | Budget envelope structures | Finance Admin | Manual (quarterly) |
| **Approval Policies** | Workflow routing rules | System Admin | Manual (as needed) |
| **KPI Definitions** | Formula and calculation rules | System Admin | Manual (rarely) |
| **RAG Thresholds** | Green/Amber/Red boundaries | Finance Admin | Manual (annually) |
| **User Roles & Permissions** | Access control configuration | IT Admin | Manual (as needed) |

**Sources:**
- CollMind UI (Admin configuration)
- Configuration files (initial setup)

**Integration Pattern:** Manual (UI-based configuration)

---

## 6.2 Integration Patterns

CollMind supports **three integration patterns**, each appropriate for different data domains and organizational capabilities.

### Pattern 1: API Integration (Real-Time / Near Real-Time)

**Use Cases:**
- Master data lookups (Customer, Product)
- Validation checks (e.g., "Is this Customer ID valid?")
- Future: Real-time invoice posting (Phase 2+)

**Characteristics:**
- **Direction:** Bidirectional (read/write)
- **Frequency:** On-demand (sub-second response)
- **Protocol:** REST API (JSON)
- **Authentication:** OAuth 2.0 or API key

**Example Flow:**
```
CollMind → ERP API: GET /api/customers?channel=NKA
ERP API → CollMind: 200 OK, [{ id: "CUST001", name: "Carrefour", ... }]
Planner → Select customer in UI
CollMind → ERP API: GET /api/customers/CUST001/products
ERP API → CollMind: 200 OK, [{ sku: "SKU123", price: 95.00, ... }]
```

**Phase 1 API Endpoints (Required from ERP):**
- `GET /customers` - List active customers (filtered by channel/region)
- `GET /customers/{id}` - Customer details
- `GET /products` - List active SKUs
- `GET /products/{sku}` - SKU details (price, COGS, UOM)

**API Response Time Requirements:**
- Average: <500ms
- 95th percentile: <2s
- Timeout: 10s

---

### Pattern 2: File-Based Integration (Batch)

**Use Cases:**
- Sales actuals import (daily baseline refresh)
- Invoice data import (off-invoice tracking)
- Bulk master data updates (weekly full refresh)

**Characteristics:**
- **Direction:** Inbound (source system → CollMind)
- **Frequency:** Scheduled (daily, weekly)
- **Format:** CSV (preferred), Excel (.xlsx), JSON
- **Transport:** SFTP (preferred), S3 bucket, Azure Blob Storage

**File Naming Convention:**
```
{entity}_{YYYYMMDD}_{HHmmss}.{ext}

Examples:
sales_actuals_20260107_020000.csv
invoices_20260106_235900.csv
customers_master_20260101_000000.csv
```

**File Structure Example (Sales Actuals):**
```csv
customer_id,sku,date,quantity,list_price,invoice_value
CUST001,SKU123,2026-01-06,100,95.00,9500.00
CUST001,SKU124,2026-01-06,50,89.00,4450.00
CUST002,SKU123,2026-01-06,200,95.00,19000.00
```

**File Processing Flow:**
```
1. Source System → SFTP: Upload file
2. CollMind: Detect file (polling every 5 minutes)
3. CollMind: Download file to staging
4. CollMind: Validate file (schema, data types, mandatory fields)
5. CollMind: Import records (with idempotency check)
6. CollMind: Update processing status (success/failure)
7. CollMind: Archive file (retain 90 days)
8. CollMind: Send notification (email/webhook on failure)
```

**File Size Limits:**
- Max file size: 500 MB
- Max rows per file: 1,000,000
- Recommendation: Split large files (e.g., daily actuals by region)

---

### Pattern 3: Manual Entry (UI-Based)

**Use Cases:**
- Emergency data corrections
- New entity creation (CPL, FU)
- One-time configuration (tactics, policies)

**Characteristics:**
- **Direction:** Inbound (user → CollMind)
- **Frequency:** On-demand (ad-hoc)
- **Interface:** Web UI forms

**When to Use:**
- Data not available in source systems (e.g., new FU definition)
- Urgent corrections (e.g., baseline data error discovered mid-planning)
- Configuration tasks (e.g., create new approval policy)

**When NOT to Use:**
- High-volume data entry (>50 records) → Use file import
- Routine transactional data (sales, invoices) → Use batch import

---

## 6.3 Granularity Decisions

**Granularity = The level of detail at which data is stored and processed.**

CollMind's granularity choices balance **data precision** (more detail = better insights) with **system performance** (more detail = slower queries, larger storage).

### Decision 1: Sales Actuals Granularity

**Question:** At what level should baseline volumes be stored?

**Options:**
- Customer × SKU × Day (most granular)
- Customer × FU × Week (aggregated)
- CPL × SKU × Month (highly aggregated)

**Phase 1 Decision:**
```
Customer × SKU × Day (or Week)
```

**Rationale:**
- Enables SKU-level planning (Planning-First requirement)
- Supports uplift % calculation (planned vs baseline at SKU level)
- Allows future drill-down to daily patterns (seasonality analysis)

**Storage Impact:**
- ~10,000 customers × 5,000 SKUs × 365 days = 18.25 billion records/year
- With aggregation (weekly): 2.6 billion records/year
- Trade-off: Daily = precise, Weekly = performant

**Phase 1 Constraint:**
- Import weekly aggregates (balance precision and performance)
- Store daily data if available (for future use)

---

### Decision 2: Budget Granularity

**Question:** At what dimensions should budgets be allocated?

**Options:**
- Channel × Category × Period (simple)
- Channel × Category × Region × Period (more granular)
- Channel × Category × Brand × Region × CPL × Period (very granular)

**Phase 1 Decision:**
```
Channel × Category × Period
```

**Rationale:**
- Matches organizational budget planning processes (most companies budget by channel/category)
- Avoids over-engineering (brand/region splits can be simulated in planning)
- Future-proof: Budget schema supports multi-dimensional JSONB (can add dimensions without migration)

**Example:**
```
Budget Envelope:
- Channel: NKA
- Category: Hair Care
- Period: 2026-01 (January)
- Allocated: 215,000 TL
```

---

### Decision 3: Invoice Data Granularity

**Question:** At what level should off-invoice data be stored?

**Options:**
- Invoice header only (no line items)
- Invoice × Line (with SKU detail)
- Invoice × Line × Agreement (linked to source agreement)

**Phase 1 Decision:**
```
Invoice × Line (with optional Agreement link)
```

**Rationale:**
- Enables SKU-level spend tracking (required for KPI calculation)
- Agreement link enables spend attribution (which agreement consumed budget)
- Supports reconciliation (planned spend vs actual invoices)

**Example:**
```
Invoice: INV-2026-001
├─ Line 1: SKU123, 100 units, 1,500 TL → Agreement STA-2026-025
├─ Line 2: SKU124, 50 units, 750 TL → Agreement STA-2026-025
└─ Total: 2,250 TL
```

### Granularity Philosophy

**Granularity choices are driven by decision needs, not by data availability alone.** Just because a source system can provide SKU × Customer × Day granularity does not mean CollMind should store it at that level. The correct granularity balances:
- **Decision utility:** Does the planner need daily detail, or is weekly sufficient?
- **System performance:** More granularity = slower queries, larger storage
- **User experience:** Can a planner reasonably work with 10M rows in a planning grid?

**Example:**
- Source system has: Customer × SKU × Day (365 days/year)
- CollMind stores: Customer × SKU × Week (52 weeks/year)
- Benefit: 7× data reduction, same planning quality

This is a product decision, not a technical limitation.

---

## 6.4 Idempotency & Corrections

**Idempotency = The ability to apply the same data multiple times without causing duplicates or errors.**

### Idempotency Strategy

**Problem:**
- Files may be uploaded multiple times (network retry, operator error)
- Same invoice may be imported twice
- Sales actuals may be corrected after initial import

**Solution:**
CollMind uses **multi-level idempotency keys** to detect duplicates:

**Level 1: File Hash**
```typescript
// Pseudo-code
const fileHash = sha256(fileContent);
const existingImport = await checkImportHistory(fileHash);

if (existingImport) {
  return {
    status: 'DUPLICATE_FILE',
    message: `This file was already imported on ${existingImport.imported_at}`,
    original_batch_id: existingImport.batch_id
  };
}
```

**Level 2: Record-Level Key**
```typescript
// Sales Actuals: customer_id + sku + date
idempotency_key = `ACTUALS|${customer_id}|${sku}|${date}`;

// Invoice: invoice_number + line_number
idempotency_key = `INVOICE|${invoice_no}|${line_no}`;

// Agreement Transaction: agreement_id + invoice_no + invoice_date
idempotency_key = `AGR_TXN|${agreement_id}|${invoice_no}|${invoice_date}`;
```

**Level 3: Version Control**
```sql
CREATE TABLE import_batches (
  id UUID PRIMARY KEY,
  entity_type VARCHAR(50), -- 'SALES_ACTUALS', 'INVOICES'
  file_hash VARCHAR(64),
  imported_at TIMESTAMPTZ,
  imported_by UUID,
  status VARCHAR(20), -- 'PROCESSING', 'COMPLETED', 'FAILED'
  records_total INTEGER,
  records_inserted INTEGER,
  records_updated INTEGER,
  records_skipped INTEGER
);
```

---

### Correction Strategies

**Scenario 1: Sales Actuals Correction**

**Problem:** Week 1 sales data imported with wrong volumes (e.g., data entry error at source)

**Options:**
- **Option A: Overwrite** (replace entire period)
- **Option B: Adjustment** (create offsetting records)

**Phase 1 Decision: Overwrite (Simpler)**

```typescript
// Pseudo-code
async function importSalesActuals(file, period) {
  // Step 1: Validate period
  if (await hasApprovedPlansInPeriod(period)) {
    throw new Error(
      `Cannot overwrite actuals for ${period}. ` +
      `Approved plans exist. Contact Finance.`
    );
  }
  
  // Step 2: Delete existing actuals for period
  await deleteActuals({ period });
  
  // Step 3: Import new actuals
  await insertActuals(file.records);
  
  // Step 4: Recalculate baselines (if baseline depends on actuals)
  await recalculateBaselines(period);
}
```

**Guardrail:**
- Cannot overwrite actuals if **approved plans** reference that period
- Requires Finance override for corrections post-approval

---

**Scenario 2: Invoice Correction**

**Problem:** Invoice amount corrected after initial import (e.g., credit note issued)

**Phase 1 Decision: Adjustment (Audit Trail)**

```typescript
// Original invoice
{
  invoice_no: 'INV-001',
  amount: 10,000,
  status: 'POSTED'
}

// Correction (credit note)
{
  invoice_no: 'CN-INV-001', // Credit note
  original_invoice_no: 'INV-001',
  amount: -2,000, // Negative amount
  correction_reason: 'Pricing error',
  status: 'POSTED'
}

// Ledger impact
Original: +10,000 TL consumed
Correction: -2,000 TL consumed
Net: 8,000 TL consumed
```

**Why Adjustment (Not Overwrite):**
- Maintains audit trail (Finance requirement)
- Supports reconciliation (ERP invoice vs TPM ledger)
- Enables variance analysis (planned vs actual with corrections visible)

---

## 6.5 Data Ownership

**Data Ownership = Which system is the authoritative source of truth for each data type.**

| Data Type | Source of Truth | CollMind Role | Sync Pattern |
|-----------|----------------|---------------|--------------|
| **Customer Master** | ERP | Consumer (read-only) | API or daily file |
| **Product Master** | ERP | Consumer (read-only) | API or daily file |
| **Sales Actuals** | ERP / Sales System | Consumer (read-only) | Daily batch file |
| **Invoice Data** | ERP / Finance System | Consumer (read-only) | Daily batch file |
| **CPL (Customer Groups)** | **CollMind** | Owner (authoritative) | N/A (created in UI) |
| **FU (Forecasting Units)** | **CollMind** | Owner (authoritative) | N/A (created in UI) |
| **Tactics & Mechanics** | **CollMind** | Owner (authoritative) | N/A (configured in UI) |
| **Plans** | **CollMind** | Owner (authoritative) | N/A (created in Planning UI) |
| **Agreements** | **CollMind** | Owner (authoritative) | N/A (created in Actuals UI) |
| **Budget Allocations** | Finance System or CollMind | Hybrid (depends on org) | Manual entry or import |
| **Ledger Entries** | **CollMind** | Owner (authoritative) | N/A (generated from agreements/plans) |

**Key Principle:**
- **Master data:** ERP is source of truth (CollMind caches for performance)
- **Planning artifacts:** CollMind is source of truth (ERP may sync for reporting)
- **Actuals:** ERP is source of truth (CollMind imports for analysis)

### Data Governance Principle

**In case of discrepancies, the source-of-truth system always prevails; CollMind does not override enterprise financial records.** This is a non-negotiable rule for enterprise deployments:

**Examples:**
- If ERP shows Customer X has 10,000 TL invoice, but CollMind imported 9,500 TL → ERP is correct, CollMind data must be corrected
- If ERP shows SKU price = 95 TL, but CollMind cached 89 TL → ERP is correct, CollMind must refresh
- If CollMind shows Plan approved for 50K budget, but Finance system shows 45K allocated → Finance is correct, plan cannot proceed

**Why This Matters:**
- Legal compliance: Financial records must be traceable to authoritative sources
- Audit confidence: External auditors trust ERP, not TPM system
- Risk mitigation: CollMind bugs cannot corrupt enterprise financial data

**Implication:**
- CollMind is always in "read mode" for master/transactional data
- CollMind is in "write mode" only for its own domain (plans, agreements, ledger)

---

## 6.6 Data Refresh Frequencies

| Data Type | Frequency | Timing | Rationale |
|-----------|-----------|--------|-----------|
| **Customer/Product Master** | Daily | 02:00 AM | Catch new products, price changes |
| **Sales Actuals** | Daily | 03:00 AM | T+1 availability (yesterday's sales) |
| **Invoice Data** | Daily | 04:00 AM | T+1 availability |
| **Budget Allocations** | On-demand | Manual trigger | Infrequent changes (quarterly) |
| **CPL/FU Definitions** | Real-time | N/A | Created/edited in UI |
| **Plans/Agreements** | Real-time | N/A | Created/edited in UI |

**SLA:**
- Master data refresh: Complete by 06:00 AM (before business hours)
- Transactional data: Complete by 08:00 AM
- Failure notification: Immediate (email to Data Engineering)

---

## 6.7 Phase 1 Integration Scope

### ✅ Phase 1 Integration Capabilities

**Master Data:**
- ✅ Customer import (API or daily file)
- ✅ Product import (API or daily file)
- ✅ Manual CPL/FU/Tactic configuration (UI)

**Transactional Data:**
- ✅ Sales actuals import (daily batch file)
- ✅ Invoice import (daily batch file or manual batch upload)

**Reference Data:**
- ✅ Budget allocation (manual entry UI)
- ✅ Approval policy configuration (admin UI)

---

### ❌ Explicitly NOT in Phase 1

**Advanced Integration:**
- ❌ Real-time invoice posting (API push from ERP)
- ❌ Bi-directional sync (CollMind → ERP write-back)
- ❌ Automatic baseline calculation (requires data warehouse)
- ❌ Payment reconciliation (invoice vs payment matching)

**Data Quality:**
- ❌ Automated data cleansing (ML-based anomaly detection)
- ❌ Duplicate customer/product detection
- ❌ Fuzzy matching (approximate SKU name search)

**Integration Platforms:**
- ❌ Pre-built ERP connectors (SAP, Oracle, etc.)
- ❌ Integration with MDM platforms (Informatica, Talend)
- ❌ Event streaming (Kafka, Kinesis)

---

**END OF SECTION 6 - DATA & INTEGRATION MODEL**

---

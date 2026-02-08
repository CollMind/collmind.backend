# COLLMIND TPM PLATFORM
## Business Requirements Document - Section 9

---

# 9. NON-FUNCTIONAL REQUIREMENTS (NFR)

## Introduction

This section defines **how well the system performs**, not what it does. Non-functional requirements (NFR) cover performance, scalability, availability, security, and compliance — the "quality attributes" that determine enterprise readiness.

**Scope:** This section establishes expectations for system behavior under load, growth scenarios, uptime targets, and regulatory compliance. It does NOT prescribe cloud providers, infrastructure architecture, or specific SLA numbers — those are negotiated during contracting.

**Why This Matters:**
- **Operations:** Needs to understand system capacity, monitoring requirements
- **IT Infrastructure:** Needs to plan hardware/cloud resources
- **Finance:** Needs to understand cost implications (storage, compute)
- **Legal/Compliance:** Needs to verify audit, retention, and regulatory requirements

### Product Philosophy

**CollMind is designed as a multi-tenant SaaS platform optimized for operational workloads (OLTP), not analytical queries (OLAP).** Performance targets reflect typical promotional planning/execution usage patterns: frequent small transactions, not massive batch analytics.

---

## 9.1 Performance Requirements

### Response Time Targets

**User-Initiated Actions (Interactive):**

| Action | Target Response Time | 95th Percentile | Max Acceptable |
|--------|---------------------|-----------------|----------------|
| **Page Load** (initial app load) | <2s | <3s | 5s |
| **Screen Navigation** (list → detail) | <500ms | <1s | 2s |
| **Form Submission** (create plan/agreement) | <1s | <2s | 3s |
| **Inline Edit** (change volume in grid) | <200ms | <500ms | 1s |
| **KPI Calculation** (real-time, 50 SKUs) | <500ms | <1s | 2s |
| **Search** (customer/product lookup) | <300ms | <800ms | 2s |
| **Report Generation** (standard, <10K rows) | <5s | <10s | 15s |
| **Export (Excel/PDF, <10K rows)** | <10s | <20s | 30s |
| **Approval Action** (approve/reject) | <1s | <2s | 3s |

**Background Jobs (Non-Interactive):**

| Job Type | Target Completion Time | Frequency |
|----------|------------------------|-----------|
| **Baseline Import** (weekly, 100K rows) | <15 minutes | Weekly |
| **Invoice Import** (daily, 50K rows) | <10 minutes | Daily |
| **Master Data Refresh** (daily, 10K customers) | <5 minutes | Daily |
| **Budget Recalculation** (monthly) | <2 minutes | Monthly |
| **Large Report Export** (100K+ rows) | <30 minutes | On-demand |

**Performance Degradation Scenarios:**

| Scenario | Expected Impact | Mitigation |
|----------|----------------|------------|
| **Database at 80% CPU** | Response times +20% | Auto-scaling (add read replicas) |
| **Peak usage (50+ concurrent users)** | Response times +30% | Load balancing, connection pooling |
| **Large import job running** | Interactive queries +10% slower | Job queue throttling, off-hours scheduling |

---

## 9.2 Scalability Requirements

### Data Volume Growth

**Year 1 Projections (Single Tenant):**

| Entity | Volume | Growth Rate |
|--------|--------|-------------|
| **Customers** | 10,000 | +10% annually |
| **Products (SKUs)** | 5,000 | +15% annually (new launches) |
| **Plans (Planning-First)** | 500/year | Seasonal (Q1/Q4 peaks) |
| **Agreements (Actuals-First)** | 2,000/year | Steady (monthly distribution) |
| **Invoices** | 50,000/year | Steady |
| **Ledger Entries** | 100,000/year | Proportional to agreements/invoices |
| **Baseline Data** (Customer × SKU × Week) | 2.6M rows/year | +15% annually |

**5-Year Projections:**

| Entity | Year 1 | Year 5 | Storage Impact |
|--------|--------|--------|----------------|
| **Total Transactions** | 150K/year | 300K/year | Linear growth |
| **Baseline History** | 2.6M rows | 16M rows | 5 years retained |
| **Audit Logs** | 500K events/year | 1M events/year | Archived after 2 years |

**Database Size Estimate (Single Tenant, Year 5):**
- Transactional Data: ~5 GB
- Historical Baseline: ~10 GB
- Audit Logs (2 years): ~2 GB
- **Total:** ~17 GB per tenant

---

### Multi-Tenant Scalability

**Tenant Isolation Model:**
- Shared database (logical isolation via tenant_id)
- Row-Level Security (RLS) enforced
- Noisy neighbor protection (query timeouts, rate limiting)

**Target Platform Capacity (Phase 1):**

| Metric | Target | Notes |
|--------|--------|-------|
| **Concurrent Tenants** | 100 tenants | Shared infrastructure |
| **Concurrent Users (Total)** | 500 users | Across all tenants |
| **Concurrent Users (Peak, Single Tenant)** | 50 users | Typical mid-size org |
| **Transactions per Second (TPS)** | 500 TPS | Across all tenants |
| **Database Connections** | 200 connections | Connection pooling (pgBouncer) |

**Scaling Strategy:**

| Load Level | Action |
|------------|--------|
| **<50% capacity** | No action (normal operations) |
| **50-70% capacity** | Monitor, optimize slow queries |
| **70-85% capacity** | Vertical scaling (add CPU/RAM) |
| **>85% capacity** | Horizontal scaling (add read replicas, shard by tenant) |

---

## 9.3 Availability Requirements

### Uptime Targets

**Service Level Objective (SLO):**

| Metric | Target | Measurement Period |
|--------|--------|-------------------|
| **Availability** | 99.5% uptime | Monthly |
| **Planned Downtime** | <4 hours/month | Off-hours maintenance window |
| **Unplanned Downtime** | <45 minutes/month | Incident response target |

**Uptime Calculation:**
```
99.5% uptime = 43,800 minutes/month × 0.995 = 43,581 minutes available
Allowed downtime = 219 minutes/month (~3.6 hours)
```

**Availability by Component:**

| Component | Target Availability | Dependency |
|-----------|---------------------|------------|
| **Web Application** | 99.5% | Load balanced (multi-instance) |
| **API Services** | 99.5% | Stateless (horizontally scalable) |
| **Database (Primary)** | 99.9% | Hot standby replica |
| **File Storage (SFTP/S3)** | 99.9% | Managed service (cloud provider) |
| **Background Jobs** | 95% | Retriable, non-critical path |

---

### Degraded Mode Behavior

**Scenario 1: Database Read Replica Failure**
- **Impact:** No user-facing impact (automatic failover to primary)
- **Duration:** <30 seconds (connection pool re-route)
- **User Experience:** Possible brief slowdown (queries hit primary)

**Scenario 2: Background Job Queue Failure**
- **Impact:** Imports paused, exports delayed
- **Duration:** Until queue service restored
- **User Experience:** Users notified "Export processing delayed, you'll receive email when ready"
- **Mitigation:** Manual trigger available for critical imports

**Scenario 3: External API (ERP) Unavailable**
- **Impact:** Master data refresh fails, real-time lookups fail
- **Duration:** Depends on ERP recovery
- **User Experience:** Cached data used (with staleness warning: "Product data last updated 2 hours ago")
- **Mitigation:** Users can proceed with stale data or wait for refresh

---

### Disaster Recovery

**Recovery Objectives:**

| Metric | Target | Definition |
|--------|--------|------------|
| **RTO (Recovery Time Objective)** | <4 hours | Time to restore service after disaster |
| **RPO (Recovery Point Objective)** | <15 minutes | Maximum acceptable data loss |

**Backup Strategy:**

| Data Type | Backup Frequency | Retention |
|-----------|-----------------|-----------|
| **Database (Full)** | Daily (automated) | 30 days |
| **Database (Incremental)** | Every 15 minutes (WAL archiving) | 7 days |
| **File Storage (SFTP)** | Daily (sync to backup region) | 90 days |
| **Configuration** | On change (version control) | Indefinite |

**Disaster Scenarios:**

| Scenario | Recovery Procedure | RTO |
|----------|-------------------|-----|
| **Database Corruption** | Restore from last clean backup | <2 hours |
| **Regional Outage (Cloud)** | Failover to secondary region | <4 hours |
| **Accidental Data Delete** | Restore specific tables from backup | <1 hour |

---

## 9.4 Security Requirements

### Authentication & Authorization

**Authentication Methods (Phase 1):**
- ✅ Email + Password (bcrypt hashed)
- ✅ Session-based (30-minute idle timeout)
- ❌ SSO/SAML (Phase 2)
- ❌ MFA (Phase 2)

**Password Policy:**
- Minimum 8 characters
- Must include: uppercase, lowercase, number
- Password expiry: 90 days (configurable)
- Password history: Last 5 passwords cannot be reused

**Authorization:**
- Role-Based Access Control (RBAC) — see Section 7
- Capability-based permissions (20+ capabilities)
- Scope-based filtering (channel, region)
- Conflict-of-interest prevention (cannot approve own submissions)

---

### Data Encryption

**Encryption at Rest:**
- Database: AES-256 encryption (managed by cloud provider)
- File Storage: AES-256 encryption (S3 server-side encryption)
- Backups: Encrypted before transfer to backup storage

**Encryption in Transit:**
- HTTPS/TLS 1.3 for all web traffic
- SFTP for file transfers (SSH protocol)
- Database connections: SSL/TLS enforced

**Sensitive Data Handling:**
- Passwords: Bcrypt hashed (never stored plaintext)
- API Keys: Encrypted at rest, rotatable
- PII (if any): Encrypted with tenant-specific keys (future requirement)

---

### Network Security

**Firewall Rules:**
- Inbound: Only ports 443 (HTTPS), 22 (SFTP) exposed
- Outbound: Allow to ERP APIs (whitelisted IPs)
- Database: Not publicly accessible (private subnet)

**DDoS Protection:**
- Cloud provider DDoS mitigation (AWS Shield, Azure DDoS Protection)
- Rate limiting: 100 requests/minute per user (API)
- CAPTCHA on login after 5 failed attempts

**Penetration Testing:**
- Annual third-party penetration test
- Vulnerability scanning (monthly, automated)
- Security patches applied within 7 days of release

---

## 9.5 Compliance Requirements

### Audit Trail

**Requirement:** Immutable audit log for all financial transactions

**Coverage:**
- All CRUD operations on plans, agreements, budgets
- All approval actions (approve, reject, request changes)
- All budget state changes (reserve, commit, consume)
- All data imports (baseline, invoices)
- All configuration changes (KPIs, policies)

**Retention:**
- Audit logs: 7 years (regulatory requirement for financial records)
- Archived to cold storage after 2 years (cost optimization)

**Details:** See Section 7.4 (Audit & Traceability)

---

### Data Retention

**Operational Data:**

| Data Type | Retention Period | Rationale |
|-----------|-----------------|-----------|
| **Plans (Draft)** | 90 days inactive → delete | Reduce clutter |
| **Plans (Approved/Closed)** | 5 years | Financial compliance |
| **Agreements (All)** | 7 years | Tax/audit requirements |
| **Invoices** | 7 years | Tax/audit requirements |
| **Ledger Entries** | 7 years | Financial compliance |
| **Baseline Data** | 5 years | Performance analysis |
| **Audit Logs** | 7 years | Regulatory requirement |

**User Data:**
- Active users: Retained indefinitely
- Inactive users (no login >1 year): Flagged for review (not auto-deleted)
- Deleted users: Anonymized (user_id retained for audit trail)

---

### Regulatory Compliance

**Applicable Regulations (Turkey):**

| Regulation | Requirement | Implementation |
|------------|-------------|----------------|
| **Tax Code** | 7-year retention of financial records | Audit logs, ledger entries retained |
| **Personal Data Protection Law (KVKK)** | Consent for personal data processing | User consent flow (registration), data anonymization on delete |
| **E-Invoice Regulation** | Electronic invoice storage | Invoice files archived in original format (XML/PDF) |

**GDPR Compliance (If EU Customers):**
- Right to Access: Users can export their data
- Right to Erasure: Users can request account deletion (anonymized, audit trail preserved)
- Data Portability: Export in machine-readable format (JSON/CSV)

---

## 9.6 Monitoring & Observability

### System Monitoring

**Infrastructure Metrics:**
- CPU utilization (target: <70% average)
- Memory utilization (target: <80% average)
- Disk I/O (IOPS, latency)
- Network throughput (Mbps)

**Application Metrics:**
- Request rate (requests/second)
- Response time (P50, P95, P99)
- Error rate (% of requests resulting in 5xx errors)
- Active users (concurrent sessions)

**Business Metrics:**
- Plans created/approved (daily count)
- Agreements created/approved (daily count)
- Budget utilization (% across all envelopes)
- Failed imports (count, error reasons)

**Alerting:**

| Condition | Alert Level | Notification |
|-----------|-------------|--------------|
| **CPU >85% for 5 min** | Warning | Ops team (Slack) |
| **Database down** | Critical | Ops team (PagerDuty), Exec (SMS) |
| **Response time P95 >3s** | Warning | Ops team (Slack) |
| **Error rate >5%** | Critical | Ops + Dev team (PagerDuty) |
| **Budget overrun detected** | Info | Finance team (email) |
| **Import job failed** | Warning | Data engineering team (email) |

---

### Logging

**Log Levels:**
- ERROR: Application errors, exceptions
- WARN: Degraded performance, retryable failures
- INFO: Key business events (plan approved, budget consumed)
- DEBUG: Detailed diagnostic info (disabled in production)

**Log Retention:**
- Application logs: 30 days (hot storage)
- Archived logs: 1 year (cold storage)
- Audit logs: 7 years (compliance requirement)

**Log Aggregation:**
- Centralized logging (ELK stack, CloudWatch, Datadog)
- Searchable by: timestamp, user_id, entity_id, error_type
- Correlation ID per request (for distributed tracing)

---

## 9.7 Usability & Accessibility

### Usability Requirements

**Browser Support:**
- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)
- Mobile browsers: iOS Safari, Chrome (responsive design)

**Device Support:**
- Desktop/Laptop: Primary experience (1920×1080+ resolution)
- Tablet: Responsive (1024×768+ resolution)
- Mobile: Limited (view-only, not full editing)

**Internationalization (i18n):**
- Phase 1: Turkish + English (UI language toggle)
- Phase 2+: Additional languages (German, French, etc.)
- Number formatting: Locale-aware (1,000.00 vs 1.000,00)
- Currency: TL, USD, EUR support

---

### Accessibility (WCAG 2.1 Level A)

**Phase 1 Targets:**
- Keyboard navigation support (tab order, focus indicators)
- Screen reader compatibility (ARIA labels on forms)
- Color contrast ratio ≥4.5:1 (text on background)
- Text scaling: Support 200% zoom without breaking layout

**Phase 2 Targets:**
- WCAG 2.1 Level AA compliance
- Full keyboard-only operation (no mouse required)
- Voice control compatibility

---

## 9.8 Phase 1 NFR Scope

### ✅ Phase 1 NFR Commitments

**Performance:**
- ✅ Response time targets (page load <2s, KPI calc <500ms)
- ✅ Report generation (<5s for standard reports)
- ✅ Background job performance (imports <15 min)

**Scalability:**
- ✅ 100 tenants, 500 concurrent users (total)
- ✅ 50 concurrent users (single tenant)
- ✅ Data volume: 17 GB per tenant (5-year projection)

**Availability:**
- ✅ 99.5% uptime (monthly SLO)
- ✅ <4 hours planned downtime
- ✅ Daily backups, 15-minute RPO

**Security:**
- ✅ RBAC with capability-based permissions
- ✅ Encryption at rest and in transit
- ✅ Session management (30-min idle timeout)

**Compliance:**
- ✅ 7-year audit log retention
- ✅ KVKK compliance (Turkey)
- ✅ Immutable financial audit trail

**Monitoring:**
- ✅ Infrastructure and application metrics
- ✅ Error rate and response time monitoring
- ✅ Alerting (email, Slack, PagerDuty)

---

### ❌ Explicitly NOT in Phase 1

**Advanced Performance:**
- ❌ Real-time collaboration (multi-user editing)
- ❌ Advanced caching (Redis, CDN)
- ❌ Query optimization (materialized views, partitioning)

**Advanced Security:**
- ❌ SSO/SAML integration
- ❌ MFA (Multi-Factor Authentication)
- ❌ IP whitelisting
- ❌ Advanced threat detection (ML-based anomaly detection)

**Advanced Compliance:**
- ❌ GDPR full compliance (if non-EU, deferred)
- ❌ SOC 2 Type II certification
- ❌ ISO 27001 certification

**Advanced Monitoring:**
- ❌ AI-driven anomaly detection
- ❌ Predictive scaling (auto-scale based on predicted load)
- ❌ Advanced APM (Application Performance Monitoring with distributed tracing)

---

**END OF SECTION 9 - NON-FUNCTIONAL REQUIREMENTS**

---

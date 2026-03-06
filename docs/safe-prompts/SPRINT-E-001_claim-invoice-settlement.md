# SAFE PROMPT — SPRINT-E-001
# Claim + Invoice Settlement Engine (Off-Invoice)

**Version:** 1.0  
**Sprint:** E  
**ID:** SPRINT-E-001  
**Assigned to:** Windsurf (Sonnet)  
**Repo Scope:** Her ikisi (collmind-backend + collmind-frontend)  
**BRD Reference:** BRD Addendum V2 §4, BRD Customer Gaps GAP-001, GAP-003  
**Status:** READY FOR IMPLEMENTATION

---

## BLOCK 1 — CONTEXT

Bu sprint, Off-Invoice settlement akışının tam implementasyonunu kapsar.  
Mevcut durumda sistem anlaşma oluşturabiliyor ve onaylayabiliyor, ancak hakediş (claim) ve fatura (invoice) entity'leri yoktur.

**Mevcut:** Agreement → AgreementTransaction (basit fatura girişi)  
**Hedef:** Agreement → Claim → Invoice → Ledger (CONSUME/RELEASE)

**Core Principle (Frozen):**  
Settlement her zaman actual veriye dayanır. Plan'lar claim oluşturmaz.  
Claim'ler sadece ACTIVE durumdaki Agreement'lardan oluşturulur.

---

## BLOCK 2 — PREFLIGHT SCAN

> **Windsurf:** Implementasyona başlamadan önce aşağıdaki scan'i çalıştır ve sonuçları raporla. STOP.

```bash
# 1. Mevcut entity yapısını kontrol et
find src/database/entities -name "*.entity.ts" | sort

# 2. Claim veya invoice entity var mı?
grep -r "claim\|invoice" src/database/entities/ --include="*.ts" -l

# 3. Mevcut migration sayısı
ls src/database/migrations/ | wc -l
ls src/database/migrations/ | tail -5

# 4. Agreement entity'de status field kontrol
grep -n "status\|AgreementStatus" src/database/entities/agreement.entity.ts

# 5. Budget transaction type enum
grep -n "BudgetTransactionType\|CONSUME\|RELEASE" src/database/entities/budget-transaction.entity.ts

# 6. Ledger entry entity var mı?
cat src/database/entities/ledger-entry.entity.ts 2>/dev/null || echo "NOT FOUND"

# 7. Frontend'de ilgili sayfalar
find ../collmind-frontend/src -name "*.tsx" | xargs grep -l "claim\|invoice\|hakediş" 2>/dev/null
```

**Preflight tamamlandığında:** Scan sonuçlarını göster, onay bekle. Koda dokunma.

---

## BLOCK 3 — IMPLEMENTATION STEPS

### PHASE 1: Backend — Entity & Migration

**STEP 1: Claim Entity**

Dosya: `src/database/entities/claim.entity.ts`

```typescript
export enum ClaimStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  INVOICED = 'INVOICED',
  CLOSED = 'CLOSED',
  REJECTED = 'REJECTED'
}

export enum ClaimType {
  OFF_INVOICE = 'OFF_INVOICE',
  ON_INVOICE = 'ON_INVOICE'   // Phase 2 için rezerve
}
```

Alan listesi:
- `id` (uuid, PK)
- `tenantId` (uuid, FK → tenants)
- `agreementId` (uuid, FK → agreements)
- `claimNo` (varchar 50, generated: `CLM-{YYYY}-{sequence}`)
- `claimType` (ClaimType enum, default: OFF_INVOICE)
- `status` (ClaimStatus enum, default: DRAFT)
- `settlementPeriod` (varchar 7, format: `YYYY-MM`, **zorunlu**)
- `plannedAmount` (decimal 18,2) — agreement'tan alınan beklenen tutar
- `actualAmount` (decimal 18,2, nullable) — gerçekleşen tutar
- `invoicedAmount` (decimal 18,2, default: 0) — toplam faturalanan
- `remainingAmount` (decimal 18,2, computed = plannedAmount - invoicedAmount)
- `currency` (varchar 3, default: 'TRY')
- `submittedAt` (timestamp, nullable)
- `approvedAt` (timestamp, nullable)
- `closedAt` (timestamp, nullable)
- `approvedBy` (uuid, nullable, FK → users)
- `notes` (text, nullable)
- `metadata` (jsonb, nullable)

Index'ler:
- `[tenantId, agreementId]`
- `[tenantId, status]`
- `[tenantId, settlementPeriod]`
- `[tenantId, claimNo]` UNIQUE

---

**STEP 2: Invoice Entity**

Dosya: `src/database/entities/invoice.entity.ts`

```typescript
export enum InvoiceMatchStatus {
  UNMATCHED = 'UNMATCHED',
  MATCHED = 'MATCHED',
  PARTIAL = 'PARTIAL',
  DISPUTED = 'DISPUTED'
}
```

Alan listesi:
- `id` (uuid, PK)
- `tenantId` (uuid, FK → tenants)
- `agreementId` (uuid, FK → agreements, **zorunlu** — Phase-1: 1 fatura = 1 agreement)
- `claimId` (uuid, FK → claims, nullable — matching sonrası set edilir)
- `invoiceNo` (varchar 100, **zorunlu**)
- `invoiceDate` (date, **zorunlu**)
- `settlementPeriod` (varchar 7, format: `YYYY-MM`, **zorunlu** — fatura tarihi ≠ promosyon dönemi olabilir)
- `amount` (decimal 18,2, **zorunlu**)
- `currency` (varchar 3, default: 'TRY')
- `matchStatus` (InvoiceMatchStatus enum, default: UNMATCHED)
- `matchedAt` (timestamp, nullable)
- `matchedBy` (uuid, nullable, FK → users)
- `claimAmount` (decimal 18,2, nullable) — eşleşen claim'in tutarı
- `varianceAmount` (decimal 18,2, nullable) — invoice.amount - claim.amount
- `attachmentUrl` (text, nullable) — fatura PDF/görsel URL (Phase 1.5)
- `enteredBy` (uuid, FK → users)
- `notes` (text, nullable)

Index'ler:
- `[tenantId, agreementId]`
- `[tenantId, invoiceNo, invoiceDate]` UNIQUE per tenant
- `[tenantId, matchStatus]`
- `[tenantId, settlementPeriod]`

---

**STEP 3: Migration**

Dosya: `src/database/migrations/1776000000000-AddClaimAndInvoiceEntities.ts`

Migration `up()` sırası:
1. `CREATE TYPE main.claim_status_enum` (DRAFT, SUBMITTED, APPROVED, INVOICED, CLOSED, REJECTED)
2. `CREATE TYPE main.claim_type_enum` (OFF_INVOICE, ON_INVOICE)
3. `CREATE TYPE main.invoice_match_status_enum` (UNMATCHED, MATCHED, PARTIAL, DISPUTED)
4. `CREATE TABLE main.claims` (tüm alanlar + index'ler)
5. `CREATE TABLE main.invoices` (tüm alanlar + index'ler)
6. `CREATE SEQUENCE main.claim_seq` — claimNo üretimi için

Migration `down()`:
- `DROP TABLE main.invoices`
- `DROP TABLE main.claims`
- `DROP SEQUENCE main.claim_seq`
- `DROP TYPE` (ters sıra)

⚠️ **Migration çalıştırılmayacak.** Sadece oluştur.

---

### PHASE 2: Backend — Module & Service

**STEP 4: Claim Module**

Dizin: `src/modules/modes/actuals-first/claim/`

Dosyalar:
- `claim.module.ts`
- `claim.service.ts`
- `claim.controller.ts`
- `dto/create-claim.dto.ts`
- `dto/update-claim.dto.ts`
- `dto/submit-claim.dto.ts`
- `dto/close-claim.dto.ts`

**ClaimService metodları:**

```typescript
// Claim oluştur (sadece ACTIVE agreement'tan)
createClaim(dto: CreateClaimDto, userId: string): Promise<Claim>

// Claim listesi (agreement bazlı)
findByAgreement(agreementId: string, tenantId: string): Promise<Claim[]>

// Claim detay
findOne(id: string, tenantId: string): Promise<Claim>

// Claim güncelle (sadece DRAFT status'ta)
updateClaim(id: string, dto: UpdateClaimDto, tenantId: string): Promise<Claim>

// Claim onaya gönder (DRAFT → SUBMITTED)
submitClaim(id: string, tenantId: string, userId: string): Promise<Claim>

// Claim onayla (SUBMITTED → APPROVED) — sadece MANAGER
approveClaim(id: string, tenantId: string, userId: string): Promise<Claim>

// Claim reddet (SUBMITTED → REJECTED) — sadece MANAGER
rejectClaim(id: string, reason: string, tenantId: string, userId: string): Promise<Claim>

// Claim kapat (APPROVED/INVOICED → CLOSED) — remaining budget RELEASE
closeClaim(id: string, dto: CloseClaimDto, tenantId: string, userId: string): Promise<Claim>
```

**closeClaim iş kuralı (kritik):**
```
remainingAmount = claim.plannedAmount - claim.invoicedAmount
IF remainingAmount > 0:
  → BudgetTransaction (type: RELEASE, amount: remainingAmount)
  → BudgetEnvelope.available += remainingAmount
claim.status → CLOSED
claim.closedAt = now()
```

**Endpoint'ler:**

| Method | Path | Roller | Açıklama |
|--------|------|--------|----------|
| POST | /claims | PLANNER, MANAGER, ADMIN | Claim oluştur |
| GET | /claims | PLANNER, MANAGER, FINANCE, FINANCE_MANAGER, CATEGORY_MANAGER, READONLY, ADMIN | Liste |
| GET | /claims/:id | (aynı) | Detay |
| PATCH | /claims/:id | PLANNER, MANAGER, ADMIN | Güncelle (DRAFT only) |
| POST | /claims/:id/submit | PLANNER, MANAGER, ADMIN | Onaya gönder |
| POST | /claims/:id/approve | MANAGER, ADMIN | Onayla |
| POST | /claims/:id/reject | MANAGER, ADMIN | Reddet |
| POST | /claims/:id/close | MANAGER, ADMIN | Kapat + budget RELEASE |

---

**STEP 5: Invoice Module**

Dizin: `src/modules/modes/actuals-first/invoice/`

Dosyalar:
- `invoice.module.ts`
- `invoice.service.ts`
- `invoice.controller.ts`
- `dto/create-invoice.dto.ts`
- `dto/match-invoice.dto.ts`

**InvoiceService metodları:**

```typescript
// Fatura gir (manuel)
createInvoice(dto: CreateInvoiceDto, userId: string): Promise<Invoice>

// Fatura listesi
findAll(tenantId: string, filters?: InvoiceFilters): Promise<Invoice[]>

// Fatura detay
findOne(id: string, tenantId: string): Promise<Invoice>

// Auto-match attempt: agreement + settlementPeriod + amount karşılaştır
attemptAutoMatch(invoiceId: string, tenantId: string): Promise<Invoice>

// Manuel eşleştir
manualMatch(invoiceId: string, claimId: string, tenantId: string, userId: string): Promise<Invoice>
```

**Auto-match iş kuralı:**
```
Invoice (agreementId + settlementPeriod) → İlgili APPROVED claim'leri bul
IF claim.plannedAmount === invoice.amount:
  → matchStatus: MATCHED
  → claim.invoicedAmount += invoice.amount
  → claim.status → INVOICED (eğer tam eşleşme)
  → LedgerEntry (type: CONSUME)
ELSE IF abs(claim.plannedAmount - invoice.amount) > threshold:
  → matchStatus: DISPUTED → manuel inceleme kuyruğu
ELSE:
  → matchStatus: PARTIAL
```

**Endpoint'ler:**

| Method | Path | Roller | Açıklama |
|--------|------|--------|----------|
| POST | /invoices | FINANCE, FINANCE_MANAGER, MANAGER, ADMIN | Fatura gir |
| GET | /invoices | FINANCE, FINANCE_MANAGER, MANAGER, READONLY, ADMIN | Liste |
| GET | /invoices/:id | (aynı) | Detay |
| POST | /invoices/:id/match | FINANCE, FINANCE_MANAGER, MANAGER, ADMIN | Auto-match |
| POST | /invoices/:id/manual-match | FINANCE, FINANCE_MANAGER, MANAGER, ADMIN | Manuel eşleştir |
| GET | /invoices/unmatched | FINANCE, FINANCE_MANAGER, MANAGER, ADMIN | Eşleşmemiş faturalar |

---

### PHASE 3: Frontend

**STEP 6: Claim sayfaları**

Dosyalar (Next.js App Router):
- `src/app/(main)/claims/page.tsx` — Claim listesi
- `src/app/(main)/claims/[id]/page.tsx` — Claim detay + aksiyon butonları
- `src/app/(main)/claims/new/page.tsx` — Yeni claim formu
- `src/components/claims/ClaimStatusBadge.tsx` — Status badge (renk kodlu)
- `src/components/claims/ClaimActionButtons.tsx` — Submit/Approve/Reject/Close butonları (rol bazlı)
- `src/services/claims.service.ts` — API calls + permission hook

**ClaimStatusBadge renkleri:**
- DRAFT → gri
- SUBMITTED → sarı
- APPROVED → mavi
- INVOICED → mor
- CLOSED → yeşil
- REJECTED → kırmızı

**Permission kuralları (frontend):**
- Submit butonu: sadece DRAFT claim + PLANNER/MANAGER/ADMIN
- Approve/Reject: sadece SUBMITTED claim + MANAGER/ADMIN
- Close: sadece APPROVED/INVOICED claim + MANAGER/ADMIN
- READONLY: sadece görüntüleme, hiçbir aksiyon butonu yok

---

**STEP 7: Invoice sayfaları**

Dosyalar:
- `src/app/(main)/invoices/page.tsx` — Fatura listesi (eşleşmemiş kuyruğu dahil)
- `src/app/(main)/invoices/new/page.tsx` — Manuel fatura giriş formu
- `src/components/invoices/InvoiceMatchStatus.tsx` — Match status badge
- `src/services/invoices.service.ts` — API calls

**Fatura giriş formu zorunlu alanlar:**
1. Invoice No
2. Invoice Date
3. Settlement Period (YYYY-MM picker)
4. Agreement (dropdown — sadece ACTIVE agreement'lar)
5. Amount
6. (Opsiyonel) Notes

---

**STEP 8: Navigation güncelleme**

`src/components/layout/Sidebar.tsx` veya navigation config dosyasına ekle:
- Claims menü item'ı (PLANNER, MANAGER, FINANCE, FINANCE_MANAGER, CATEGORY_MANAGER, READONLY, ADMIN)
- Invoices menü item'ı (FINANCE, FINANCE_MANAGER, MANAGER, ADMIN)

---

### PHASE 4: Seed güncelleme

**STEP 9: Seed'e örnek claim ve invoice ekle**

`src/database/seeds/user.seed.ts` veya yeni `claim.seed.ts` dosyası:

Mevcut APPROVED agreement için:
- 1 adet APPROVED Claim (settlementPeriod: `2026-03`)
- 1 adet INVOICED Claim (settlementPeriod: `2026-02`, eşleşmiş invoice ile)
- 1 adet UNMATCHED Invoice (test için)

---

## BLOCK 4 — MIGRATION RULES

- ⚠️ Migration oluştur, **çalıştırma**
- `down()` metodu tam yazılmalı — `DROP TABLE` ve `DROP TYPE` dahil
- Sequence için `CREATE SEQUENCE IF NOT EXISTS` kullan
- Foreign key'ler: `agreement_id → main.agreements(id)`, `claim_id → main.claims(id)`
- Timestamp'i `1776000000000` olarak kullan (son migration'dan büyük)

---

## BLOCK 5 — VALIDATION CHECKLIST (Preflight)

Windsurf implementasyon bitmeden şunları grep ile doğrula:

```bash
# Claim entity kontrol
grep -n "ClaimStatus\|ClaimType" src/database/entities/claim.entity.ts

# Invoice entity kontrol
grep -n "InvoiceMatchStatus\|settlementPeriod" src/database/entities/invoice.entity.ts

# Migration dosyası var mı?
ls src/database/migrations/1776000000000-AddClaimAndInvoiceEntities.ts

# Endpoint rol kontrolü
grep -n "@Roles" src/modules/modes/actuals-first/claim/claim.controller.ts
grep -n "@Roles" src/modules/modes/actuals-first/invoice/invoice.controller.ts

# TypeScript hata kontrolü
npx tsc --noEmit 2>&1 | head -30

# Frontend: READONLY için create buton yok mu?
grep -n "READONLY\|isReadOnly" src/components/claims/ClaimActionButtons.tsx
```

---

## BLOCK 6 — CONSTRAINTS

| Kural | Detay |
|-------|-------|
| Claim sadece ACTIVE agreement'tan | Agreement status kontrolü zorunlu |
| Phase-1: 1 fatura = 1 agreement | Invoice'da agreementId zorunlu |
| settlementPeriod zorunlu alan | Her iki entity'de de null olamaz |
| READONLY hiçbir yazma işlemi yapamaz | Frontend + backend her ikisinde kontrol |
| Migration çalıştırılmayacak | Sadece dosya oluştur |
| Budget RELEASE sadece closeClaim'de | Başka bir yerde tetiklenme |
| down() tam yazılacak | Geri alım senaryosu için |

---

## BLOCK 7 — SEQUENTIAL MERGE ORDER

Bu sprint iki repo içeriyor. Merge sırası:

1. **Backend branch:** `feature/sprint-e-001-claim-invoice`
   - Entity'ler, migration, service, controller
   - PR: `feature/sprint-e-001-claim-invoice → staging`
   - Merge sonrası: `npm run migration:run` (manuel, Sertaç çalıştırır)
   - 5 dk doğrulama: Swagger'dan POST /claims test

2. **Frontend branch:** `feature/sprint-e-001-claim-invoice` (aynı branch adı, farklı repo)
   - Sayfa bileşenleri, service, navigation
   - PR: `feature/sprint-e-001-claim-invoice → staging`
   - Backend merge'den sonra açılır

---

## BLOCK 8 — VERIFICATION (CoWork)

Backend merge + migration çalıştırıldıktan sonra CoWork test akışı:

| Test | Kullanıcı | Beklenen |
|------|-----------|---------|
| Claim oluştur | planner@wella.com | 201 Created, status: DRAFT |
| Claim submit | planner@wella.com | status: SUBMITTED |
| Claim approve | manager@wella.com | status: APPROVED |
| Fatura gir | finance@wella.com | 201 Created, matchStatus: UNMATCHED |
| Auto-match | finance@wella.com | matchStatus: MATCHED, claim → INVOICED |
| Close claim | manager@wella.com | status: CLOSED, budget RELEASE görünür |
| READONLY engel | readonly@wella.com | 403 Forbidden on POST /claims |

---

**END OF SPRINT-E-001 SAFE PROMPT**

**Changelog:**
- v1.0 (2026-03-06): Initial draft — Claim + Invoice settlement engine

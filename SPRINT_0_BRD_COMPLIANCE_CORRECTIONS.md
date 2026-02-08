# Sprint 0: BRD Compliance Corrections
## Critical Uyumsuzluklar ve Düzeltmeler

**Date:** January 2026  
**Status:** ✅ Düzeltildi

---

## Tespit Edilen Uyumsuzluklar

### 1. ✅ DÜZELTİLDİ: State İsimlendirmesi

**Sorun:**
- Sprint dokümanlarında: `SUBMITTED`, `TERMINATED`
- BRD'de: `PENDING`, `CANCELLED`

**Düzeltme:**
- Tüm dokümanlarda `SUBMITTED` → `PENDING` olarak değiştirildi
- Tüm dokümanlarda `TERMINATED` → `CANCELLED` olarak değiştirildi

**Etkilenen Dosyalar:**
- SPRINT_01_DOMAIN_ENTITIES.md
- SPRINT_02_AGREEMENT_STATE_MACHINE.md
- SPRINT_03_APPROVAL_MODEL.md
- SPRINT_04_BUDGET_RESERVATION_DESIGN.md
- SPRINT_0_OFF_INVOICE_FLOW.md

---

### 2. ✅ DÜZELTİLDİ: Budget Reservation Entity Yapısı

**Sorun:**
- Sprint dokümanlarında: Ayrı `BudgetReservation` entity'si tanımlanmış
- BRD'de: `budget_reservations` tablosu YOK
- BRD'de: Budget reservations, `budget_transactions` tablosunda `RESERVE` tipinde transaction olarak tutuluyor (event-sourced approach)

**BRD Referansı:**
- Section 3.3: "budget_transactions (immutable event log)"
- Section 4.8: "Create RESERVE transaction" (not BudgetReservation)
- Section 3.3: "Reserved: budget_transactions (RESERVE - RELEASE)"

**Düzeltme:**
- `SPRINT_01_DOMAIN_ENTITIES.md`: BudgetReservation entity referansları kaldırıldı
- `SPRINT_04_BUDGET_RESERVATION_DESIGN.md`: BudgetTransaction (RESERVE type) olarak güncellendi
- Event-sourced approach açıklandı
- `v_budget_summary` view kullanımı eklendi

**Kritik Değişiklik:**
```
ÖNCE (Yanlış):
- BudgetReservation entity (ayrı tablo)
- budget_reservations tablosu

SONRA (BRD Uyumlu):
- BudgetTransaction entity
- tx_type = 'RESERVE' olan transaction'lar
- budget_transactions tablosu (event-sourced)
```

---

### 3. ✅ DÜZELTİLDİ: Budget Envelope Computed Fields

**Sorun:**
- Mevcut kod: `budget-envelope.entity.ts`'de `reserved_amount`, `consumed_amount`, `available_amount` stored fields olarak var
- BRD'de: Bu alanlar stored DEĞİL, computed (via `v_budget_summary` view)

**BRD Referansı:**
- Section 3.3: "committed/reserved/consumed are **not stored** in budget_envelopes table"
- Section 3.3: "Instead, they are **computed** from budget_transactions and ledger_entries"
- Section 3.3: "This eliminates dual-write issues and ensures consistency"

**Düzeltme:**
- `SPRINT_01_DOMAIN_ENTITIES.md`: Budget Envelope fields güncellendi
- Computed fields açıklandı
- `v_budget_summary` view kullanımı belirtildi

**Kritik Değişiklik:**
```
ÖNCE (Yanlış):
- reserved_amount: stored field
- consumed_amount: stored field
- available_amount: stored field

SONRA (BRD Uyumlu):
- reserved: computed from budget_transactions (via v_budget_summary)
- consumed: computed from ledger_entries (via v_budget_summary)
- available: computed (allocated - reserved - consumed)
```

---

## BRD Uyumluluk Kontrolü

### ✅ Agreement Lifecycle States
- BRD: DRAFT | PENDING | APPROVED | ACTIVE | CLOSED | REJECTED | CANCELLED
- Sprint: ✅ Uyumlu (düzeltildi)

### ✅ Budget Reservation Approach
- BRD: Event-sourced (budget_transactions with RESERVE type)
- Sprint: ✅ Uyumlu (düzeltildi)

### ✅ Budget Envelope Fields
- BRD: Computed fields (via v_budget_summary view)
- Sprint: ✅ Uyumlu (düzeltildi)

### ✅ Agreement Schema
- BRD: status enum, approval_request_id, consumed_amount
- Sprint: ✅ Uyumlu

### ✅ Off-Invoice Flow
- BRD: Batch import (Phase 1), single entry (Sprint 0)
- Sprint: ✅ Uyumlu (Sprint 0 için single entry)

---

## Notlar

### Mevcut Kodda Kalan Uyumsuzluklar

**budget-reservation.entity.ts:**
- Bu entity BRD'de yok
- Gelecekte kaldırılmalı veya migration yapılmalı
- BRD'ye göre: `budget_transactions` tablosu kullanılmalı

**budget-envelope.entity.ts:**
- `reserved_amount`, `consumed_amount`, `available_amount` stored fields olarak var
- BRD'ye göre: Bu alanlar computed olmalı (via `v_budget_summary` view)
- Migration gerekli: Bu alanlar kaldırılmalı, view kullanılmalı

**Öneri:**
- Sprint 1'de bu entity'ler BRD'ye uygun hale getirilmeli
- Migration script'leri hazırlanmalı
- `v_budget_summary` view implement edilmeli

---

## Sonuç

**Düzeltilen:**
- ✅ State isimlendirmesi (PENDING, CANCELLED)
- ✅ Budget reservation entity yapısı (event-sourced)
- ✅ Budget envelope computed fields açıklaması

**Kalan (Implementation'da düzeltilecek):**
- ⚠️ `budget-reservation.entity.ts` kaldırılmalı
- ⚠️ `budget-envelope.entity.ts` computed fields migration'ı
- ⚠️ `v_budget_summary` view implement edilmeli
- ⚠️ `BudgetTransaction` entity'sinde `CONSUME` type kaldırılmalı (BRD'de yok)

### 4. ✅ DÜZELTİLDİ: BudgetTransaction CONSUME Type

**Sorun:**
- Sprint dokümanlarında: `CONSUME` transaction type tanımlanmış
- BRD'de: `CONSUME` transaction type YOK
- BRD'de: Consumed amount `ledger_entries` tablosundan computed olarak geliyor

**BRD Referansı:**
- Section 3.3: Transaction Types: ALLOCATE, COMMIT, RESERVE, RELEASE, TRANSFER, ADJUST
- Section 3.3: "Consumed: ledger_entries (budget_envelope_id)"
- Section 3.3: Consumed amount computed from `ledger_entries`, not from transactions

**Düzeltme:**
- `SPRINT_01_DOMAIN_ENTITIES.md`: CONSUME type kaldırıldı
- Consumed amount'un `ledger_entries`'den computed olduğu açıklandı

### 5. ✅ DÜZELTİLDİ: BudgetTransaction CONSUME Type

**Sorun:**
- Sprint dokümanlarında: `CONSUME` transaction type tanımlanmış
- BRD'de: `CONSUME` transaction type YOK
- BRD'de: Consumed amount `ledger_entries` tablosundan computed olarak geliyor

**BRD Referansı:**
- Section 3.3: Transaction Types: ALLOCATE, COMMIT, RESERVE, RELEASE, TRANSFER, ADJUST
- Section 3.3: "Consumed: ledger_entries (budget_envelope_id)"
- Section 3.3: Consumed amount computed from `ledger_entries`, not from transactions

**Düzeltme:**
- `SPRINT_01_DOMAIN_ENTITIES.md`: CONSUME type kaldırıldı
- Consumed amount'un `ledger_entries`'den computed olduğu açıklandı

### 6. ✅ NOT: Entity İsimlendirmesi (Minor)

**Durum:**
- BRD'de: `agreement_transactions` tablosu
- Sprint dokümanlarında: `OffInvoiceEntry` entity
- **Not:** Bu sadece isimlendirme farkı, konsept aynı
- BRD'de de "Off-Invoice Entry" olarak bahsediliyor ama tablo adı `agreement_transactions`
- **Kabul edilebilir:** Entity ismi `AgreementTransaction` veya `OffInvoiceEntry` olabilir

**Status:** ✅ Sprint dokümanları BRD ile uyumlu

---

**Last Updated:** January 2026


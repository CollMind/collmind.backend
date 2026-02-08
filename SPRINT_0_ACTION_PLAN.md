# Sprint 0 Eksiklikler - Action Plan
## Ne Yapılmalı?

**Tarih:** Ocak 2026  
**Durum:** ⚠️ Eksiklikler Tespit Edildi  
**Referans:** `SPRINT_0_AUDIT_REPORT.md` ve `SPRINT_0_MISSING_ARTIFACTS.md`

---

## 🎯 Özet

Sprint 0 kurallarına göre **3 ana eksiklik** var:

1. ❌ **State Machines** - Tanımlanmamış
2. ❌ **Sequence Diagrams (Textual)** - Yok
3. ❌ **Pseudocode for Critical Flows** - Yok

Bu eksiklikler **Sprint 0'ın temel çıktıları** olduğu için mutlaka tamamlanmalı.

---

## 📋 Yapılacaklar Listesi

### ✅ Adım 1: State Machine Dokümantasyonu

**Ne Yapılacak:**
- Budget Reservation için state machine tanımla
- Agreement Lifecycle için state machine tanımla
- Budget Envelope için state machine tanımla

**Nasıl Yapılacak:**
1. `SPRINT_0_MISSING_ARTIFACTS.md` dosyasındaki state machine tanımlarını kullan
2. Her state machine için:
   - States (durumlar) listele
   - Transitions (geçişler) tanımla
   - Guard conditions (koşullar) belirle
   - Side effects (yan etkiler) dokümante et

**Çıktı:**
- `docs/sprint0/state-machines.md` dosyası oluştur
- Veya mevcut `SPRINT_0_MISSING_ARTIFACTS.md` içinde bölüm olarak bırak

**Süre:** 1-2 saat

---

### ✅ Adım 2: Sequence Diagram Dokümantasyonu

**Ne Yapılacak:**
- Budget Reservation flow için sequence diagram (textual)
- Approval Workflow için sequence diagram
- Customer Import flow için sequence diagram

**Nasıl Yapılacak:**
1. `SPRINT_0_MISSING_ARTIFACTS.md` dosyasındaki sequence diagram örneklerini kullan
2. Her flow için:
   - Actors (aktörler) belirle
   - System components (sistem bileşenleri) tanımla
   - Message flow (mesaj akışı) dokümante et
   - Alternative flows (alternatif akışlar) ekle

**Çıktı:**
- `docs/sprint0/sequence-diagrams.md` dosyası oluştur
- Veya mevcut `SPRINT_0_MISSING_ARTIFACTS.md` içinde bölüm olarak bırak

**Süre:** 2-3 saat

---

### ✅ Adım 3: Pseudocode Dokümantasyonu

**Ne Yapılacak:**
- Budget Reservation with Concurrency Control için pseudocode
- Approval Workflow için pseudocode
- Batch Import Error Handling için pseudocode

**Nasıl Yapılacak:**
1. `SPRINT_0_MISSING_ARTIFACTS.md` dosyasındaki pseudocode örneklerini kullan
2. Her flow için:
   - Function signature tanımla
   - Step-by-step logic yaz
   - Error handling ekle
   - Edge cases belirt

**Çıktı:**
- `docs/sprint0/pseudocode.md` dosyası oluştur
- Veya mevcut `SPRINT_0_MISSING_ARTIFACTS.md` içinde bölüm olarak bırak

**Süre:** 2-3 saat

---

### ✅ Adım 4: Review ve Doğrulama

**Ne Yapılacak:**
- Tüm dokümantasyonu gözden geçir
- Domain requirements ile uyumluluğu kontrol et
- Sprint 0 checklist'i güncelle

**Nasıl Yapılacak:**
1. Engineering Lead ile review yap
2. Product Owner ile doğrulama yap
3. `SPRINT_0_AUDIT_REPORT.md` dosyasını güncelle (eksiklikler tamamlandı olarak işaretle)

**Çıktı:**
- Review notları
- Güncellenmiş audit report
- Sprint 0 completion checklist

**Süre:** 1 saat

---

## 🚀 Hızlı Başlangıç

### Seçenek 1: Tek Dosyada Topla (Önerilen)

Mevcut `SPRINT_0_MISSING_ARTIFACTS.md` dosyası zaten tüm eksiklikleri içeriyor. Bu dosyayı:

1. ✅ Review et
2. ✅ Gerekirse düzelt/ekle
3. ✅ `docs/sprint0/` klasörüne taşı (opsiyonel)
4. ✅ Audit report'ta "tamamlandı" olarak işaretle

**Avantaj:** Hızlı, tek dosyada tüm bilgi

---

### Seçenek 2: Ayrı Dosyalara Böl

1. `docs/sprint0/state-machines.md` oluştur
2. `docs/sprint0/sequence-diagrams.md` oluştur
3. `docs/sprint0/pseudocode.md` oluştur
4. Her birini ayrı ayrı dokümante et

**Avantaj:** Daha organize, modüler

---

## 📝 Detaylı Adımlar

### State Machines İçin

**Örnek Format:**
```markdown
## Budget Reservation State Machine

**States:**
- PENDING
- APPROVED
- REJECTED
- COMMITTED
- CANCELLED

**Transitions:**
- PENDING → APPROVED (via approve)
- PENDING → REJECTED (via reject)
- PENDING → CANCELLED (via cancel)
- APPROVED → COMMITTED (via commit)

**Guard Conditions:**
- approve(): Requires APPROVER role, cannot be self-approval
- reject(): Requires APPROVER role
- cancel(): Only requester can cancel

**Side Effects:**
- approve(): Budget reserved, notification sent
- reject(): Budget released, notification sent
```

**Kaynak:** `SPRINT_0_MISSING_ARTIFACTS.md` - Bölüm 1

---

### Sequence Diagrams İçin

**Örnek Format:**
```
Actor: Planner
System: BudgetService
Database: PostgreSQL

Planner -> BudgetService: reserveBudget(...)
BudgetService -> Database: SELECT FOR UPDATE
Database -> BudgetService: envelope
BudgetService -> Database: INSERT reservation
BudgetService -> Planner: return reservation
```

**Kaynak:** `SPRINT_0_MISSING_ARTIFACTS.md` - Bölüm 2

---

### Pseudocode İçin

**Örnek Format:**
```pseudocode
FUNCTION reserveBudget(tenantId, userId, envelopeId, amount):
    BEGIN TRANSACTION
    envelope = SELECT FOR UPDATE ...
    IF envelope.available_amount < amount:
        THROW BadRequestException
    INSERT reservation
    UPDATE envelope
    COMMIT
    RETURN reservation
END FUNCTION
```

**Kaynak:** `SPRINT_0_MISSING_ARTIFACTS.md` - Bölüm 3

---

## ⚠️ Önemli Notlar

### 1. Production Kod YAZMA
- ❌ State machine'leri kod olarak implemente etme
- ❌ Sequence diagram'ları gerçek API call'larına çevirme
- ❌ Pseudocode'u gerçek kod olarak yazma

**Sprint 0'da sadece:**
- ✅ Dokümantasyon
- ✅ Mimari validasyon
- ✅ Risk eliminasyonu

### 2. Mevcut Kod ile İlişki
- Mevcut production kodlar **referans** olarak kullanılabilir
- Ama Sprint 0 çıktıları **dokümantasyon** olmalı
- Production kod Phase 1'de yazılacak

### 3. Format
- Markdown formatında
- Textual (metin tabanlı)
- Görsel diagram'lar opsiyonel (Sprint 0 için gerekli değil)

---

## ✅ Tamamlandı Kontrol Listesi

- [ ] State Machines dokümante edildi
  - [ ] Budget Reservation State Machine
  - [ ] Agreement Lifecycle State Machine
  - [ ] Budget Envelope State Machine

- [ ] Sequence Diagrams dokümante edildi
  - [ ] Budget Reservation Flow
  - [ ] Approval Workflow
  - [ ] Customer Import Flow

- [ ] Pseudocode dokümante edildi
  - [ ] Budget Reservation with Concurrency
  - [ ] Approval Workflow
  - [ ] Batch Import Error Handling

- [ ] Review yapıldı
  - [ ] Engineering Lead review
  - [ ] Product Owner validation
  - [ ] Audit report güncellendi

---

## 🎯 Sonuç

**Toplam Süre Tahmini:** 6-9 saat

**Öncelik:**
1. 🔴 **Yüksek:** State Machines (mimari validasyon için kritik)
2. 🟡 **Orta:** Sequence Diagrams (akış anlaşılabilirliği için)
3. 🟢 **Düşük:** Pseudocode (detaylı implementasyon rehberi)

**Sonraki Adım:**
`SPRINT_0_MISSING_ARTIFACTS.md` dosyasını review et ve gerekirse düzelt/ekle.

---

**Durum:** 📝 Hazır - İmplementasyona Başlanabilir  
**Son Güncelleme:** Ocak 2026



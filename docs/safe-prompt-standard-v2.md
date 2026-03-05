# CollMind TPM — SAFE PROMPT Standardı v2.0
**Geçerlilik:** Sprint D ve sonrası  
**Ortam:** Bitbucket · Staging server · 2-3 geliştirici · Docker Compose  
**Güncelleme tarihi:** Mart 2026  
**Versiyon:** v2.1

---

## NEDEN BU STANDART?

Sprint C'ye kadar tek geliştirici + local Docker yeterliydi.  
Sprint D'den itibaren:
- Bitbucket'ta `staging` + `feature/*` branch yapısı var — **iki ayrı repo: collmind-backend + collmind-frontend**
- Aktif staging sunucusu var — yanlış migration gerçek veriyi bozar
- 2-3 geliştirici aynı anda feature branch açabilir — çakışma riski var
- Bazı feature'lar her iki repo'yu eş zamanlı etkiler — merge sırası kritik
- Her SAFE PROMPT artık "bu kodu kim hangi ortamda çalıştıracak" sorusunu yanıtlamalı

---

## SAFE PROMPT ANATOMİSİ

Her implementation prompt aşağıdaki 8 bloktan oluşur. Bloklar sırayla yazılır, hiç atlanamaz.

```
┌─────────────────────────────────────────┐
│  BLOCK 1 · HEADER                       │  Kim, ne, nerede, hangi sprint
│  BLOCK 2 · CONTEXT                      │  Stack, path, BRD ref, sprint geçmişi
│  BLOCK 3 · BRANCH & DEPLOYMENT PLAN     │  Git akışı + staging prosedürü
│  BLOCK 4 · MIGRATION SAFETY             │  DB değişiklik varsa zorunlu
│  BLOCK 5 · SCOPE                        │  IN / OUT of scope
│  BLOCK 6 · CONSTRAINTS                  │  Kırılmaması gereken kurallar
│  BLOCK 7 · IMPLEMENTATION STEPS         │  Sıralı, atomik adımlar
│  BLOCK 8 · VERIFICATION CHECKLIST       │  Her adım sonrası kontrol listesi
└─────────────────────────────────────────┘
```

---

## BLOCK 1 — HEADER (zorunlu alanlar)

```
# SAFE PROMPT — [Özellik Adı]
Sprint      : [D / E / ...]
Phase       : IMPLEMENT | PREFLIGHT | HOTFIX
Ticket      : [Bitbucket issue no]
Branch      : feature/[kısa-isim]  →  staging
Preflight   : Tamamlandı — [N bulgu] | Atlandı — [gerekçe]
Assigned to : Windsurf (Sonnet) | [Geliştirici adı]
Date        : [Tarih]
Reviewer    : [PR reviewer adı]
```

---

## BLOCK 2 — CONTEXT (zorunlu alanlar)

```
Project   : CollMind TPM Platform
Stack     : NestJS + TypeORM + PostgreSQL · Next.js 14 · TypeScript monorepo
Local path: /Users/sertact/Documents/CollMind/Code/TPM/
Backend   : collmind-backend/src/
Frontend  : collmind-frontend/src/
BRD ref   : [Section ve madde numaraları]
Sprint dep: [Bağlı önceki sprint çalışması]

Bağlam özeti:
[2-3 cümle: neden yapılıyor, hangi problemi çözüyor]
```

---

## BLOCK 3 — BRANCH & DEPLOYMENT PLAN (her promptta zorunlu)

### Repo kapsamı
Önce hangi repo'ların etkilendiğini belirle:

```
Repo kapsamı: Backend only | Frontend only | Her ikisi
```

### Tek repo — Backend only veya Frontend only
```
Git akışı:
  1. git checkout staging && git pull origin staging
  2. git checkout -b feature/[kısa-isim]
  3. Tüm değişiklikler bu branch'te yapılır
  4. PR: feature/[isim] → staging
  5. Reviewer: [isim]
```

### İki repo — Her ikisi (koordineli sıralı merge)

Paralel geliştirme, sıralı merge. Backend her zaman önce.

```
Geliştirme (paralel — aynı anda):
  # Backend repo
  cd collmind-backend
  git checkout staging && git pull origin staging
  git checkout -b feature/[kısa-isim]

  # Frontend repo (aynı anda)
  cd collmind-frontend
  git checkout staging && git pull origin staging
  git checkout -b feature/[kısa-isim]   # aynı branch adı

Merge sırası (sıralı — backend önce):
  ADIM 1: collmind-backend PR aç → reviewer onaylar → staging'e merge
  ADIM 2: collmind-backend migration'ı çalıştır, backend deploy et
  ADIM 3: Backend staging'de sağlıklı çalıştığını doğrula (5 dk)
  ADIM 4: collmind-frontend PR aç → reviewer onaylar → staging'e merge
  ADIM 5: Frontend build et, deploy et

Neden bu sıra:
  - Frontend enum'ları backend enum'larına bağlı
  - Backend staging'de hazır olmadan frontend PR merge edilmez
  - Staging'de kısa süreli tutarsızlık riski sıfırlanır

Conflict riski:
  Paralel branch'ler : [varsa listele / Yok]
  Çakışma olası dosya: [varsa listele / Yok]
  Özellikle dikkat    : user.types.ts ↔ user.entity.ts enum senkronizasyonu
```

### Staging deploy komutları
```
Migration içeriyorsa (backend merge sonrası):
  cd collmind-backend
  npm run migration:run:prod
  npm run seed:prod          # gerekiyorsa
  pm2 restart collmind-backend

Sadece kod değişikliği:
  # Backend
  npm run build && pm2 restart collmind-backend
  # Frontend
  npm run build
```

---

## BLOCK 4 — MIGRATION SAFETY (DB değişikliği varsa zorunlu)

DB değişikliği yoksa: `N/A — DB değişikliği yok` yaz ve geç.

```
Migration dosyası:
  Adı       : [timestamp]-[Açıklama].ts
  Timestamp : [mevcut en yüksek + 1000]
  Tür       : DDL | DML | DDL+DML

Geri alınabilirlik:
  down() yazılacak mı : Evet | Hayır — [gerekçe]
  Rollback riski      : Yok | Düşük | Yüksek — [açıklama]

Local test (Windsurf yapmaz — geliştirici yapar):
  npm run migration:run
  npm run migration:revert   # geri alınabilir mi test et
  npm run migration:run      # tekrar çalışmalı (idempotent)

Staging checklist:
  [ ] Local'de test edildi
  [ ] Migration dosyası PR'a dahil
  [ ] Staging'de çalıştıracak kişi: [isim]
  [ ] Rollback planı: [açıklama]

Seed:
  Seed değişiyor mu            : Evet | Hayır
  Staging'de yeniden çalışacak : Evet — [hangi seed] | Hayır
  Pattern                      : upsert kullan, insert değil
```

---

## BLOCK 5 — SCOPE

```
IN scope:
  - [dosya seviyesinde maddeler]

OUT of scope:
  - [dosya ve gerekçe]
```

---

## BLOCK 6 — CONSTRAINTS

```
1. Branch    : Tüm değişiklikler feature/* branch'inde. staging/main'e direkt commit yok.
2. Migration : Dosya OLUŞTURULUR, ÇALIŞTIRILMAZ. npm run migration:run Windsurf çalıştırmaz.
3. Seed      : Upsert pattern zorunlu. Staging'de mevcut veri silinmez.
4. Test      : *.spec.ts bu promptun kapsamı dışında. [istisna varsa belirt]
5. Sıra      : Adımlar sırayla uygulanır. Bir adım bitmeden sonrakine geçilmez.
[+ prompta özel kısıtlamalar]
```

---

## BLOCK 7 — IMPLEMENTATION STEPS

Her adım şablonu:

```
## STEP [N] — [Açıklama]
Dosya  : [tam path]
Tür    : Yeni dosya | Mevcut değişiklik | Yeni migration
Etki   : Backend | Frontend | DB | Seed

[değişiklik — kod bloğu veya tablo]

Adım sonu kontrol:
  [ ] Derleniyor / lint geçiyor
  [ ] Beklenen davranış
```

Adım sıralama kuralı:
  1. Enum / entity tanımları (backend → frontend)
  2. Migration
  3. Service / controller
  4. Seed
  5. Frontend

---

## BLOCK 8 — VERIFICATION CHECKLIST

```
A. Windsurf self-check (implementation sonrası çalıştırır):
   [grep / tsc komutları]

B. CoWork UI test:
   Task dosyası: [dosya adı veya "Sprint X UI paketine eklenecek"]
   Senaryolar  : [kısa liste]

C. Staging doğrulama (geliştirici — PR merge sonrası):
   [ ] Migration çalıştı, hata yok
   [ ] Yeni rol/özellik login testiyle doğrulandı
   [ ] Mevcut veriler etkilenmedi
   [ ] [feature-specific kontroller]
```

---

## ARAÇ SORUMLULUK MATRİSİ

| Görev                    | Claude | Windsurf  | CoWork | Geliştirici |
|--------------------------|--------|-----------|--------|-------------|
| Preflight prompt yaz     | ✅     |           |        |             |
| Preflight çalıştır       |        | ✅ SWE-1  |        |             |
| Bulgu analizi            | ✅     |           |        |             |
| SAFE PROMPT yaz          | ✅     |           |        |             |
| Kodu implement et        |        | ✅ Sonnet |        |             |
| Migration dosyası oluştur|        | ✅        |        |             |
| Migration ÇALIŞTIR       |        | ❌        |        | ✅          |
| Seed çalıştır            |        | ❌        |        | ✅          |
| Branch aç / PR oluştur   |        |           |        | ✅          |
| CoWork task dosyası yaz  | ✅     |           |        |             |
| UI testleri çalıştır     |        |           | ✅     |             |
| Staging deploy           |        | ❌        |        | ✅          |
| Failure analizi          | ✅     |           |        |             |

---

## SAFE PROMPT TİPLERİ

| Tip       | Bloklar          | Model   | Ne zaman              |
|-----------|------------------|---------|-----------------------|
| PREFLIGHT | 1, 2, tarama     | SWE-1   | Her IMPL öncesi       |
| IMPLEMENT | Tüm 8 blok       | Sonnet  | Feature geliştirme    |
| HOTFIX    | 8 blok + EMERGENCY notu | Sonnet | Staging/prod acil fix |

---

## CHANGELOG

| Versiyon | Tarih      | Değişiklik                                              |
|----------|------------|---------------------------------------------------------|
| v1.0     | Ocak 2026  | İlk tanım — local, tek geliştirici                     |
| v2.0     | Mart 2026  | Block 3 + Block 4 eklendi, ekip/Bitbucket/staging desteği |
| v2.1     | Mart 2026  | İki repo mimarisi eklendi, koordineli sıralı merge kuralı |

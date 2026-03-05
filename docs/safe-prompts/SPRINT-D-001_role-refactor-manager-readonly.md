# SAFE PROMPT — Role Refactor: APPROVER→MANAGER + READONLY
Sprint      : D
Phase       : IMPLEMENT
Ticket      : TPM-142
Branch      : feature/role-refactor-manager-readonly → staging
Preflight   : Tamamlandı — 47 bulgu (4 CRITICAL, 7 HIGH)
Assigned to : Windsurf (Sonnet)
Date        : Mart 2026
Reviewer    : Sertaç

---

## CONTEXT

```
Project   : CollMind TPM Platform
Stack     : NestJS + TypeORM + PostgreSQL · React (Vite) · TypeScript
Local path: /Users/sertact/Documents/CollMind/Code/TPM/
Backend   : collmind-backend/src/
Frontend  : collmind-frontend/src/
BRD ref   : Section 07 — Security & Roles
Sprint dep: Sprint C — On-Invoice Recognition Engine, E2E test suite (18/18)
```

Bağlam özeti:
Mevcut kodda `APPROVER` rolü BRD'de tanımlanan `MANAGER` rolüne yeniden adlandırılacak.
Aynı anda BRD'de tanımlı `READONLY` rolü sisteme eklenecek — sadece GET endpoint'lerine erişim.
15 dosyada `APPROVER` referansı tespit edildi; migration ile DB enum güncellenmeli.

---

## BRANCH & DEPLOYMENT PLAN

Repo kapsamı: **Her ikisi** (backend + frontend)

### Geliştirme (paralel — aynı anda)
```
# Backend repo
cd collmind-backend
git checkout staging && git pull origin staging
git checkout -b feature/role-refactor-manager-readonly

# Frontend repo (aynı anda)
cd collmind-frontend
git checkout staging && git pull origin staging
git checkout -b feature/role-refactor-manager-readonly
```

### Merge sırası (sıralı — backend önce)
```
ADIM 1: collmind-backend PR aç → Sertaç onaylar → staging'e merge
ADIM 2: Migration çalıştır:
          cd collmind-backend
          npm run migration:run:prod
          pm2 restart collmind-backend
ADIM 3: Backend doğrula (5 dk) — manager@wella.com ile login test et
ADIM 4: collmind-frontend PR aç → Sertaç onaylar → staging'e merge
ADIM 5: npm run build (frontend)
```

Conflict riski:
  Paralel branch'ler : Yok (bu sprint'in ilk feature branch'i)
  Çakışma olası dosya: user.entity.ts ↔ user.types.ts enum senkronizasyonu — sıralı merge ile önlenir

---

## MIGRATION SAFETY

```
Migration dosyası:
  Adı       : 1775000000000-AddManagerAndReadonlyRoles.ts
  Timestamp : 1775000000000 (mevcut max 1774000000000 + 1000000)
  Tür       : DDL + DML

Geri alınabilirlik:
  down() yazılacak mı : Evet
  Rollback riski      : Düşük — PostgreSQL enum value silme mümkün değil,
                        down() sadece DML (UPDATE users SET role='APPROVER')

up() içeriği:
  1. ALTER TYPE users_role_enum ADD VALUE IF NOT EXISTS 'MANAGER'
  2. ALTER TYPE users_role_enum ADD VALUE IF NOT EXISTS 'READONLY'
  3. UPDATE users SET role='MANAGER' WHERE role='APPROVER'

down() içeriği:
  1. UPDATE users SET role='APPROVER' WHERE role='MANAGER'
  (READONLY ve enum value'lar PostgreSQL kısıtı nedeniyle kalmaya devam eder)

Local test (geliştirici yapar — Windsurf yapmaz):
  npm run migration:run
  npm run migration:revert
  npm run migration:run      # idempotent olmalı

Staging checklist:
  [ ] Local'de test edildi
  [ ] Migration dosyası PR'a dahil
  [ ] Staging'de çalıştıracak kişi: Sertaç
  [ ] Rollback planı: down() ile MANAGER→APPROVER DML

Seed:
  Seed değişiyor mu            : Evet — user.seed.ts
  Staging'de yeniden çalışacak : Hayır (upsert — mevcut veri korunur)
  Pattern                      : upsert (ON CONFLICT DO UPDATE)
  Yeni kullanıcılar            : manager@wella.com, readonly@wella.com
```

---

## SCOPE

```
IN scope:
  Backend:
  - src/database/entities/user.entity.ts          (UserRole enum)
  - src/database/migrations/1775000000000-AddManagerAndReadonlyRoles.ts  (yeni)
  - src/modules/shared/approval/approval.controller.ts  (@Roles decorator)
  - src/modules/shared/approval/approval.service.ts     (hardcoded 'APPROVER' string)
  - src/modules/modes/actuals-first/agreement/agreement.controller.ts
  - src/modules/modes/planning-first/plan/plan.controller.ts
  - src/database/seeds/user.seed.ts               (manager@wella.com, readonly@wella.com)
  - src/database/seeds/test-happy-path.ts         (approverUser → managerUser rename)

  Frontend:
  - src/types/user.types.ts                       (UserRole enum)
  - src/routes/index.tsx                          (role arrays)
  - src/services/agreements.service.ts            (permission hook)
  - src/components/common/EnumBadge.tsx           (MANAGER renk)
  - src/utils/roleUtils.ts                        (isReadOnly helper ekle)

OUT of scope:
  - Budget enforcement logic (Phase 2)
  - *.spec.ts dosyaları (ayrı sprint)
  - Yeni UI sayfaları
  - E2E test güncellemesi (ayrı CoWork görevi)
```

---

## CONSTRAINTS

```
1. Branch    : Tüm değişiklikler feature/role-refactor-manager-readonly branch'inde.
               staging/main'e direkt commit yok.
2. Migration : Dosya OLUŞTURULUR, ÇALIŞTIRILMAZ. npm run migration:run Windsurf çalıştırmaz.
3. Seed      : Upsert pattern zorunlu. Staging'de mevcut veri silinmez.
4. READONLY  : Sadece GET endpoint'lerine @Roles(UserRole.READONLY) eklenir.
               POST/PATCH/DELETE endpoint'lerine kesinlikle eklenmez.
5. APPROVER  : Enum'dan silinmez — deprecated olarak bırakılır (PostgreSQL kısıtı).
               Kod içinde UserRole.APPROVER referansı kaldırılır (enum tanımı hariç).
6. Sıra      : Adımlar sırayla uygulanır. Backend tamamlanmadan frontend'e geçilmez.
7. Push hatası: staging'e push reddedilirse alternatif branch denenmez — dur ve raporla.
```

---

## IMPLEMENTATION STEPS

### STEP 1 — Backend: UserRole enum güncelle
```
Dosya : collmind-backend/src/database/entities/user.entity.ts
Tür   : Mevcut değişiklik
Etki  : Backend — enum tanımı

Değişiklik:
export enum UserRole {
  ADMIN            = 'ADMIN',
  PLANNER          = 'PLANNER',
  CATEGORY_MANAGER = 'CATEGORY_MANAGER',
  FINANCE_MANAGER  = 'FINANCE_MANAGER',
  MANAGER          = 'MANAGER',    // ← YENİ (APPROVER yerine)
  READONLY         = 'READONLY',   // ← YENİ
  APPROVER         = 'APPROVER',   // ← DEPRECATED — silme, sadece bırak
}

Adım sonu kontrol:
  [ ] tsc --noEmit hata yok
```

### STEP 2 — Backend: Migration dosyası oluştur
```
Dosya : collmind-backend/src/database/migrations/1775000000000-AddManagerAndReadonlyRoles.ts
Tür   : Yeni dosya
Etki  : DB — DDL + DML

up():
  await queryRunner.query(`ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'MANAGER'`);
  await queryRunner.query(`ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'READONLY'`);
  await queryRunner.query(`UPDATE "main"."users" SET "role" = 'MANAGER' WHERE "role" = 'APPROVER'`);

down():
  await queryRunner.query(`UPDATE "main"."users" SET "role" = 'APPROVER' WHERE "role" = 'MANAGER'`);

Adım sonu kontrol:
  [ ] Dosya oluşturuldu, içerik doğru
  [ ] npm run migration:run çalıştırılmadı (geliştirici yapacak)
```

### STEP 3 — Backend: approval.service.ts hardcoded string temizle
```
Dosya : collmind-backend/src/modules/shared/approval/approval.service.ts
Tür   : Mevcut değişiklik
Etki  : Backend — servis logic

Değişiklik:
  'APPROVER' string literal → UserRole.MANAGER

Adım sonu kontrol:
  [ ] grep -r "'APPROVER'" src/ → sadece entity'de kalmalı
```

### STEP 4 — Backend: Controller @Roles decorator'ları güncelle
```
Dosyalar:
  - src/modules/shared/approval/approval.controller.ts
  - src/modules/modes/actuals-first/agreement/agreement.controller.ts
  - src/modules/modes/planning-first/plan/plan.controller.ts

Değişiklik:
  @Roles(UserRole.APPROVER) → @Roles(UserRole.MANAGER)

  READONLY için — sadece GET endpoint'lere ekle:
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.MANAGER, UserRole.READONLY)
  GET endpoint'leri için

Adım sonu kontrol:
  [ ] POST/PATCH/DELETE endpoint'lerinde READONLY yok
  [ ] tsc --noEmit hata yok
```

### STEP 5 — Backend: Seed güncelle
```
Dosya : collmind-backend/src/database/seeds/user.seed.ts
Tür   : Mevcut değişiklik
Etki  : Seed

Yeni kullanıcılar (upsert):
  manager@wella.com  — role: MANAGER,  password: admin
  readonly@wella.com — role: READONLY, password: admin

Mevcut approver@wella.com:
  role: APPROVER → MANAGER (upsert ile güncelle)

Adım sonu kontrol:
  [ ] Upsert pattern kullanıldı (ON CONFLICT DO UPDATE)
  [ ] insert() kullanılmadı
```

### STEP 6 — Backend: test-happy-path.ts değişkeni yeniden adlandır
```
Dosya : collmind-backend/src/database/seeds/test-happy-path.ts
Tür   : Mevcut değişiklik
Etki  : Seed

Değişiklik:
  approverUser → managerUser (değişken adı)
  APPROVER role referansı → MANAGER

Adım sonu kontrol:
  [ ] approverUser değişkeni kalmadı
```

### STEP 7 — Frontend: UserRole enum güncelle
```
Dosya : collmind-frontend/src/types/user.types.ts
Tür   : Mevcut değişiklik
Etki  : Frontend — tip tanımı

Değişiklik:
export enum UserRole {
  ADMIN            = 'ADMIN',
  PLANNER          = 'PLANNER',
  CATEGORY_MANAGER = 'CATEGORY_MANAGER',
  FINANCE_MANAGER  = 'FINANCE_MANAGER',
  MANAGER          = 'MANAGER',    // ← YENİ
  READONLY         = 'READONLY',   // ← YENİ
  APPROVER         = 'APPROVER',   // ← DEPRECATED — bırak
}

Adım sonu kontrol:
  [ ] Backend user.entity.ts ile senkron
```

### STEP 8 — Frontend: routes/index.tsx rol dizileri güncelle
```
Dosya : collmind-frontend/src/routes/index.tsx
Tür   : Mevcut değişiklik
Etki  : Frontend — route erişim kontrolü

Değişiklik:
  APPROVER → MANAGER (tüm allowedRoles dizileri)
  READONLY ekle — sadece read-only route'lara (listeler, detay sayfaları)
  READONLY çıkar — oluşturma, düzenleme, silme route'larından

Adım sonu kontrol:
  [ ] tsc --noEmit hata yok
```

### STEP 9 — Frontend: agreements.service.ts permission hook
```
Dosya : collmind-frontend/src/services/agreements.service.ts
Tür   : Mevcut değişiklik
Etki  : Frontend — izin kontrolü

Değişiklik:
  canApprove kontrolünde APPROVER → MANAGER
  canEdit, canDelete: READONLY hariç tutulduğundan emin ol

Adım sonu kontrol:
  [ ] READONLY kullanıcı approve butonunu göremez
```

### STEP 10 — Frontend: EnumBadge.tsx renk güncelle
```
Dosya : collmind-frontend/src/components/common/EnumBadge.tsx
Tür   : Mevcut değişiklik
Etki  : Frontend — UI

Değişiklik:
  APPROVER badge → MANAGER badge (aynı renk kullanılabilir)
  READONLY badge ekle — gri ton önerilir

Adım sonu kontrol:
  [ ] APPROVER badge kodu temizlendi (deprecated)
```

### STEP 11 — Frontend: roleUtils.ts isReadOnly helper ekle
```
Dosya : collmind-frontend/src/utils/roleUtils.ts
Tür   : Mevcut değişiklik
Etki  : Frontend — utility

Ekleme:
  export const isReadOnly = (role: UserRole): boolean =>
    role === UserRole.READONLY;

Adım sonu kontrol:
  [ ] Helper export edildi
  [ ] tsc --noEmit hata yok
```

---

## VERIFICATION CHECKLIST

### A. Windsurf self-check (implementation sonrası)
```bash
# 1. APPROVER hardcoded string kalmadı mı (backend)
grep -r "'APPROVER'" collmind-backend/src --include="*.ts" | grep -v "entity" | grep -v ".spec."

# 2. APPROVER hardcoded string kalmadı mı (frontend)
grep -r "'APPROVER'" collmind-frontend/src --include="*.ts" --include="*.tsx"

# 3. READONLY sadece GET'te mi
grep -r "READONLY" collmind-backend/src --include="*.controller.ts"

# 4. Migration dosyası var mı
ls collmind-backend/src/database/migrations/1775000000000-AddManagerAndReadonlyRoles.ts

# 5. Backend TypeScript derleme
cd collmind-backend && npx tsc --noEmit

# 6. Frontend TypeScript derleme
cd collmind-frontend && npx tsc --noEmit
```

### B. CoWork UI test
```
Task dosyası : Sprint D UI test paketine eklenecek
Senaryolar   :
  - manager@wella.com ile login → anlaşma onaylama butonu görünür
  - readonly@wella.com ile login → anlaşma listesi görünür, onay butonu gizli
  - readonly@wella.com ile login → yeni anlaşma oluşturma sayfasına erişim engellenir
  - admin@demo.local → mevcut akış bozulmadı
  - planner@demo.local → mevcut akış bozulmadı
```

### C. Staging doğrulama (geliştirici — backend PR merge sonrası)
```
[ ] npm run migration:run:prod — hata yok
[ ] psql: \dT+ main.users_role_enum — MANAGER ve READONLY görünüyor
[ ] manager@wella.com login → dashboard açılıyor
[ ] manager@wella.com → agreement approval çalışıyor
[ ] readonly@wella.com login → dashboard açılıyor
[ ] readonly@wella.com → approve butonu yok
[ ] Mevcut kullanıcılar (admin, planner, finance) etkilenmedi
[ ] approver@wella.com → MANAGER rolüyle login çalışıyor
```

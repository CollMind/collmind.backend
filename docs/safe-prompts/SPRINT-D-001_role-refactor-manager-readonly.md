# SAFE PROMPT — Role Refactoring: APPROVER→MANAGER + READONLY
Sprint      : D
Phase       : IMPLEMENT
Ticket      : TPM-142
Branch      : feature/role-refactor-manager-readonly  →  staging
Preflight   : Tamamlandı — 47 bulgu, 4 KRİTİK, 7 YÜKSEK (PREFLIGHT_role_refactor_EN.md)
Assigned to : Windsurf (Sonnet)
Date        : Mart 2026
Reviewer    : Sertaç

---

## CONTEXT

Project   : CollMind TPM Platform
Stack     : NestJS + TypeORM + PostgreSQL · Next.js 14 · TypeScript monorepo
Local path: /Users/sertact/Documents/CollMind/Code/TPM/
Backend   : collmind-backend/src/
Frontend  : collmind-frontend/src/
BRD ref   : Section 07 Security & Roles · BRD Addendum EA-001
Sprint dep: Sprint C — On-Invoice Recognition Engine tamamlandı, E2E 18/18 passing

Bağlam özeti:
UserRole enum'unda APPROVER rolü iş gerçekliğini yansıtmıyor — Wella'da onaylayan kişi
bir Sales/Category Manager'dır. APPROVER → MANAGER olarak yeniden adlandırılıyor.
Aynı zamanda audit/raporlama kullanıcıları için READONLY rolü ekleniyor; bu rol tüm GET
endpoint'lerine erişebilir, hiçbir write işlemi yapamaz.

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
  Çakışma olası dosya : user.entity.ts ↔ user.types.ts enum senkronizasyonu — sıralı merge ile önlenir

---

## MIGRATION SAFETY

Migration dosyası:
  Adı       : 1775000000000-AddManagerAndReadonlyRoles.ts
  Timestamp : 1775000000000  (mevcut en yüksek: 1774000000000 + 1000000)
  Tür       : DDL + DML  (enum değeri ekle + mevcut APPROVER kayıtları güncelle)

Geri alınabilirlik:
  down() yazılacak mı : Evet — MANAGER'ları APPROVER'a geri alır
  Rollback riski      : ORTA — PostgreSQL enum değeri silinemez (DDL geri alınamaz),
                        sadece veri (DML) revert edilir. MANAGER ve READONLY
                        enum değerleri down() sonrası DB'de kalır.

Local test (Windsurf yapmaz — geliştirici yapar):
  npm run migration:run
  psql -U postgres -d collmind_tpm -c "\dT+ main.users_role_enum"
  # Beklenti: ADMIN, PLANNER, APPROVER, FINANCE, FINANCE_MANAGER,
  #           CATEGORY_MANAGER, MANAGER, READONLY görünmeli
  npm run migration:revert
  npm run migration:run   # tekrar çalışmalı (idempotent)

Staging checklist:
  [ ] Local'de test edildi
  [ ] Migration dosyası PR'a dahil
  [ ] Staging'de çalıştıracak kişi: Sertaç
  [ ] Rollback planı: npm run migration:revert — MANAGER kullanıcıları APPROVER'a döner

Seed:
  Seed değişiyor mu            : Evet — approver@wella.com → manager@wella.com, READONLY user eklendi
  Staging'de yeniden çalışacak : Hayır — mevcut seed kullanıcıları migration ile güncellenir
  Pattern                      : Mevcut upsert pattern korunur (existing check var)

---

## SCOPE

IN scope:
  Backend:
  - collmind-backend/src/database/entities/user.entity.ts          (enum güncelle)
  - collmind-backend/src/database/migrations/1775000000000-*.ts    (yeni migration)
  - collmind-backend/src/modules/shared/approval/approval.service.ts     (hardcoded string)
  - collmind-backend/src/modules/shared/approval/approval.controller.ts  (@Roles güncelle)
  - collmind-backend/src/modules/modes/actuals-first/agreement/agreement.controller.ts
  - collmind-backend/src/modules/modes/planning-first/plan/plan.controller.ts
  - collmind-backend/src/modules/shared/finance-reporting/finance-reporting.controller.ts
  - collmind-backend/src/modules/modes/actuals-first/on-invoice/on-invoice.controller.ts
  - collmind-backend/src/database/seeds/user.seed.ts
  - collmind-backend/src/database/seeds/test-happy-path.ts

  Frontend:
  - collmind-frontend/src/types/user.types.ts                      (enum güncelle)
  - collmind-frontend/src/routes/index.tsx                         (route roller)
  - collmind-frontend/src/services/agreements.service.ts           (permission hook)
  - collmind-frontend/src/components/common/EnumBadge.tsx          (badge renkleri)
  - collmind-frontend/src/utils/roleUtils.ts                       (isReadOnly helper)

OUT of scope:
  - collmind-backend/src/modules/shared/budget/budget-allocation.controller.ts
    (FINANCE_MANAGER deprecated ama functional — ayrı sprint)
  - collmind-backend/src/modules/notification/notification.service.ts
    ('APPROVER' sadece email şablon metni, rol logic değil)
  - Tüm *.spec.ts dosyaları (ayrı test sprint'i)
  - collmind-backend/src/database/entities/user-scope.entity.ts
    (scope-based approval — gelecek sprint)

---

## CONSTRAINTS

1. Branch    : Tüm değişiklikler feature/role-refactor-manager-readonly'de yapılır.
               staging veya main'e direkt commit kesinlikle yok.

2. Migration : 1775000000000-AddManagerAndReadonlyRoles.ts OLUŞTURULUR ama
               npm run migration:run komutu Windsurf tarafından çalıştırılmaz.

3. Enum      : APPROVER enum'dan SİLİNMEZ. @deprecated JSDoc ile işaretlenir.
               PostgreSQL'de mevcut kayıtlar kırılmamalı.

4. Seed      : user.seed.ts'deki mevcut upsert pattern korunur.
               Staging'deki hiçbir kullanıcı kaydı silinmez.

5. READONLY  : Yalnızca GET endpoint'lere eklenir.
               POST / PATCH / PUT / DELETE endpoint'lerine kesinlikle eklenmez.

6. Test      : *.spec.ts dosyalarına dokunulmaz.

7. Sıra      : Adımlar sırayla uygulanır. Bir adım bitmeden sonrakine geçilmez.

---

## IMPLEMENTATION STEPS

### STEP 1 — Backend UserRole enum
Dosya  : collmind-backend/src/database/entities/user.entity.ts
Tür    : Mevcut değişiklik
Etki   : Backend + DB

Enum tanımını aşağıdakiyle değiştir. Dosyanın başka hiçbir yerine dokunma:

```typescript
export enum UserRole {
  ADMIN = 'ADMIN',
  PLANNER = 'PLANNER',
  MANAGER = 'MANAGER',       // Replaces APPROVER — approves plans and agreements
  FINANCE = 'FINANCE',
  READONLY = 'READONLY',     // Read-only access — all GET endpoints, no write

  /** @deprecated Use MANAGER instead. Will be removed in a future migration. */
  APPROVER = 'APPROVER',
  /** @deprecated Scope-based access planned for future sprint. */
  FINANCE_MANAGER = 'FINANCE_MANAGER',
  /** @deprecated Scope-based access planned for future sprint. */
  CATEGORY_MANAGER = 'CATEGORY_MANAGER',
}
```

Adım sonu kontrol:
  [ ] tsc --noEmit hata vermiyor
  [ ] APPROVER hâlâ enum'da var (deprecated)

---

### STEP 2 — Frontend UserRole enum
Dosya  : collmind-frontend/src/types/user.types.ts
Tür    : Mevcut değişiklik
Etki   : Frontend

Step 1 ile birebir aynı enum tanımını uygula. Backend ve frontend enum'ları her zaman senkron olmalı.

```typescript
export enum UserRole {
  ADMIN = 'ADMIN',
  PLANNER = 'PLANNER',
  MANAGER = 'MANAGER',
  FINANCE = 'FINANCE',
  READONLY = 'READONLY',

  /** @deprecated Use MANAGER instead. Will be removed in a future migration. */
  APPROVER = 'APPROVER',
  /** @deprecated Scope-based access planned for future sprint. */
  FINANCE_MANAGER = 'FINANCE_MANAGER',
  /** @deprecated Scope-based access planned for future sprint. */
  CATEGORY_MANAGER = 'CATEGORY_MANAGER',
}
```

Adım sonu kontrol:
  [ ] tsc --noEmit (frontend) hata vermiyor

---

### STEP 3 — Database Migration
Dosya  : collmind-backend/src/database/migrations/1775000000000-AddManagerAndReadonlyRoles.ts
Tür    : Yeni dosya
Etki   : DB

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManagerAndReadonlyRoles1775000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add MANAGER to enum
    await queryRunner.query(`
      ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'MANAGER';
    `);

    // Add READONLY to enum
    await queryRunner.query(`
      ALTER TYPE "main"."users_role_enum" ADD VALUE IF NOT EXISTS 'READONLY';
    `);

    // Migrate existing APPROVER users to MANAGER
    // Note: Must run in separate transaction after enum value is committed
    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'MANAGER'
      WHERE role = 'APPROVER';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert MANAGER users back to APPROVER
    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'APPROVER'
      WHERE role = 'MANAGER';
    `);
    // NOTE: PostgreSQL does not support removing enum values.
    // MANAGER and READONLY remain in the enum type after rollback.
    // Manual cleanup requires creating a new enum type if needed.
    console.warn(
      '⚠️  down() complete: MANAGER users reverted to APPROVER. ' +
      'MANAGER and READONLY enum values remain in DB — this is expected PostgreSQL behavior.'
    );
  }
}
```

Adım sonu kontrol:
  [ ] Dosya oluşturuldu, TypeScript syntax hatası yok
  [ ] Timestamp mevcut en yüksekten (1774000000000) büyük

---

### STEP 4 — approval.service.ts hardcoded string
Dosya  : collmind-backend/src/modules/shared/approval/approval.service.ts
Tür    : Mevcut değişiklik
Etki   : Backend

createRequest metodunda satır ~42'deki hardcoded string'i değiştir:

```typescript
// ÖNCE:
const defaultLevel = {
  order: 1,
  role: 'APPROVER',
  status: 'PENDING' as const,
};

// SONRA:
const defaultLevel = {
  order: 1,
  role: 'MANAGER',
  status: 'PENDING' as const,
};
```

Adım sonu kontrol:
  [ ] Dosyada başka 'APPROVER' string literal kalmadı

---

### STEP 5 — approval.controller.ts @Roles
Dosya  : collmind-backend/src/modules/shared/approval/approval.controller.ts
Tür    : Mevcut değişiklik
Etki   : Backend

| Satır | HTTP   | Mevcut                              | Yeni                                              |
|-------|--------|-------------------------------------|---------------------------------------------------|
| ~20   | GET    | ADMIN, APPROVER, FINANCE            | ADMIN, MANAGER, FINANCE, READONLY                 |
| ~32   | GET    | ADMIN, APPROVER, FINANCE            | ADMIN, MANAGER, FINANCE, READONLY                 |
| ~39   | GET    | ADMIN, PLANNER, APPROVER, FINANCE   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY        |
| ~46   | GET    | ADMIN, PLANNER, APPROVER, FINANCE   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY        |
| ~53   | POST   | ADMIN, APPROVER, FINANCE            | ADMIN, MANAGER, FINANCE                           |
| ~65   | POST   | ADMIN, APPROVER, FINANCE            | ADMIN, MANAGER, FINANCE                           |

Adım sonu kontrol:
  [ ] Tüm GET'lerde READONLY var
  [ ] Tüm POST'larda READONLY yok
  [ ] Dosyada UserRole.APPROVER kalmadı

---

### STEP 6 — agreement.controller.ts @Roles
Dosya  : collmind-backend/src/modules/modes/actuals-first/agreement/agreement.controller.ts
Tür    : Mevcut değişiklik
Etki   : Backend

| Endpoint                       | HTTP   | Mevcut                       | Yeni                                         |
|--------------------------------|--------|------------------------------|----------------------------------------------|
| GET /agreements (findAll)      | GET    | @Roles yok                   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| GET /agreements/pending-approvals | GET | ADMIN, APPROVER, FINANCE     | ADMIN, MANAGER, FINANCE, READONLY            |
| GET /agreements/tactics/available | GET | @Roles yok                  | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| GET /agreements/:id (findOne)  | GET    | @Roles yok                   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| POST /agreements/:id/approve   | POST   | ADMIN, APPROVER, FINANCE     | ADMIN, MANAGER, FINANCE                      |
| POST /agreements/:id/reject    | POST   | ADMIN, APPROVER, FINANCE     | ADMIN, MANAGER, FINANCE                      |

Adım sonu kontrol:
  [ ] @Roles yok olan GET'lere decorator eklendi
  [ ] Tüm GET'lerde READONLY var
  [ ] Tüm POST'larda READONLY yok

---

### STEP 7 — plan.controller.ts @Roles
Dosya  : collmind-backend/src/modules/modes/planning-first/plan/plan.controller.ts
Tür    : Mevcut değişiklik
Etki   : Backend

| Endpoint                          | HTTP   | Mevcut                       | Yeni                                         |
|-----------------------------------|--------|------------------------------|----------------------------------------------|
| GET /plans (findAll)              | GET    | @Roles yok                   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| GET /plans/pending-approvals      | GET    | ADMIN, APPROVER              | ADMIN, MANAGER, READONLY                     |
| GET /plans/:id/budget-check       | GET    | ADMIN, APPROVER              | ADMIN, MANAGER, READONLY                     |
| GET /plans/:id/analysis           | GET    | @Roles yok                   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| GET /plans/:id (findOne)          | GET    | @Roles yok                   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| GET /plans/approval-queue         | GET    | ADMIN, APPROVER, FINANCE     | ADMIN, MANAGER, FINANCE, READONLY            |
| GET /plans/:id/approval-history   | GET    | @Roles yok                   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| POST /plans/:id/review            | POST   | ADMIN, APPROVER, FINANCE     | ADMIN, MANAGER, FINANCE                      |
| POST /plans/:id/escalate-to-finance | POST | ADMIN, APPROVER              | ADMIN, MANAGER                               |
| POST /plans/:id/approve           | POST   | ADMIN, APPROVER              | ADMIN, MANAGER                               |
| POST /plans/:id/reject            | POST   | ADMIN, APPROVER              | ADMIN, MANAGER                               |

Adım sonu kontrol:
  [ ] @Roles yok olan GET'lere decorator eklendi
  [ ] Tüm GET'lerde READONLY var
  [ ] Tüm POST'larda READONLY yok

---

### STEP 8 — finance-reporting.controller.ts READONLY
Dosya  : collmind-backend/src/modules/shared/finance-reporting/finance-reporting.controller.ts
Tür    : Mevcut değişiklik
Etki   : Backend

Bu controller'daki tüm endpoint'ler GET'tir. Her @Roles decorator'a UserRole.READONLY ekle.
CATEGORY_MANAGER'a dokunma — deprecated ama functional.

```typescript
// Her GET endpoint için bu pattern:
// ÖNCE: @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.CATEGORY_MANAGER)
// SONRA: @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.CATEGORY_MANAGER, UserRole.READONLY)
```

Adım sonu kontrol:
  [ ] Controller'daki tüm @Roles'larda READONLY var
  [ ] CATEGORY_MANAGER'a dokunulmadı

---

### STEP 9 — on-invoice.controller.ts READONLY
Dosya  : collmind-backend/src/modules/modes/actuals-first/on-invoice/on-invoice.controller.ts
Tür    : Mevcut değişiklik
Etki   : Backend

Sadece GET endpoint'lere READONLY ekle:
- GET /on-invoice/count   → READONLY ekle
- GET /on-invoice/entries → READONLY ekle
- GET /on-invoice/batch/:batchId → READONLY ekle

Upload / validate / process endpoint'lerine (POST) dokunma.

Adım sonu kontrol:
  [ ] GET'lerde READONLY var, POST'larda yok

---

### STEP 10 — user.seed.ts
Dosya  : collmind-backend/src/database/seeds/user.seed.ts
Tür    : Mevcut değişiklik
Etki   : Seed

İki değişiklik:

1. approver@wella.com kullanıcısını güncelle:
```typescript
// ÖNCE:
{
  email: 'approver@wella.com',
  fullName: 'Jane Approver',
  firstName: 'Jane',
  lastName: 'Approver',
  role: UserRole.APPROVER,
  ...
}
// SONRA:
{
  email: 'manager@wella.com',
  fullName: 'Jane Manager',
  firstName: 'Jane',
  lastName: 'Manager',
  role: UserRole.MANAGER,
  jobTitle: 'Sales Manager',
  ...
}
```

2. READONLY kullanıcısını users array'ine ekle:
```typescript
{
  email: 'readonly@wella.com',
  fullName: 'Read Only User',
  firstName: 'Read',
  lastName: 'Only',
  role: UserRole.READONLY,
  status: UserStatus.ACTIVE,
  department: 'Audit',
  jobTitle: 'Auditor',
  passwordHash: await bcrypt.hash('password123', 10),
  emailVerified: true,
  tenantId,
},
```

Adım sonu kontrol:
  [ ] UserRole.APPROVER seed'den kaldırıldı
  [ ] manager@wella.com ve readonly@wella.com var
  [ ] Mevcut upsert (existing check) pattern bozulmadı

---

### STEP 11 — test-happy-path.ts
Dosya  : collmind-backend/src/database/seeds/test-happy-path.ts
Tür    : Mevcut değişiklik
Etki   : Seed / Test yardımcısı

- Satır ~10: `approverToken` değişken adını `managerToken` olarak yeniden adlandır
- Satır ~68: login email'i `approver@wella.com` → `manager@wella.com`
- Satır ~214: `approverToken` kullanımlarını `managerToken` olarak güncelle
- Tüm "approver" yorumlarını / console.log mesajlarını "manager" olarak güncelle

Adım sonu kontrol:
  [ ] Dosyada `approverToken` kalmadı
  [ ] Dosyada `approver@wella.com` kalmadı

---

### STEP 12 — frontend routes/index.tsx
Dosya  : collmind-frontend/src/routes/index.tsx
Tür    : Mevcut değişiklik
Etki   : Frontend

Tüm `'APPROVER'` string'lerini `'MANAGER'` ile değiştir.
Aşağıdaki sayfa route'larına `'READONLY'` ekle (read-only sayfalar):

| Route                    | Mevcut                              | Yeni (READONLY eklendi)                      |
|--------------------------|-------------------------------------|----------------------------------------------|
| /agreements              | ADMIN, PLANNER, APPROVER, FINANCE   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| /agreements/:id          | ADMIN, PLANNER, APPROVER, FINANCE   | ADMIN, PLANNER, MANAGER, FINANCE, READONLY   |
| /agreement-approvals     | ADMIN, APPROVER, FINANCE            | ADMIN, MANAGER, FINANCE, READONLY            |
| /plans                   | ADMIN, PLANNER, CATEGORY_MANAGER, FINANCE | ADMIN, PLANNER, CATEGORY_MANAGER, FINANCE, READONLY |
| /plans/:id               | ADMIN, PLANNER, CATEGORY_MANAGER, FINANCE | ADMIN, PLANNER, CATEGORY_MANAGER, FINANCE, READONLY |
| /plan-approvals          | ADMIN, APPROVER                     | ADMIN, MANAGER, READONLY                     |
| /finance                 | ADMIN, FINANCE, CATEGORY_MANAGER    | ADMIN, FINANCE, CATEGORY_MANAGER, READONLY   |
| /on-invoice              | ADMIN, FINANCE, PLANNER             | ADMIN, FINANCE, PLANNER, READONLY            |
| /off-invoice             | ADMIN, FINANCE, PLANNER             | ADMIN, FINANCE, PLANNER, READONLY            |

READONLY eklenMEyecek route'lar:
- /agreements/new, /agreements/:id/edit
- /on-invoice/upload, /off-invoice/upload
- /admin/* (tüm admin route'lar)

Adım sonu kontrol:
  [ ] 'APPROVER' string kalmadı
  [ ] Upload/edit/admin route'larında READONLY yok

---

### STEP 13 — agreements.service.ts permission hook
Dosya  : collmind-frontend/src/services/agreements.service.ts
Tür    : Mevcut değişiklik
Etki   : Frontend

useAgreementPermissions fonksiyonunda iki değişiklik:

1. Fonksiyon başına READONLY early-return ekle:
```typescript
// READONLY users have no write permissions
if (userRole === UserRole.READONLY) {
  return {
    canEdit: false, canSubmit: false, canApprove: false,
    canReject: false, canCancel: false, canDelete: false,
  };
}
```

2. canApprove ve canReject satırlarında 'APPROVER' → UserRole.MANAGER:
```typescript
const canApprove =
  agreement.status === AgreementStatus.PENDING &&
  (userRole === UserRole.ADMIN || userRole === UserRole.MANAGER || userRole === UserRole.FINANCE);

const canReject =
  agreement.status === AgreementStatus.PENDING &&
  (userRole === UserRole.ADMIN || userRole === UserRole.MANAGER || userRole === UserRole.FINANCE);
```

Adım sonu kontrol:
  [ ] 'APPROVER' string literal kalmadı
  [ ] READONLY early-return fonksiyonun en üstünde

---

### STEP 14 — EnumBadge.tsx
Dosya  : collmind-frontend/src/components/common/EnumBadge.tsx
Tür    : Mevcut değişiklik
Etki   : Frontend

1. getRoleColor fonksiyonuna MANAGER ve READONLY case'lerini ekle:
```typescript
case 'MANAGER':
  return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800';
case 'READONLY':
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700';
```

2. Auto-detect dizisine MANAGER ve READONLY ekle:
```typescript
// ÖNCE:
['ADMIN', 'PLANNER', 'APPROVER', 'FINANCE', 'FINANCE_MANAGER', 'CATEGORY_MANAGER']
// SONRA:
['ADMIN', 'PLANNER', 'MANAGER', 'APPROVER', 'FINANCE', 'FINANCE_MANAGER', 'CATEGORY_MANAGER', 'READONLY']
```

Not: 'APPROVER' dizide kalır — DB'deki eski kayıtların display'i için gerekli.

Adım sonu kontrol:
  [ ] MANAGER → yeşil badge
  [ ] READONLY → slate/gri badge
  [ ] APPROVER hâlâ dizide (backward compat)

---

### STEP 15 — roleUtils.ts
Dosya  : collmind-frontend/src/utils/roleUtils.ts
Tür    : Mevcut değişiklik
Etki   : Frontend

Mevcut fonksiyonların sonuna yeni helper ekle:

```typescript
/**
 * Returns true if the user has READONLY role.
 * READONLY users can view all data but cannot perform any write actions.
 * Use this to conditionally hide/disable edit buttons, forms, and action menus.
 */
export function isReadOnly(userRole: UserRole | undefined): boolean {
  if (!userRole) return false;
  return userRole === UserRole.READONLY;
}
```

Adım sonu kontrol:
  [ ] isReadOnly export edildi
  [ ] tsc --noEmit hata vermiyor

---

## VERIFICATION

### A. Windsurf self-check (tüm adımlar tamamlandıktan sonra çalıştır)

```bash
# 1. Backend'de APPROVER rol referansı kalmadı mı?
grep -r "UserRole\.APPROVER" collmind-backend/src --include="*.ts" \
  | grep -v "\.spec\." | grep -v "user\.entity\.ts"
# Beklenti: 0 sonuç

# 2. Hardcoded 'APPROVER' string kalmadı mı?
grep -r "role: 'APPROVER'" collmind-backend/src --include="*.ts"
# Beklenti: 0 sonuç

# 3. Frontend'de APPROVER kalmadı mı?
grep -r "APPROVER" collmind-frontend/src --include="*.ts" --include="*.tsx" \
  | grep -v "user\.types\.ts" | grep -v "EnumBadge"
# Beklenti: 0 sonuç

# 4. MANAGER doğru yerlerde var mı?
grep -r "UserRole\.MANAGER" collmind-backend/src --include="*.ts" | grep -v "\.spec\."
# Beklenti: approval, agreement, plan controller'larında görünmeli

# 5. READONLY sadece GET'lerde mi?
grep -rn "READONLY" collmind-backend/src/modules --include="*.ts"
# Manuel kontrol: POST/PATCH/DELETE satırlarında READONLY olmamalı

# 6. Migration dosyası var mı?
ls collmind-backend/src/database/migrations/ | grep "1775000000000"
# Beklenti: 1775000000000-AddManagerAndReadonlyRoles.ts

# 7. TypeScript derleme (backend)
cd collmind-backend && npx tsc --noEmit
# Beklenti: 0 hata

# 8. TypeScript derleme (frontend)
cd collmind-frontend && npx tsc --noEmit
# Beklenti: 0 hata
```

### B. CoWork UI test
Task dosyası: Sprint D UI test paketine eklenecek (ayrı görev)
Senaryolar:
  - MANAGER kullanıcısı ile agreement onaylama akışı
  - READONLY kullanıcısı ile agreement listesi görüntüleme
  - READONLY kullanıcısı ile "Approve" butonunun görünmediğini doğrulama
  - manager@wella.com ile login

### C. Staging doğrulama (geliştirici — PR merge sonrası)
  [ ] npm run migration:run:prod hatasız tamamlandı
  [ ] psql ile MANAGER ve READONLY enum değerleri görünüyor
  [ ] manager@wella.com ile login başarılı, agreement onaylayabiliyor
  [ ] readonly@wella.com ile login başarılı, approve butonu görünmüyor
  [ ] Mevcut admin@wella.com, planner@wella.com, finance@wella.com etkilenmedi
  [ ] approver@wella.com artık DB'de MANAGER rolünde (migration UPDATE çalıştı)

/**
 * user-scope-creation.e2e-spec.ts
 *
 * T-241 — `POST /users` artık rol + kapsam BİRLİKTE alır; kapsamsız kullanıcı
 * YARATILMAZ (`.claude/backlog/tasks/T-241.md`, karar (b)).
 *
 * ⚠️ SCOPE_ENFORCEMENT_ENABLED bu suite'in KENDİ process'inde, app boot'undan
 * ÖNCE, module-level'de zorlanır (aşağıya bkz.). AccessScopeService bu
 * bayrağı yalnız constructor'da bir kez okur (role-journey.e2e-spec.ts'in
 * aynı notu) — bayrak kapalıyken PLANNER zaten UNRESTRICTED döner ve bu
 * dosyanın "kendi kapsamını görüyor / kapsam dışını görmüyor" iddiası
 * hiçbir şey ölçmez (CLAUDE.md §2.7 — kapsamı kendini boşaltan doğrulama).
 * Bu yüzden `npm run test:e2e` çalıştıran diğer .e2e-spec.ts dosyalarının
 * SCOPE_ENFORCEMENT_ENABLED durumundan BAĞIMSIZDIR — kendi worker process'i
 * kendi bayrağını taşır (Jest varsayılanı: her .e2e-spec.ts ayrı process).
 *
 * Atomiklik fault-injection kanıtı (kapsam yazımı bozulunca kullanıcı da
 * yazılmamış olmalı) BURADA DEĞİL — src/modules/user/user.service.spec.ts
 * ("atomicity: scope write failing..." testi). Gerekçe: gerçek bir DB
 * transaction'ının ROLLBACK'ini HTTP katmanından kasten tetiklemek (ikinci
 * yazmayı başarısız kılacak bir enjeksiyon noktası olmadan) mümkün değil;
 * unit seviyesinde T-096/2 deseniyle (bkz. budget-allocation.service.spec.ts)
 * zaten kanıtlı. Bu dosya YALNIZCA uçtan uca sözleşmeyi (400/201 + kapsam
 * filtresi) kanıtlar.
 */
process.env.SCOPE_ENFORCEMENT_ENABLED = 'true';

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  E2EFixture,
  resolveIdByCode,
  cleanupTestUsers,
  cleanupTestPlans,
} from './helpers/seed-e2e';

describe('T-241 — POST /users: rol + kapsam birlikte (SCOPE_ENFORCEMENT_ENABLED=true)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  let CPL_NKA: string; // BS0501.50001
  let CHANNEL_NKA: string; // code NKA
  let CATEGORY_SAC_BOYASI: string; // CAT-SAC-BOYASI
  let CPL_DISTRIBUTOR: string; // BS0502.50002
  let CHANNEL_DISTRIBUTOR: string; // code DISTRIBUTOR

  const scratchUserIds: string[] = [];
  // ⚠️ 400 BEKLEYEN testler de buraya kaydolur (ürün sahibi dersi, 2026-08-20).
  // Gerekçe ÖLÇÜLDÜ: B1 mutasyon koşumunda (`if (false && …)`) guard kapalıydı,
  // o testler 400 yerine 201 aldı ve YARATTIKLARI kullanıcılar hiçbir cleanup
  // listesine girmediği için dev DB'de KALDI — üstelik tam olarak engellemek
  // istediğimiz şekilde (joker satırlı PLANNER/CM). Yani mutasyon KENDİ
  // KALINTISINI bıraktı. Bir mutasyon, testin beklentisini TERSİNE ÇEVİRİR;
  // bu yüzden "yaratılmayacak" varsayımına dayanan bir cleanup yetersizdir.
  const scratchEmails: string[] = [];
  const PLAN_NAME_PREFIX = `E2E-T241-${Date.now()}-`;

  beforeAll(async () => {
    if (process.env.SCOPE_ENFORCEMENT_ENABLED !== 'true') {
      // §2.7 pozitif kontrol: bayrağın gerçekten bu process'te etkili
      // olduğunu, testler yanlışlıkla "her şey UNRESTRICTED" moduna sessizce
      // düşmeden ÖNCE doğrula.
      throw new Error(
        'user-scope-creation.e2e-spec.ts: SCOPE_ENFORCEMENT_ENABLED bu ' +
          "process'te 'true' değil — dosyanın en üstündeki atama " +
          'AppModule import edilmeden önce çalışmalıydı.',
      );
    }

    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());
    fixture = await loadE2EFixture(app);

    [
      CPL_NKA,
      CHANNEL_NKA,
      CATEGORY_SAC_BOYASI,
      CPL_DISTRIBUTOR,
      CHANNEL_DISTRIBUTOR,
    ] = await Promise.all([
      resolveIdByCode(app, fixture.tenantId, 'cpls', 'BS0501.50001'),
      resolveIdByCode(app, fixture.tenantId, 'channels', 'NKA'),
      resolveIdByCode(app, fixture.tenantId, 'categories', 'CAT-SAC-BOYASI'),
      resolveIdByCode(app, fixture.tenantId, 'cpls', 'BS0502.50002'),
      resolveIdByCode(app, fixture.tenantId, 'channels', 'DISTRIBUTOR'),
    ]);
  });

  afterAll(async () => {
    await cleanupTestPlans(app, fixture.tenantId, PLAN_NAME_PREFIX);
    await cleanupTestUsers(app, scratchUserIds);
    // Savunma temizliği: 400 bekleyen testlerin e-postaları. Normal koşumda
    // hiçbir satır yoktur (DELETE 0); bir mutasyon koşumunda kalıntıyı alır.
    if (scratchEmails.length > 0) {
      await dataSource.query(
        `DELETE FROM main.users WHERE email = ANY($1::text[])`,
        [scratchEmails],
      );
    }
    await closeTestApp();
  });

  beforeEach(() => {
    clearTokenCache();
  });

  /** `main.user_scopes`'tan verilen kullanıcının AKTİF satırlarını okur. */
  async function readScopeRows(
    userId: string,
  ): Promise<Array<{ cpl_id: string | null; category_id: string | null }>> {
    return dataSource.query(
      `SELECT cpl_id, category_id FROM main.user_scopes
        WHERE user_id = $1 AND is_active = true
        ORDER BY cpl_id NULLS FIRST, category_id NULLS FIRST`,
      [userId],
    );
  }

  describe('Kabul davranışı — üç girdi, üç çıktı', () => {
    it('kapsamsız PLANNER yaratma denemesi → 400, kullanıcı YARATILMAZ', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-scopeless-planner-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 Scopeless Planner (should not exist)',
          role: 'PLANNER',
          status: 'ACTIVE',
        });

      expect(res.status).toBe(400);

      const rows = await dataSource.query(
        `SELECT id FROM main.users WHERE email = $1`,
        [email],
      );
      expect(rows.length).toBe(0);
    });

    // ── B1 (code-review blocker, 2026-08-19) — JOKER YASAĞI ──────────────
    //
    // `[{}]` ve AÇIKÇA `{cplId:null, categoryId:null}` `{null,null}` satırına
    // dönüşüyordu, ve AccessScopeService onu UNRESTRICTED'a çeviriyordu
    // (hasUnrestrictedRow, access-scope.service.ts:205-210) — yani kapsamı
    // ZORUNLU bir rol SESSİZCE her şeyi görüyordu. Yön FAIL-OPEN.
    // ⚠️ Ve CM için bayraktan BAĞIMSIZDI (bayrak yalnız PLANNER'ı kapsıyor).
    // Ürün sahibi kararı: bu roller joker ALAMAZ.
    it.each([
      ['PLANNER', [{}]],
      ['PLANNER', [{ cplId: null, categoryId: null }]],
      ['CATEGORY_MANAGER', [{}]],
      ['CATEGORY_MANAGER', [{ cplId: null, categoryId: null }]],
    ])(
      'B1: %s + boş/joker çift (%j) → 400, kullanıcı YARATILMAZ',
      async (role, scope) => {
        const admin = await loginAs(app, 'ADMIN');
        const email = `e2e-t241-b1-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@wella.com`;
        scratchEmails.push(email);

        const res = await request(app.getHttpServer())
          .post('/users')
          .set(admin.authHeader())
          .send({
            email,
            password: 'Collmind2026!',
            fullName: `T-241 B1 wildcard-ban ${role}`,
            role,
            status: 'ACTIVE',
            scope,
          });

        expect(res.status).toBe(400);

        const rows = await dataSource.query(
          `SELECT id FROM main.users WHERE email = $1`,
          [email],
        );
        expect(rows.length).toBe(0);
      },
    );

    // ── R1 + A5 (ikinci tur review blocker) — CM'de DOLU cplId REDDEDİLİR ──
    //
    // ⚠️ Ve bu, B1'in KAÇIRDIĞI taraf: B1 yalnız İKİ boyutu da boş çifti
    // yakalıyordu. CM için `{cplId: X, categoryId: null}` o kapıdan GEÇİYOR ve
    // AYNI joker sonucu üretiyor (okuma yolu CM'de cplId'yi ATIYOR →
    // pairs=[{null,null}] → isInScope her şeye true).
    //
    // 📌 B1'in yeşil yarısı bunu göremedi çünkü PLANNER ile kurulmuştu — ve
    // PLANNER için `{cplId, null}` MEŞRU. Aynı girdi CM'de güvensiz.
    // Ders (§7.1): bir kural birden çok ÖZNEye uygulanıyorsa, testi HER ÖZNE
    // için ayrı kurulmalı — bir öznede geçen kanıt diğerinde geçmeyebilir.
    it('R1: CATEGORY_MANAGER + dolu cplId → 400, kullanıcı YARATILMAZ', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-r1-cm-cpl-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 R1 CM with cplId',
          role: 'CATEGORY_MANAGER',
          status: 'ACTIVE',
          scope: [{ cplId: CPL_NKA, categoryId: CATEGORY_SAC_BOYASI }],
        });

      expect(res.status).toBe(400);

      const rows = await dataSource.query(
        `SELECT id FROM main.users WHERE email = $1`,
        [email],
      );
      expect(rows.length).toBe(0);
    });

    // R1 YEŞİL yarı — CM için yalnız categoryId MEŞRU (yasak cplId'ye özgü,
    // CM'nin tümüne değil). İki girdi, iki çıktı — AYNI ÖZNE üzerinde.
    it('R1 yeşil yarı: CATEGORY_MANAGER + yalnız categoryId → 201', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-r1-cm-ok-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 R1 CM category-only',
          role: 'CATEGORY_MANAGER',
          status: 'ACTIVE',
          scope: [{ categoryId: CATEGORY_SAC_BOYASI }],
        });

      expect(res.status).toBe(201);
      scratchUserIds.push(res.body.id);

      const rows = await readScopeRows(res.body.id);
      expect(rows).toEqual([
        { cpl_id: null, category_id: CATEGORY_SAC_BOYASI },
      ]);
    });

    // YEŞİL yarı: dolu bir boyut YETER — yasak yalnız İKİ boyutu da boş olanı
    // kapsıyor, kısmi çifti değil (iki girdi, iki çıktı — §2.7 #9).
    it('B1 yeşil yarı: yalnız cplId dolu çift → 201 (yasak İKİ boyutu da boş olana özgü)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-b1-green-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 B1 partial pair is fine',
          role: 'PLANNER',
          status: 'ACTIVE',
          scope: [{ cplId: CPL_NKA }],
        });

      expect(res.status).toBe(201);
      scratchUserIds.push(res.body.id);

      const rows = await readScopeRows(res.body.id);
      expect(rows).toEqual([{ cpl_id: CPL_NKA, category_id: null }]);
    });

    it('kapsamsız CATEGORY_MANAGER yaratma denemesi → 400 (SCOPE_REQUIRED_ROLES ikisini de kapsar)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-scopeless-cm-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 Scopeless CM (should not exist)',
          role: 'CATEGORY_MANAGER',
          status: 'ACTIVE',
        });

      expect(res.status).toBe(400);
    });

    it('boş scope dizisi (scope: []) → 400 (ArrayMinSize)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-empty-scope-planner-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 Empty Scope Planner (should not exist)',
          role: 'PLANNER',
          status: 'ACTIVE',
          scope: [],
        });

      expect(res.status).toBe(400);
    });

    it('ADMIN yaratma → joker satır OTOMATİK (çağrı scope göndermese de)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-new-admin-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 New Admin',
          role: 'ADMIN',
          status: 'ACTIVE',
        })
        .expect(201);
      scratchUserIds.push(res.body.id);

      const rows = await readScopeRows(res.body.id);
      expect(rows).toEqual([{ cpl_id: null, category_id: null }]);
    });

    it('PLANNER yaratma (scope verilerek) → 201, kapsam satırı çağrıdaki çiftle BİREBİR eşleşir', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-new-planner-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 New Planner',
          role: 'PLANNER',
          status: 'ACTIVE',
          scope: [{ cplId: CPL_NKA, categoryId: null }],
        })
        .expect(201);
      scratchUserIds.push(res.body.id);

      const rows = await readScopeRows(res.body.id);
      expect(rows).toEqual([{ cpl_id: CPL_NKA, category_id: null }]);
    });

    // ── A3 (ikinci tur review) — B1'in TERS YÜZÜ ─────────────────────────
    // UNRESTRICTED rollerde gönderilen `scope` SESSİZCE atılıyordu: çağıran
    // 201 alıp kısıtlı bir kullanıcı yarattığını sanıyor, gerçekte joker.
    it('A3: UNRESTRICTED rolde scope gönderilirse → 400 (sessizce atılmaz)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-a3-finance-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 A3 wildcard role with scope',
          role: 'FINANCE',
          status: 'ACTIVE',
          scope: [{ cplId: CPL_NKA }],
        });

      expect(res.status).toBe(400);

      const rows = await dataSource.query(
        `SELECT id FROM main.users WHERE email = $1`,
        [email],
      );
      expect(rows.length).toBe(0);
    });

    it('YARATILAN HER kullanıcının kapsam satırı ≥ 1 (invaryant — bu testin şimdiye kadar yarattığı tüm kullanıcılar)', async () => {
      expect(scratchUserIds.length).toBeGreaterThan(0);
      for (const userId of scratchUserIds) {
        const rows = await readScopeRows(userId);
        expect(rows.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ── R2 (ikinci tur review blocker) — ROL DEĞİŞİMİ kapsam tutarsızlığı ──
  //
  // B1'in YARATMA kapısında yasakladığı DB durumu, PATCH /users/:id üzerinden
  // TEK ÇAĞRIYLA kuruluyordu: joker satırlı bir kullanıcı SCOPE_REQUIRED bir
  // role çevrildiğinde satır olduğu gibi kalıyor → hasUnrestrictedRow →
  // UNRESTRICTED. CM için bayraktan BAĞIMSIZ, yani CANLIYDI.
  //
  // ⚠️ Ve T-242 bunu TERS YÖNDE kaydetmişti (PLANNER → ADMIN, fail-closed ve
  // zararsız). Sayılmayan yön — joker → kapsamlı rol — fail-open'dı.
  describe('R2 — rol değişimi kapsam tutarsızlığı üretiyorsa 409', () => {
    it('joker satırlı FINANCE → CATEGORY_MANAGER → 409, rol DEĞİŞMEZ', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-r2-finance-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      // 1) joker satırlı bir FINANCE yarat (WILDCARD_SCOPE_ROLES → otomatik joker)
      const createRes = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 R2 wildcard finance',
          role: 'FINANCE',
          status: 'ACTIVE',
        })
        .expect(201);
      scratchUserIds.push(createRes.body.id);
      expect(await readScopeRows(createRes.body.id)).toEqual([
        { cpl_id: null, category_id: null },
      ]);

      // 2) SCOPE_REQUIRED bir role çevirmeye çalış → 409
      const patchRes = await request(app.getHttpServer())
        .patch(`/users/${createRes.body.id}`)
        .set(admin.authHeader())
        .send({ role: 'CATEGORY_MANAGER' });

      expect(patchRes.status).toBe(409);

      // 3) rol DEĞİŞMEMİŞ olmalı — ve joker satır hâlâ FINANCE'a ait
      const after = await dataSource.query(
        `SELECT role FROM main.users WHERE id = $1`,
        [createRes.body.id],
      );
      expect(after[0].role).toBe('FINANCE');
    });

    // YEŞİL yarı: aynı rota, tutarsızlık ÜRETMEYEN bir değişiklik geçmeli —
    // yoksa kapı "her rol değişimini reddediyor" olurdu (§2.7 #9).
    it('R2 yeşil yarı: kapsamlı PLANNER → CATEGORY_MANAGER geçişi ENGELLENMEZ (joker yok)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-r2-scoped-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const createRes = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 R2 scoped planner',
          role: 'PLANNER',
          status: 'ACTIVE',
          scope: [{ categoryId: CATEGORY_SAC_BOYASI }],
        })
        .expect(201);
      scratchUserIds.push(createRes.body.id);

      const patchRes = await request(app.getHttpServer())
        .patch(`/users/${createRes.body.id}`)
        .set(admin.authHeader())
        .send({ role: 'CATEGORY_MANAGER' });

      expect(patchRes.status).toBe(200);
    });
  });

  describe("Cross-tenant izolasyon — scope içindeki cplId/categoryId bu tenant'a ait olmalı", () => {
    it('başka (var olmayan) bir cplId ile PLANNER yaratma → 400, kullanıcı YARATILMAZ', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-foreign-cpl-planner-${Date.now()}@wella.com`;
      scratchEmails.push(email);
      // Rastgele bir UUID — hiçbir CPL'e karşılık gelmez (bu tenant'ta da,
      // başka bir tenant'ta da). Amaç: FK'nin YAKALAYAMAYACAĞI (satır BAŞKA
      // bir tenant'ta var olsaydı FK geçerdi) sınıfı simüle etmek yerine,
      // servisin kendi tenant-aidiyet kontrolünün varlığını kanıtlamak.
      const nonExistentCplId = '00000000-0000-0000-0000-000000000000';

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'T-241 Foreign CPL Planner (should not exist)',
          role: 'PLANNER',
          status: 'ACTIVE',
          scope: [{ cplId: nonExistentCplId, categoryId: null }],
        });

      expect(res.status).toBe(400);
      const rows = await dataSource.query(
        `SELECT id FROM main.users WHERE email = $1`,
        [email],
      );
      expect(rows.length).toBe(0);
    });
  });

  describe('RBAC — yalnızca ADMIN kullanıcı yaratabilir', () => {
    it('PLANNER kendi rolüyle POST /users çağırır → 403', async () => {
      const planner = await loginAs(app, 'PLANNER');
      // A6 (ikinci tur review): bu test de REDDEDİLME bekliyor, yani bir
      // mutasyon (@Roles kaldırılması) onu 201'e çevirir ve kalıntı bırakır.
      // İlk cleanup düzeltmesi yalnız `400` bekleyenleri kapsıyordu — kusurun
      // İLK YAZIMI'nı, SINIFINI değil (CLAUDE.md: "kapsam kusurun SINIFIYLA
      // tanımlanır"). Sınıf: REDDEDİLME bekleyen HER istek.
      const email = `e2e-t241-rbac-${Date.now()}@wella.com`;
      scratchEmails.push(email);

      const res = await request(app.getHttpServer())
        .post('/users')
        .set(planner.authHeader())
        .send({
          email,
          password: 'Collmind2026!',
          fullName: 'Should Not Be Created',
          role: 'PLANNER',
          scope: [{ cplId: CPL_NKA, categoryId: null }],
        });

      expect(res.status).toBe(403);
    });
  });

  describe('Yeni yaratılan PLANNER, bayrak AÇIKKEN yalnız kendi kapsamını görür', () => {
    it("kendi CPL kapsamındaki bir planı görür ve içinde yaratabilir; kapsam dışı bir CPL'de plan yaratamaz (403)", async () => {
      const admin = await loginAs(app, 'ADMIN');
      const email = `e2e-t241-scoped-planner-journey-${Date.now()}@wella.com`;
      scratchEmails.push(email);
      const password = 'Collmind2026!';

      const createRes = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password,
          fullName: 'T-241 Scoped Planner Journey',
          role: 'PLANNER',
          status: 'ACTIVE',
          scope: [{ cplId: CPL_NKA, categoryId: null }],
        })
        .expect(201);
      scratchUserIds.push(createRes.body.id);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      const authHeader = {
        Authorization: `Bearer ${loginRes.body.accessToken}`,
      };

      // Kendi kapsamında (NKA) plan yaratabilir.
      const inScopePlanRes = await request(app.getHttpServer())
        .post('/plans')
        .set(authHeader)
        .send({
          planName: `${PLAN_NAME_PREFIX}IN-SCOPE-${Date.now()}`,
          cplId: CPL_NKA,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });
      expect(inScopePlanRes.status).toBe(201);

      // Kapsam dışında (Distribütör) plan YARATAMAZ.
      const outOfScopePlanRes = await request(app.getHttpServer())
        .post('/plans')
        .set(authHeader)
        .send({
          planName: `${PLAN_NAME_PREFIX}OUT-OF-SCOPE-${Date.now()}`,
          cplId: CPL_DISTRIBUTOR,
          channelId: CHANNEL_DISTRIBUTOR,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });
      expect(outOfScopePlanRes.status).toBe(403);

      // GET /plans yalnız kendi kapsamındaki planı döner.
      const listRes = await request(app.getHttpServer())
        .get('/plans')
        .set(authHeader)
        .expect(200);

      const ids: string[] = listRes.body.map((p: { id: string }) => p.id);
      expect(ids).toContain(inScopePlanRes.body.id);
      for (const plan of listRes.body) {
        expect(plan.cplId).toBe(CPL_NKA);
      }
    });
  });
});

/**
 * locked-tenant-admin-provisioning-chain.e2e-spec.ts
 *
 * `B4` `A′` — KİLİTLİ-TENANT PİNİ (ürün sahibi, 2026-08-26 · `Z40`,
 * kabul kriterleri `docs/process/B4_BRIEF_KABUL_KRITERLERI.md`).
 *
 * `default-deny` altında admin uçtan uca çalışabilmeli: kullanıcı yarat →
 * rol ata (yaratma anıyla BİRLİKTE — `T-241` KARAR (b): kapsamsız/rolsüz
 * kullanıcı yaratılamaz, bu yüzden rol atama AYRI bir HTTP adımı OLAMAZ,
 * ürün kararı budur) → kapsam ata → YENİ KULLANICI kendi yetkili ucundan
 * `200`/`201` alır. Negatif yarı AYNI zincirde: admin-DIŞI bir kimlik
 * zincirin İLK adımında `403` alır.
 *
 * ⛔ CANLI, mock DEĞİL (`T-301` dersi): gerçek HTTP + gerçek DB, MSW/mock
 * yok. `ADIM3_KAPANIS_RAPORU.md §3.4`'ün ölçtüğü boşluğu kapatır:
 * `user-scope-creation.e2e-spec.ts:670` canlı bir zincir taşıyordu ama
 * (1) kapsam ataması AYRI bir HTTP çağrısı (`PATCH /users/:id/scope`)
 * DEĞİLDİ — yaratma anındaki tek `scope` alanıydı, (2) negatif yarı AYRI
 * bir `it`'teydi. Bu dosya ikisini de düzeltir: kapsam PATCH ile AYRI bir
 * adımda değiştirilir (ve DEĞİŞİKLİĞİN gerçekten uygulandığı erişim
 * davranışıyla — `Z15` KARAR 1 tam-değiştirme — kanıtlanır), negatif yarı
 * AYNI `it` içinde.
 *
 * ⚠️ SCOPE_ENFORCEMENT_ENABLED bu suite'in KENDİ process'inde, app
 * boot'undan ÖNCE zorlanır (`user-scope-creation.e2e-spec.ts`/
 * `role-journey.e2e-spec.ts` ile AYNI desen — `AccessScopeService` bu
 * bayrağı yalnız constructor'da bir kez okur).
 */
process.env.SCOPE_ENFORCEMENT_ENABLED = 'true';

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { closeAdminDataSource } from './helpers/admin-datasource';
import {
  loadE2EFixture,
  E2EFixture,
  resolveIdByCode,
  cleanupTestUsers,
  cleanupTestPlans,
} from './helpers/seed-e2e';

describe('KİLİTLİ-TENANT PİNİ — default-deny altında admin UÇTAN UCA (Z40)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  let CPL_NKA: string; // BS0501.50001
  let CHANNEL_NKA: string;
  let CATEGORY_SAC_BOYASI: string;
  let CPL_DISTRIBUTOR: string; // BS0502.50002
  let CHANNEL_DISTRIBUTOR: string;

  const scratchUserIds: string[] = [];
  const scratchEmails: string[] = [];
  const PLAN_NAME_PREFIX = `E2E-LOCKED-TENANT-${Date.now()}-`;

  beforeAll(async () => {
    if (process.env.SCOPE_ENFORCEMENT_ENABLED !== 'true') {
      throw new Error(
        'locked-tenant-admin-provisioning-chain.e2e-spec.ts: ' +
          "SCOPE_ENFORCEMENT_ENABLED bu process'te 'true' değil.",
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
    if (scratchEmails.length > 0) {
      await dataSource.query(
        `DELETE FROM main.users WHERE email = ANY($1::text[])`,
        [scratchEmails],
      );
    }
    await closeTestApp();
    await closeAdminDataSource();
  });

  beforeEach(() => {
    clearTokenCache();
  });

  it(
    'admin: yarat → kapsam ata (PATCH, AYRI adım) → yeni kullanıcı kendi ucundan 201; ' +
      'AYNI testte negatif yarı: admin-dışı kimlik zincirin İLK adımında 403',
    async () => {
      // ── NEGATİF YARI ÖNCE — admin-dışı kimlik zincirin İLK adımında durur.
      // (§2.7 #9: tek yönlü bir pin "herkese açtık" bozukluğunda da yeşil
      // kalır — bu yüzden iki-girdi-iki-çıktı AYNI testte doğrulanır.)
      const planner = await loginAs(app, 'PLANNER');
      const deniedEmail = `e2e-locked-tenant-denied-${Date.now()}@wella.com`;
      const deniedRes = await request(app.getHttpServer())
        .post('/users')
        .set(planner.authHeader())
        .send({
          email: deniedEmail,
          password: 'Collmind2026!',
          fullName: 'Should Not Be Created (non-admin)',
          role: 'PLANNER',
          status: 'ACTIVE',
          scope: [{ cplId: CPL_NKA, categoryId: null }],
        });
      expect(deniedRes.status).toBe(403);
      const deniedRows = await dataSource.query(
        `SELECT id FROM main.users WHERE email = $1`,
        [deniedEmail],
      );
      expect(deniedRows.length).toBe(0);

      // ── POZİTİF ZİNCİR — admin, default-deny altında.
      const admin = await loginAs(app, 'ADMIN');

      // 1) kullanıcı yarat (rol atama YARATMA ANIYLA BİRLİKTE — T-241 KARAR
      //    (b): kapsamsız/rolsüz kullanıcı yaratılamaz, ürün kararı bu).
      //    Başlangıç kapsamı bilinçli olarak HEDEF kapsamdan FARKLI:
      //    (Distribütör) — böylece adım (2)'nin PATCH'i GERÇEKTEN bir şey
      //    DEĞİŞTİRDİĞİNİ kanıtlayabiliriz (CLAUDE.md: "fixture, ayırt etmek
      //    istediği iki tarafta FARKLI değer taşımalı").
      const email = `e2e-locked-tenant-admin-chain-${Date.now()}@wella.com`;
      scratchEmails.push(email);
      const password = 'Collmind2026!';
      const createRes = await request(app.getHttpServer())
        .post('/users')
        .set(admin.authHeader())
        .send({
          email,
          password,
          fullName: 'Locked-Tenant Chain Planner',
          role: 'PLANNER',
          status: 'ACTIVE',
          scope: [{ cplId: CPL_DISTRIBUTOR, categoryId: null }],
        })
        .expect(201);
      const newUserId = createRes.body.id;
      scratchUserIds.push(newUserId);

      // 2) kapsam ata — AYRI bir HTTP çağrısı (`PATCH /users/:id/scope`),
      //    yaratma anındaki `scope` alanının TEKRARI DEĞİL. Z15 KARAR 1:
      //    TAM DEĞİŞTİRME — Distribütör kapsamı burada NKA ile YER
      //    DEĞİŞTİRİR, üstüne eklenmez.
      await request(app.getHttpServer())
        .patch(`/users/${newUserId}/scope`)
        .set(admin.authHeader())
        .send({
          intent: 'UPDATE',
          scope: [{ cplId: CPL_NKA, categoryId: null }],
        })
        .expect(200);

      // 3) YENİ KULLANICI login olur ve kendi yetkili ucundan 201 alır.
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      const newUserAuthHeader = {
        Authorization: `Bearer ${loginRes.body.accessToken}`,
      };

      // PATCH'in gerçekten UYGULANDIĞININ davranışsal kanıtı: yeni kapsamda
      // (NKA) 201, eski/PATCH-ÖNCESİ kapsamda (Distribütör) 403 — replace
      // semantiği, ekleme değil.
      const inNewScopeRes = await request(app.getHttpServer())
        .post('/plans')
        .set(newUserAuthHeader)
        .send({
          planName: `${PLAN_NAME_PREFIX}IN-SCOPE-${Date.now()}`,
          cplId: CPL_NKA,
          channelId: CHANNEL_NKA,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });
      expect(inNewScopeRes.status).toBe(201);

      const outOfOldScopeRes = await request(app.getHttpServer())
        .post('/plans')
        .set(newUserAuthHeader)
        .send({
          planName: `${PLAN_NAME_PREFIX}OUT-OF-OLD-SCOPE-${Date.now()}`,
          cplId: CPL_DISTRIBUTOR,
          channelId: CHANNEL_DISTRIBUTOR,
          categoryId: CATEGORY_SAC_BOYASI,
          startDate: '2026-01-05',
          endDate: '2026-01-31',
        });
      expect(outOfOldScopeRes.status).toBe(403);
    },
  );
});

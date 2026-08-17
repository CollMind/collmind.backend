/**
 * approval-policy-write.e2e-spec.ts
 *
 * T-214 — `PATCH /approval-policies/:id` yazma yolunun dört kabul kriteri
 * (`K-2.5.13a`/`K-2.5.13c`, `CHK_approval_policies_threshold_template`).
 *
 * Savunma İKİ katmanlı ve bu dosya ikisini AYRI ayrı sınar (§2.7 #6 —
 * testin şekli iki mekanizmayı ayırt edebilmeli):
 *
 *   katman 1  `ApprovalPolicyService.resolveAmountThreshold` → BadRequestException
 *             (mesaj: "K-2.5.13c" / "K-2.5.13a")
 *   katman 2  DB `CHECK` (`CHK_approval_policies_threshold_template`) +
 *             `wrapCheckViolation` → 400 (mesaj: "kısıtı ihlal edildi")
 *
 * Kabul 1-4, "Katman 1 (normal yol)" describe'unda katman 1 mesajıyla
 * doğrulanır. "Katman 2 — arka duvar" describe'u katman 1'i BİLEREK atlayan
 * bir yol kurar (repository'yi doğrudan çağırmak / servis doğrulamasını bir
 * test-zamanı monkeypatch'le devre dışı bırakmak) ve CHECK'in TEK BAŞINA
 * hâlâ koruduğunu kanıtlar — "bir doğrulamanın çalıştığı sanılması, girdinin
 * ona hiç ULAŞMAMASINDAN gelebilir" kuralının doğrudan uygulaması
 * (CLAUDE.md §7.1).
 *
 * Seed durumu (bkz. `approval-policy.seed.ts`): tenant başına yalnız
 * `STANDARD` ve `TWO_TIER` satırı var, ikisi de `amount_threshold IS NULL`.
 * `THRESHOLD` seed'lenmiyor (tutar uydurmak `§2.5` ihlali olurdu) — bu
 * suite'in kendisi geçici olarak `STANDARD` satırını `THRESHOLD`'a çevirip
 * geri döndürür.
 *
 * T-047 invaryantı: bu suite satır SAYISINI değiştirmez (yalnız UPDATE), ama
 * İÇERİĞİ değiştirir. `afterAll` iki satırı da orijinal `template`/
 * `amount_threshold`/`updated_by` değerlerine döndürür VE bunu bir sorguyla
 * doğrular (fire-and-forget SQL değil).
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';
import { ApprovalPolicyService } from '../src/modules/shared/approval/approval-policy.service';

interface PolicyRow {
  id: string;
  template: string;
  amount_threshold: string | null;
  updated_by: string | null;
}

async function getPolicyByTemplate(
  dataSource: DataSource,
  tenantId: string,
  template: string,
): Promise<PolicyRow> {
  const rows: PolicyRow[] = await dataSource.query(
    `SELECT id, template, amount_threshold, updated_by
       FROM main.approval_policies
      WHERE tenant_id = $1 AND template = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [tenantId, template],
  );
  if (!rows?.[0]) {
    throw new Error(
      `e2e fixture: main.approval_policies içinde template='${template}' ` +
        `bulunamadı — önce 'npm run seed' çalıştırın.`,
    );
  }
  return rows[0];
}

async function getPolicyById(
  dataSource: DataSource,
  id: string,
): Promise<PolicyRow> {
  const rows: PolicyRow[] = await dataSource.query(
    `SELECT id, template, amount_threshold, updated_by
       FROM main.approval_policies
      WHERE id = $1`,
    [id],
  );
  if (!rows?.[0]) {
    throw new Error(`approval_policies id='${id}' bulunamadı.`);
  }
  return rows[0];
}

/** T-060/budget-transaction-logs-idempotency.e2e-spec.ts ile aynı desen:
 *  pg hata kodu/kısıtı TypeORM'un QueryFailedError'ının kendisinde ya da
 *  `.driverError` altında olabilir. */
function extractPgError(err: unknown): {
  code?: string;
  constraint?: string;
} {
  const e = err as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  return {
    code: e?.code ?? e?.driverError?.code,
    constraint: e?.constraint ?? e?.driverError?.constraint,
  };
}

describe('Approval Policy write path — PATCH /approval-policies/:id (T-214, E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;
  let standardId: string;
  let twoTierId: string;
  let originalStandard: PolicyRow;
  let originalTwoTier: PolicyRow;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    originalStandard = await getPolicyByTemplate(
      dataSource,
      fixture.tenantId,
      'STANDARD',
    );
    originalTwoTier = await getPolicyByTemplate(
      dataSource,
      fixture.tenantId,
      'TWO_TIER',
    );
    standardId = originalStandard.id;
    twoTierId = originalTwoTier.id;

    // Pozitif kontrol (§7.1): fixture'ın gerçekten iddia ettiği şeyi taşıdığını
    // doğrula — ikisi de amount_threshold IS NULL olmalı (seed'in kendi sözü).
    expect(originalStandard.amount_threshold).toBeNull();
    expect(originalTwoTier.amount_threshold).toBeNull();
  });

  afterAll(async () => {
    // T-047: bu suite satır SAYISINI değiştirmiyor (yalnız UPDATE) ama
    // İÇERİĞİ değiştiriyor — orijinal template/amount_threshold/updated_by
    // değerlerine döndür, ve fire-and-forget'e güvenmeden SORGUYLA doğrula.
    await dataSource.query(
      `UPDATE main.approval_policies
          SET template = $2, amount_threshold = $3, updated_by = $4
        WHERE id = $1`,
      [
        standardId,
        originalStandard.template,
        originalStandard.amount_threshold,
        originalStandard.updated_by,
      ],
    );
    await dataSource.query(
      `UPDATE main.approval_policies
          SET template = $2, amount_threshold = $3, updated_by = $4
        WHERE id = $1`,
      [
        twoTierId,
        originalTwoTier.template,
        originalTwoTier.amount_threshold,
        originalTwoTier.updated_by,
      ],
    );

    const restoredStandard = await getPolicyById(dataSource, standardId);
    const restoredTwoTier = await getPolicyById(dataSource, twoTierId);
    expect(restoredStandard.template).toBe('STANDARD');
    expect(restoredStandard.amount_threshold).toBeNull();
    expect(restoredTwoTier.template).toBe('TWO_TIER');
    expect(restoredTwoTier.amount_threshold).toBeNull();

    await closeTestApp();
  });

  describe('RBAC — yalnız ADMIN', () => {
    it('PLANNER PATCH → 403, satır değişmez', async () => {
      const planner = await loginAs(app, 'PLANNER');
      const res = await request(app.getHttpServer())
        .patch(`/approval-policies/${standardId}`)
        .set(planner.authHeader())
        .send({ template: 'TWO_TIER' });

      expect(res.status).toBe(403);

      const row = await getPolicyById(dataSource, standardId);
      expect(row.template).toBe('STANDARD');
    });
  });

  describe('Katman 1 (normal yol) — dört kabul', () => {
    it('Kabul 1 — THRESHOLD + eşiksiz PATCH → 400, AÇIK mesaj (500 DEĞİL), satır DEĞİŞMEZ', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/approval-policies/${standardId}`)
        .set(admin.authHeader())
        .send({ template: 'THRESHOLD' });

      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
      // Katman 1'in kendi mesajı (K-2.5.13c) — katman 2'nin "kısıtı ihlal
      // edildi" mesajından AYRIŞIR; bu ayrışma mutasyon testinde kullanılıyor.
      expect(res.body.message).toContain('amountThreshold');
      expect(res.body.message).toContain('K-2.5.13c');

      const row = await getPolicyById(dataSource, standardId);
      expect(row.template).toBe('STANDARD');
      expect(row.amount_threshold).toBeNull();
    });

    it('Kabul 2 — THRESHOLD + eşik → 200, satır CHECK’i geçer', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/approval-policies/${standardId}`)
        .set(admin.authHeader())
        .send({ template: 'THRESHOLD', amountThreshold: 75000 });

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('THRESHOLD');
      expect(Number(res.body.amountThreshold)).toBe(75000);

      // DB'den doğrula — yanıt gövdesi bir iddia, katalog bir ölçüm.
      const row = await getPolicyById(dataSource, standardId);
      expect(row.template).toBe('THRESHOLD');
      expect(Number(row.amount_threshold)).toBe(75000);
    });

    it('Kabul 3 — THRESHOLD → STANDARD geçişi: amount_threshold DB’de NULL’lanır', async () => {
      const admin = await loginAs(app, 'ADMIN');
      // Bu test kabul-2'nin bıraktığı durumdan (THRESHOLD, 75000) devam eder.
      const before = await getPolicyById(dataSource, standardId);
      expect(before.template).toBe('THRESHOLD');
      expect(before.amount_threshold).not.toBeNull();

      const res = await request(app.getHttpServer())
        .patch(`/approval-policies/${standardId}`)
        .set(admin.authHeader())
        .send({ template: 'STANDARD' });

      expect(res.status).toBe(200);
      expect(res.body.template).toBe('STANDARD');
      expect(res.body.amountThreshold).toBeNull();

      // Yanıt gövdesi değil, KATALOG: sorguyla doğrula.
      const row = await getPolicyById(dataSource, standardId);
      expect(row.template).toBe('STANDARD');
      expect(row.amount_threshold).toBeNull();
    });

    it('Kabul 4 — STANDARD + eşik gönderilir → 400 (sessizce yok sayılmaz, REDDEDİLİR)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      // Bu test kabul-3'ün bıraktığı durumdan (STANDARD, NULL) devam eder.
      const before = await getPolicyById(dataSource, standardId);
      expect(before.template).toBe('STANDARD');
      expect(before.amount_threshold).toBeNull();

      const res = await request(app.getHttpServer())
        .patch(`/approval-policies/${standardId}`)
        .set(admin.authHeader())
        .send({ template: 'STANDARD', amountThreshold: 5000 });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('amountThreshold');
      expect(res.body.message).toContain('K-2.5.13a');

      // Girdi kaybolmadı çünkü hiç yazılmadı — satır dokunulmamış kalmalı.
      const row = await getPolicyById(dataSource, standardId);
      expect(row.template).toBe('STANDARD');
      expect(row.amount_threshold).toBeNull();
    });
  });

  describe('Katman 2 — DB CHECK arka duvar (katman 1 BİLEREK atlanıyor)', () => {
    it('doğrudan SQL, katman 1’i hiç görmeden CHECK’i ihlal eder → 23514', async () => {
      // Servis/repository katmanını tümüyle atla — çıplak SQL. Bu, CHECK'in
      // uygulama kodundan BAĞIMSIZ var olduğunun en doğrudan kanıtı.
      try {
        await dataSource.query(
          `UPDATE main.approval_policies
              SET template = 'STANDARD', amount_threshold = 5000
            WHERE id = $1`,
          [standardId],
        );
        throw new Error('beklenen CHECK ihlali fırlatılmadı');
      } catch (err) {
        const { code, constraint } = extractPgError(err);
        expect(code).toBe('23514');
        expect(constraint).toBe('CHK_approval_policies_threshold_template');
      }

      // Reddedilen yazma hiç düşmedi.
      const row = await getPolicyById(dataSource, standardId);
      expect(row.template).toBe('STANDARD');
      expect(row.amount_threshold).toBeNull();
    });

    it('servis doğrulaması (katman 1) test-zamanı devre dışı bırakılır → CHECK yine de 400 döndürür (THRESHOLD eşiksiz)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const policyService = app.get(ApprovalPolicyService);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = policyService as any;
      const original: (dto: unknown) => number | null =
        svc.resolveAmountThreshold.bind(svc);

      // Katman 1'i BYPASS EDEN, doğrulamayan bir "sahte" caller simüle et:
      // gelen değeri OLDUĞU GİBİ (hiç reddetmeden) DB'ye taşı. Bu, "katman 1
      // hiç çalışmasaydı" senaryosudur — CHECK'in TEK BAŞINA koruyup
      // korumadığını ölçer.
      svc.resolveAmountThreshold = (dto: { amountThreshold?: number }) =>
        dto.amountThreshold ?? null;

      try {
        const res = await request(app.getHttpServer())
          .patch(`/approval-policies/${standardId}`)
          .set(admin.authHeader())
          .send({ template: 'THRESHOLD' }); // eşiksiz — katman 1 normalde reddederdi

        expect(res.status).toBe(400);
        expect(res.status).not.toBe(500);
        // Katman 1 devre dışı — bu mesaj ARTIK katman 2'nin (wrapCheckViolation)
        // mesajı olmalı, katman 1'inki DEĞİL.
        expect(res.body.message).toContain('kısıtı ihlal edildi');
      } finally {
        svc.resolveAmountThreshold = original;
      }

      const row = await getPolicyById(dataSource, standardId);
      expect(row.template).toBe('STANDARD');
      expect(row.amount_threshold).toBeNull();
    });

    it('servis doğrulaması (katman 1) test-zamanı devre dışı bırakılır → CHECK yine de 400 döndürür (STANDARD + eşik)', async () => {
      const admin = await loginAs(app, 'ADMIN');
      const policyService = app.get(ApprovalPolicyService);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = policyService as any;
      const original: (dto: unknown) => number | null =
        svc.resolveAmountThreshold.bind(svc);

      svc.resolveAmountThreshold = (dto: { amountThreshold?: number }) =>
        dto.amountThreshold ?? null;

      try {
        const res = await request(app.getHttpServer())
          .patch(`/approval-policies/${standardId}`)
          .set(admin.authHeader())
          .send({ template: 'STANDARD', amountThreshold: 5000 }); // katman 1 normalde reddederdi

        expect(res.status).toBe(400);
        expect(res.status).not.toBe(500);
        expect(res.body.message).toContain('kısıtı ihlal edildi');
      } finally {
        svc.resolveAmountThreshold = original;
      }

      const row = await getPolicyById(dataSource, standardId);
      expect(row.template).toBe('STANDARD');
      expect(row.amount_threshold).toBeNull();
    });
  });

  describe('K-2.5.13e Faz 2 alanları (tierRoles/delegateAllowed) — DTO kapsamı dışı', () => {
    it('PATCH gövdesinde tierRoles/delegateAllowed gönderilirse: whitelist reddi (400) — sessiz kabul YOK', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const res = await request(app.getHttpServer())
        .patch(`/approval-policies/${twoTierId}`)
        .set(admin.authHeader())
        .send({
          template: 'TWO_TIER',
          tierRoles: [{ tier: 1, roleCode: 'CATEGORY_MANAGER' }],
          delegateAllowed: true,
        });

      // ÖLÇÜLDÜ: main.ts/app-bootstrap.ts ValidationPipe'ı
      // `forbidNonWhitelisted: true` taşıyor — DTO'da tanımlı olmayan bir
      // alan REDDEDİLİR (400), sessizce yok sayılmaz. Bu, dosyanın kendi
      // yorumuyla (`update-approval-policy.dto.ts`: "zaten reddeder")
      // tutarlı; task brief'indeki "sessizce yok sayılıyor" ifadesi bu
      // uçta YANLIŞ ölçülüyor — bkz. QA raporu.
      expect(res.status).toBe(400);

      const row = await getPolicyById(dataSource, twoTierId);
      expect(row.template).toBe('TWO_TIER');
    });

    it('bu uç üzerinden geçerli bir PATCH, tierRoles/delegateAllowed kolonlarına asla dokunmaz', async () => {
      const admin = await loginAs(app, 'ADMIN');

      const before: { tier_roles: unknown; delegate_allowed: boolean } = (
        await dataSource.query(
          `SELECT tier_roles, delegate_allowed FROM main.approval_policies WHERE id = $1`,
          [twoTierId],
        )
      )[0];

      await request(app.getHttpServer())
        .patch(`/approval-policies/${twoTierId}`)
        .set(admin.authHeader())
        .send({ template: 'TWO_TIER' })
        .expect(200);

      const after: { tier_roles: unknown; delegate_allowed: boolean } = (
        await dataSource.query(
          `SELECT tier_roles, delegate_allowed FROM main.approval_policies WHERE id = $1`,
          [twoTierId],
        )
      )[0];

      expect(after.tier_roles).toEqual(before.tier_roles);
      expect(after.delegate_allowed).toBe(before.delegate_allowed);
    });
  });
});

/**
 * lta-parent-lifecycle-status-gate.e2e-spec.ts
 *
 * SÖZLEŞME: Bir LTA oran kademesi motora yalnızca EBEVEYN yaşam döngüsü
 * kaydı (`main.agreements`, `agreement_type='LTA'`) YÜRÜRLÜKTEYSE iner.
 *
 *   agreements.status ∈ {APPROVED, ACTIVE}   →  oran motora İNER
 *   agreements.status ∈ {DRAFT, PENDING,     →  oran motora İNMEZ
 *                        REJECTED, CANCELLED,
 *                        CLOSED}
 *
 * ── KUSUR (T-335, ölçüldü 2026-08-31 — düzeltmeden ÖNCE) ────────────────
 * `lta-agreement.repository.ts findActiveForCPL` YALNIZ `lta.status='active'`
 * filtreliyordu; `main.agreements` tablosuna JOIN YOKTU. `Z38 §3(a)` bağa
 * *"agreements = onay · audit · SoD · defter bağının kanonik yeri"* anlamını
 * yüklemişti — ama o kaydın ONAY DURUMUNU okuyan HİÇBİR YOL yoktu. Yani
 * hiç onaya sunulmamış (`DRAFT`) ya da REDDEDİLMİŞ bir yaşam döngüsü
 * kaydının oran kademesi harcama motoruna iniyordu.
 *
 * *"Mekanizma var, ona giden yol yok"* sınıfının OKUMA tarafındaki şekli.
 *
 * ── REPRODÜKSİYON (düzeltmeden ÖNCE koşturuldu, exit≠0) ─────────────────
 * `DRAFT` ebeveyn + `active` oran başlığı ⇒ `BASE_LTA_ON` = `%7 × BASE_GSV`
 * (beklenen `0`). Kırmızının SEBEBİ doğrudan kusurun kendisiydi.
 *
 * ── AYIRT EDİCİLİK (`DISIPLIN`: fark taşımak GEREKLİ, o farkı OKUYAN
 *    assertion olmadan YETERSİZ) ────────────────────────────────────────
 * AYNI `lta_agreements` satırı, AYNI oranlar, AYNI plan/SKU — değişen TEK
 * şey ebeveynin `status`'ü. İki ölçüm arasındaki FARK bir assertion'a bağlı.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  cleanupTestPlans,
  cleanupTestAgreements,
  E2EFixture,
} from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

/** Bir KPI hücresinin okunan şekli (`value` bölünme/eksik-veri hâlinde `null`). */
interface KpiCell {
  value: number | null;
}
type CalculatedKpis = Record<string, KpiCell>;

/**
 * Bir KPI hücresinin sayısal değerini okur.
 *
 * ⚠️ `null` SESSİZCE geçilmez, AÇIK HATA olur (`§2.5`). Bu testlerin
 * hiçbirinde `null` meşru bir sonuç değil: `BASE_GSV`/`BASE_LTA_*` her
 * ölçümde hesaplanabilir olmalı. `!` (non-null assertion) kullanılsaydı
 * gerçek bir `null` regresyonu `0`/`NaN` karşılaştırmasına dönüşüp
 * SESSİZCE yeşil ya da yanlış-kırmızı verirdi.
 */
function num(cell: KpiCell, label: string): number {
  if (cell === undefined || cell === null || cell.value === null) {
    throw new Error(
      `KPI '${label}' sayısal değer taşımıyor: ${JSON.stringify(cell)}`,
    );
  }
  return cell.value;
}

const ON_PCT = 9; // ⚠️ repodaki diğer LTA fixture'larının %7 ve %5'inden FARKLI
const OFF_PCT = 4; // ⚠️ ON_PCT'ten de farklı — iki oranın karışması yakalanır
const NAME_PREFIX = 'E2E-T335';
const PLAN_PREFIX = 'E2E-T335-GATE';
const LTA_CODE_PREFIX = 'T335_';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
function isoToday(): string {
  return iso(new Date());
}
function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
}

describe('LTA ebeveyn yaşam-döngüsü DURUM KAPISI (T-335)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  let channelNka: string;
  let categorySacBoyasi: string;
  let fuTupBoya: string;
  let tacticId: string;
  let mechanicId: string;

  let parentId: string;
  let ltaAgreementId: string;
  let planId: string;
  let skuId: string;
  let listPrice: number;
  let baseGsv: number;

  const BASE_VOLUME = 1000;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [channelNka, categorySacBoyasi, fuTupBoya] = await Promise.all([
      dataSource
        .query(
          `SELECT id FROM main.channels WHERE tenant_id = $1 AND code = 'NKA'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
      dataSource
        .query(
          `SELECT id FROM main.categories WHERE tenant_id = $1 AND code = 'CAT-SAC-BOYASI'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
      dataSource
        .query(
          `SELECT id FROM main.forecasting_units WHERE tenant_id = $1 AND code = 'FU-TUP-BOYA'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
    ]);

    const tacticRows = await dataSource.query(
      `SELECT id FROM main.tactics WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixture.tenantId],
    );
    const mechanicRows = await dataSource.query(
      `SELECT id FROM main.mechanics WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixture.tenantId],
    );
    if (tacticRows.length === 0 || mechanicRows.length === 0) {
      throw new Error(
        'E2E fixture eksik: tactic/mechanic bulunamadı (`npm run seed` çalıştırın).',
      );
    }
    tacticId = tacticRows[0].id;
    mechanicId = mechanicRows[0].id;

    const admin = await loginAs(app, 'ADMIN');

    // ── EBEVEYN yaşam döngüsü kaydı. DRAFT doğar (agreement.service.ts:190).
    // ⚠️ Tarihler 2026-02 döneminde: `approve` bütçe rezervasyonu yapıyor ve
    // zarflar yalnız `2026-01`/`2026-02` dönemleri için var (ölçüldü).
    // LTA süre kuralı > 30 gün (agreement.service.ts:100-111).
    const parentRes = await request(app.getHttpServer())
      .post('/agreements')
      .set(admin.authHeader())
      .send({
        agreementName: `${NAME_PREFIX}-PARENT-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        agreementType: 'LTA',
        cplId: fixture.cplId,
        channelId: channelNka,
        categoryId: categorySacBoyasi,
        fuId: fuTupBoya,
        tacticId,
        mechanicId,
        skuScope: 'FU',
        capTotalAmount: 5000,
        spendType: 'BOTH',
        startDate: '2026-02-05',
        endDate: '2026-04-05',
        justification: 'T-335 e2e — ebeveyn durum kapısı',
      })
      .expect(201);
    parentId = parentRes.body.id;

    // ── ORAN ŞARTLARI başlığı — GERÇEK üretim ucundan, ve ACTIVE'e alınır.
    const ltaRes = await request(app.getHttpServer())
      .post('/lta-agreements')
      .set(admin.authHeader())
      .send({
        agreementId: parentId,
        cplId: fixture.cplId,
        agreementName: 'T-335 durum kapısı fixture',
        agreementCode: `${LTA_CODE_PREFIX}GATE_${Date.now()}`,
        effectiveDate: isoToday(),
        rates: [
          {
            channel: 'ALL',
            category: 'ALL',
            onInvoicePercentage: ON_PCT,
            offInvoicePercentage: OFF_PCT,
          },
        ],
      })
      .expect(201);
    ltaAgreementId = ltaRes.body.id;

    await request(app.getHttpServer())
      .post(`/lta-agreements/${ltaAgreementId}/activate`)
      .set(admin.authHeader())
      .expect(204);

    // ── PLAN + SKU
    const planner = await loginAs(app, 'PLANNER');
    const planRes = await request(app.getHttpServer())
      .post('/plans')
      .set(planner.authHeader())
      .send({
        planName: `${PLAN_PREFIX}-${Date.now()}`,
        cplId: fixture.cplId,
        channelId: channelNka,
        categoryId: categorySacBoyasi,
        startDate: isoToday(),
        endDate: isoPlusDays(25),
      })
      .expect(201);
    planId = planRes.body.id;

    await request(app.getHttpServer())
      .post(`/plans/${planId}/fus`)
      .set(planner.authHeader())
      .send({ fuId: fuTupBoya, planVersion: 1 })
      .expect(201);

    const planSkuRows: Array<{ sku_id: string; unit_price: string }> =
      await dataSource.query(
        `SELECT ps.sku_id, sk.unit_price
           FROM main.plan_skus ps
           JOIN main.skus sk ON sk.id = ps.sku_id
          WHERE ps.plan_fu_id = (
            SELECT id FROM main.plan_fus WHERE plan_id = $1 LIMIT 1
          )
          LIMIT 1`,
        [planId],
      );
    skuId = planSkuRows[0].sku_id;
    listPrice = parseFloat(planSkuRows[0].unit_price);
    baseGsv = BASE_VOLUME * listPrice;
  });

  afterAll(async () => {
    const admin = await getAdminDataSource();
    await cleanupTestPlans(app, fixture.tenantId, `${PLAN_PREFIX}-`);
    // ⚠️ SIRA ZORUNLU: `FK_lta_agreements_agreement` ON DELETE RESTRICT —
    // önce oran-şartları başlığı, sonra yaşam döngüsü kaydı.
    // Temizlik id LİSTESİNE DEĞİL ÖN EKE dayanır (`T-047`: bir assertion
    // düştüğünde `push` satırına hiç ulaşılmaz ve satır sızar).
    await admin.query(
      `DELETE FROM main.lta_agreements WHERE tenant_id = $1 AND agreement_code LIKE 'T335\\_%'`,
      [fixture.tenantId],
    );
    await cleanupTestAgreements(app, fixture.tenantId, `${NAME_PREFIX}-`);
    await closeTestApp();
    await closeAdminDataSource();
  });

  beforeEach(() => clearTokenCache());

  /** Hacmi yazar ve dönen KPI'ları verir — recalc bu uçtan tetikleniyor. */
  async function measureKpis(version: number): Promise<CalculatedKpis> {
    const planner = await loginAs(app, 'PLANNER');
    const res = await request(app.getHttpServer())
      .patch(`/plans/${planId}/fus/${fuTupBoya}/skus/${skuId}/volume`)
      .set(planner.authHeader())
      .send({ baseVolume: BASE_VOLUME, version })
      .expect(200);
    return res.body.calculatedKpis as CalculatedKpis;
  }

  async function parentStatus(): Promise<string> {
    const rows = await dataSource.query(
      `SELECT status FROM main.agreements WHERE id = $1`,
      [parentId],
    );
    return rows[0].status;
  }

  let draftKpis: CalculatedKpis;
  let approvedKpis: CalculatedKpis;

  it('DRAFT ebeveyn — oran motora İNMEZ (KUSUR: iniyordu, BASE_LTA_ON = %9 × BASE_GSV)', async () => {
    // POZ. KONTROL 1 — fixture GERÇEKTEN ayrımın "yürürlükte değil"
    // tarafında: ebeveyn hiç onaya sunulmamış.
    expect(await parentStatus()).toBe('DRAFT');

    // POZ. KONTROL 2 — oran başlığının KENDİSİ `active`, yani bu testin
    // ölçtüğü şey `lta.status` kapısı DEĞİL, EBEVEYN kapısı.
    const ltaRows = await dataSource.query(
      `SELECT status FROM main.lta_agreements WHERE id = $1`,
      [ltaAgreementId],
    );
    expect(ltaRows[0].status).toBe('active');

    draftKpis = await measureKpis(1);

    // POZ. KONTROL 3 — zincir GERÇEKTEN koştu (BASE_GSV geliyor); yani
    // aşağıdaki `0`, "hiçbir şey hesaplanmadı"nın değil, LTA'nın
    // uygulanmamasının sonucu.
    expect(num(draftKpis.BASE_GSV, 'BASE_GSV')).toBeCloseTo(baseGsv, 2);

    expect(num(draftKpis.BASE_LTA_ON, 'BASE_LTA_ON')).toBeCloseTo(0, 2);
    expect(num(draftKpis.BASE_LTA_OFF, 'BASE_LTA_OFF')).toBeCloseTo(0, 2);
  });

  it('APPROVED ebeveyn — AYNI oran başlığı motora İNER (%9/%4), ve FARK okunuyor', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const financeManager = await loginAs(app, 'FINANCE_MANAGER');

    // SoD: submit ADMIN, approve FINANCE_MANAGER (seed-e2e.ts
    // `createAndApproveAgreement` ile aynı gerekçe).
    await request(app.getHttpServer())
      .post(`/agreements/${parentId}/submit`)
      .set(admin.authHeader())
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/agreements/${parentId}/approve`)
      .set(financeManager.authHeader())
      .send({})
      .expect(200);

    expect(await parentStatus()).toBe('APPROVED');

    // Oran başlığına DOKUNULMADI — değişen TEK şey ebeveynin durumu.
    const ltaRows = await dataSource.query(
      `SELECT status FROM main.lta_agreements WHERE id = $1`,
      [ltaAgreementId],
    );
    expect(ltaRows[0].status).toBe('active');

    approvedKpis = await measureKpis(2);

    const expectedOn = (baseGsv * ON_PCT) / 100;
    const expectedOff = ((baseGsv - expectedOn) * OFF_PCT) / 100;
    const onAfter = num(approvedKpis.BASE_LTA_ON, 'BASE_LTA_ON');
    const offAfter = num(approvedKpis.BASE_LTA_OFF, 'BASE_LTA_OFF');
    const onBefore = num(draftKpis.BASE_LTA_ON, 'BASE_LTA_ON(draft)');

    expect(onAfter).toBeCloseTo(expectedOn, 2);
    expect(offAfter).toBeCloseTo(expectedOff, 2);

    // ── FARKI OKUYAN assertion (bu olmadan fixture yetersizdir) ──────────
    // 1 · İki ölçüm AYNI DEĞİL — kapı gerçekten ayırt ediyor.
    expect(onAfter).not.toBeCloseTo(onBefore, 2);
    // 2 · Farkın BÜYÜKLÜĞÜ tam olarak uygulanan orandır.
    expect(onAfter - onBefore).toBeCloseTo(expectedOn, 2);
    // 3 · on ≠ off — iki oran karışsaydı düşerdi.
    expect(onAfter).not.toBeCloseTo(offAfter, 2);
    // 4 · BASE_GSV her iki ölçümde AYNI — değişen şey yalnız LTA kolu.
    expect(num(approvedKpis.BASE_GSV, 'BASE_GSV')).toBeCloseTo(
      num(draftKpis.BASE_GSV, 'BASE_GSV(draft)'),
      2,
    );
  });
});

/**
 * ── T-336 `Q22` — "BİR EBEVEYN = BİR BAŞLIK, ÖMÜR BOYU" ────────────────────
 *
 * DB tarafı zaten ömür-boyu tekil (`UQ_lta_agreements_agreement_id`,
 * `IDX_lta_agreements_tenant_code` — ikisi de KISMİ DEĞİL, `deleted_at`
 * predicate'i yok). Kusur DB'de değildi: uygulama ön-kontrolleri
 * (`lta-agreement.service.ts` `alreadyBound` · `lta-agreement.repository.ts`
 * `findByCode`) `withDeleted` OLMADAN sorguluyordu, yani soft-delete
 * edilmiş bir satır onlar için "yok" görünüyor, `INSERT` ham
 * `QueryFailedError` (23505) ile çarpıp kullanıcıya ANLAMSIZ bir `500`
 * dönüyordu. İniş: iki ön-kontrole de `withDeleted: true`; `500 → 409`,
 * doğru mesajla.
 *
 * Bu describe bloğu kendi fixture'larını kurar (parent + LTA rate title,
 * KPI/plan zincirine GİRMEDEN) — T-335 bloğunun aksine burada motora
 * inen oran değil, YARATMA/BAĞLAMA ön-kontrolleri ölçülüyor.
 */
describe('LTA oran başlığı — EBEVEYN-BAĞI ve KOD tekilliği, soft-delete (T-336)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fixture: E2EFixture;

  let channelNka: string;
  let categorySacBoyasi: string;
  let fuTupBoya: string;
  let tacticId: string;
  let mechanicId: string;

  const NAME_PREFIX = 'E2E-T336';
  const LTA_CODE_PREFIX = 'T336_';

  function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }
  function isoToday(): string {
    return iso(new Date());
  }

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());

    [channelNka, categorySacBoyasi, fuTupBoya] = await Promise.all([
      dataSource
        .query(
          `SELECT id FROM main.channels WHERE tenant_id = $1 AND code = 'NKA'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
      dataSource
        .query(
          `SELECT id FROM main.categories WHERE tenant_id = $1 AND code = 'CAT-SAC-BOYASI'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
      dataSource
        .query(
          `SELECT id FROM main.forecasting_units WHERE tenant_id = $1 AND code = 'FU-TUP-BOYA'`,
          [fixture.tenantId],
        )
        .then((r) => r[0].id),
    ]);

    const tacticRows = await dataSource.query(
      `SELECT id FROM main.tactics WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixture.tenantId],
    );
    const mechanicRows = await dataSource.query(
      `SELECT id FROM main.mechanics WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [fixture.tenantId],
    );
    if (tacticRows.length === 0 || mechanicRows.length === 0) {
      throw new Error(
        'E2E fixture eksik: tactic/mechanic bulunamadı (`npm run seed` çalıştırın).',
      );
    }
    tacticId = tacticRows[0].id;
    mechanicId = mechanicRows[0].id;
  });

  afterAll(async () => {
    const admin = await getAdminDataSource();
    await admin.query(
      `DELETE FROM main.lta_agreements WHERE tenant_id = $1 AND agreement_code LIKE 'T336\\_%'`,
      [fixture.tenantId],
    );
    await cleanupTestAgreements(app, fixture.tenantId, `${NAME_PREFIX}-`);
    await closeTestApp();
    await closeAdminDataSource();
  });

  beforeEach(() => clearTokenCache());

  /** Bir LTA yaşam döngüsü ebeveyni (`main.agreements`, type=LTA) yaratır. */
  async function createParent(label: string): Promise<string> {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .post('/agreements')
      .set(admin.authHeader())
      .send({
        agreementName: `${NAME_PREFIX}-${label}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        agreementType: 'LTA',
        cplId: fixture.cplId,
        channelId: channelNka,
        categoryId: categorySacBoyasi,
        fuId: fuTupBoya,
        tacticId,
        mechanicId,
        skuScope: 'FU',
        capTotalAmount: 5000,
        spendType: 'BOTH',
        startDate: '2026-02-05',
        endDate: '2026-04-05',
        justification: `T-336 e2e — ${label}`,
      })
      .expect(201);
    return res.body.id;
  }

  /** Bir oran-şartları başlığı (`lta_agreements`) yaratır ve ID döner. */
  async function createLtaTitle(
    parentId: string,
    code: string,
    expectedStatus = 201,
  ): Promise<request.Response> {
    const admin = await loginAs(app, 'ADMIN');
    return request(app.getHttpServer())
      .post('/lta-agreements')
      .set(admin.authHeader())
      .send({
        agreementId: parentId,
        cplId: fixture.cplId,
        agreementName: `T-336 fixture ${code}`,
        agreementCode: code,
        effectiveDate: isoToday(),
        rates: [
          {
            channel: 'ALL',
            category: 'ALL',
            onInvoicePercentage: 3,
            offInvoicePercentage: 2,
          },
        ],
      })
      .expect(expectedStatus);
  }

  async function softDeleteLtaTitle(id: string): Promise<void> {
    const admin = await getAdminDataSource();
    await admin.query(
      `UPDATE main.lta_agreements SET deleted_at = NOW() WHERE id = $1`,
      [id],
    );
  }

  it('PIN 1 · soft-delete edilmiş başlık → AYNI ebeveyne yeni başlık → 409 (500 DEĞİL), doğru mesaj', async () => {
    const parentA = await createParent('PIN1-PARENT');
    const titleRes = await createLtaTitle(
      parentA,
      `${LTA_CODE_PREFIX}PIN1_A1_${Date.now()}`,
    );
    await softDeleteLtaTitle(titleRes.body.id);

    // POZ. KONTROL — satır GERÇEKTEN soft-delete edilmiş.
    const rows = await dataSource.query(
      `SELECT deleted_at FROM main.lta_agreements WHERE id = $1`,
      [titleRes.body.id],
    );
    expect(rows[0].deleted_at).not.toBeNull();

    const conflictRes = await createLtaTitle(
      parentA,
      `${LTA_CODE_PREFIX}PIN1_A2_${Date.now()}`,
      409,
    );
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.message).not.toBe(undefined);
    // ⛔ 500 DEĞİL — ham QueryFailedError DEĞİL, uygulama seviyesinde
    // anlaşılır bir çakışma.
    expect(conflictRes.status).not.toBe(500);
    // ⛔ AYIRT EDİCİ olmalı: `/ömür boyu tekil/` HER İKİ mesajda da geçer
    // (ebeveyn-bağı ve kod-tekilliği) ⇒ bu PIN'i KOD çakışmasından ayırmaz
    // (`§2.7 #6`: "kapsam var, ayırt etme gücü yok"). `yeri tutar` +
    // constraint adı YALNIZ ebeveyn-bağı mesajında.
    expect(String(conflictRes.body.message)).toMatch(/yeri tutar/);
    expect(String(conflictRes.body.message)).toMatch(
      /UQ_lta_agreements_agreement_id/,
    );
  });

  it('PIN 2 · soft-delete edilmiş kod → aynı kod ile FARKLI ebeveyne yeni başlık → 409 (500 DEĞİL), doğru mesaj', async () => {
    const parentB = await createParent('PIN2-PARENT-B');
    const parentD = await createParent('PIN2-PARENT-D');
    const sharedCode = `${LTA_CODE_PREFIX}PIN2_SHARED_${Date.now()}`;

    const titleRes = await createLtaTitle(parentB, sharedCode);
    await softDeleteLtaTitle(titleRes.body.id);

    const rows = await dataSource.query(
      `SELECT deleted_at FROM main.lta_agreements WHERE id = $1`,
      [titleRes.body.id],
    );
    expect(rows[0].deleted_at).not.toBeNull();

    // AYNI kod, FARKLI ebeveyn (parentD) — bu, PIN 1'in ebeveyn-bağı
    // çakışmasından AYRI bir invaryantı (KOD tekilliği) sınar.
    const conflictRes = await createLtaTitle(parentD, sharedCode, 409);
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.status).not.toBe(500);
    expect(String(conflictRes.body.message)).toMatch(
      /sonlandırılmış\/soft-delete edilmiş bir kayıt da kodu tutar/,
    );
  });

  it('PIN 3 · terminate → FARKLI ebeveyne yeni başlık → 201 ⛔ AÇIK KALMALI', async () => {
    const parentE = await createParent('PIN3-PARENT-E');
    const parentF = await createParent('PIN3-PARENT-F');

    const titleE = await createLtaTitle(
      parentE,
      `${LTA_CODE_PREFIX}PIN3_E_${Date.now()}`,
    );

    const admin = await loginAs(app, 'ADMIN');
    await request(app.getHttpServer())
      .post(`/lta-agreements/${titleE.body.id}/terminate`)
      .set(admin.authHeader())
      .send({
        reason:
          'T-336 PIN 3 — terminate, FARKLI ebeveyne yeni başlık açık kalmalı',
      })
      .expect(204);

    // Terminate SOFT-DELETE DEĞİLDİR — satır hâlâ `deleted_at IS NULL`.
    const rows = await dataSource.query(
      `SELECT status, deleted_at FROM main.lta_agreements WHERE id = $1`,
      [titleE.body.id],
    );
    expect(rows[0].status).toBe('terminated');
    expect(rows[0].deleted_at).toBeNull();

    // FARKLI ebeveyne (parentF) yeni bir başlık — bu yol KAPANMAMALI.
    const newTitleRes = await createLtaTitle(
      parentF,
      `${LTA_CODE_PREFIX}PIN3_F_${Date.now()}`,
      201,
    );
    expect(newTitleRes.status).toBe(201);
  });
});

/**
 * ledger-read-surface.e2e-spec.ts — `SC-5a` (`Faz-2 W1`, `FAZ2_PLANLAMA_BRIEF.md §1iv`)
 *
 * Kapsam: `GET /ledger` (liste, filtresiz) + `GET /ledger/:id` (tekil) —
 * uçtan uca, mock YOK. `ledger-envelope-role-boundary.e2e-spec.ts` yalnız
 * `envelope/:envelopeId` RBAC hizalamasını kapsıyor; kök `GET /ledger` ve
 * `GET /ledger/:id`'nin GERÇEK bir DEBIT/CREDIT (reversal) çiftini doğru
 * ayırt ettiği hiçbir yerde doğrudan ölçülmemişti.
 *
 * ⛔ `AYIRT EDİCİ`: "yön ayrımının okuma yüzeyinde de tuttuğu" — bir
 * off-invoice agreement transaction (DEBIT ledger satırı) ve onun
 * reversal'i (CREDIT ledger satırı, `reversal.service.ts`) AYNI
 * agreement'a bağlıdır; `GET /ledger?agreementId=X` ve `GET /ledger/:id`
 * bu ikisini birbirinden `entryDirection` ile ayırt edebiliyor mu?
 * Karıştırılırsa (ör. reversal DEBIT gibi okunursa) tüketim hesapları
 * SESSİZCE ikiye katlanır (`K-2.11.x` defter invaryantı).
 *
 * Fixture izolasyonu: kendine özel agreement (`E2E-SC5A-` önekli,
 * `createAndApproveAgreement` — role-journey/settlement ile aynı desen),
 * kendine özel off-invoice transaction + reversal.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  resolveIdByCode,
  createAndApproveAgreement,
  createOffInvoiceTransaction,
  cleanupTestAgreements,
  cleanupTestTransactions,
  E2EFixture,
} from './helpers/seed-e2e';
import { closeAdminDataSource } from './helpers/admin-datasource';

describe('Ledger Read Surface (E2E) — GET /ledger + /ledger/:id, SC-5a', () => {
  let app: INestApplication;
  let fixture: E2EFixture;

  let CHANNEL_ECOM: string;
  let FU_WELLA_HC_500ML: string;
  let TACTIC_PROMO: string;
  let MECHANIC_DISCOUNT: string;

  let agreementId: string;
  let transactionId: string;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);

    // T-037 deseni (settlement.e2e-spec.ts): NKA/ENV-2026-NKA-Q2'den kaçın —
    // paralel worker'larda paylaşılan/yoğun kullanılan envelope, race riski.
    [CHANNEL_ECOM, FU_WELLA_HC_500ML, TACTIC_PROMO, MECHANIC_DISCOUNT] =
      await Promise.all([
        resolveIdByCode(app, fixture.tenantId, 'channels', 'E_COMMERCE'),
        resolveIdByCode(
          app,
          fixture.tenantId,
          'forecasting_units',
          'FU-WELLA-HC-500ML',
        ),
        resolveIdByCode(app, fixture.tenantId, 'tactics', 'TAC-PROMO'),
        resolveIdByCode(app, fixture.tenantId, 'mechanics', 'MEC-DISCOUNT'),
      ]);

    const agreement = await createAndApproveAgreement(app, {
      tenantId: fixture.tenantId,
      cplId: fixture.cplId,
      channelId: CHANNEL_ECOM,
      fuId: FU_WELLA_HC_500ML,
      tacticId: TACTIC_PROMO,
      mechanicId: MECHANIC_DISCOUNT,
      capTotalAmount: 8000,
      namePrefix: 'E2E-SC5A',
    });
    agreementId = agreement.agreementId;

    transactionId = await createOffInvoiceTransaction(
      app,
      agreementId,
      `SC5A-${Date.now()}`,
      3000,
    );
  }, 60000);

  afterAll(async () => {
    try {
      await cleanupTestTransactions(app, agreementId);
    } catch (e) {
      console.warn('Cleanup (SC-5a transactions) başarısız:', e);
    }
    try {
      await cleanupTestAgreements(app, fixture.tenantId, 'E2E-SC5A');
    } catch (e) {
      console.warn('Cleanup (SC-5a agreements) başarısız:', e);
    }
    await closeTestApp();
    await closeAdminDataSource();
  }, 60000);

  it('⛔ AYIRT EDİCİ: reversal ÖNCESİ /ledger?agreementId tek DEBIT satırı, reversal SONRASI DEBIT+CREDIT çifti — /ledger/:id ikisini de doğru entryDirection ile döner', async () => {
    const planner = await loginAs(app, 'PLANNER');

    // ── ÖNCESİ: yalnız orijinal DEBIT ──
    const beforeRes = await request(app.getHttpServer())
      .get('/ledger')
      .query({ agreementId })
      .set(planner.authHeader())
      .expect(200);
    expect(beforeRes.body.length).toBe(1);
    expect(beforeRes.body[0].entryDirection).toBe('DEBIT');
    // `sourceId` agreement'a işaret eder (`ledger-entry.entity.ts:46`,
    // "Agreement.id or Plan.id"), transaction'a değil — transaction'ın
    // izi `idempotencyKey`'de (`LEDGER|AGREEMENT|{agreement_id}|
    // {transaction_id}`, `ledger-entry.entity.ts:129`).
    expect(beforeRes.body[0].sourceId).toBe(agreementId);
    expect(beforeRes.body[0].idempotencyKey).toContain(transactionId);
    const debitEntryId = beforeRes.body[0].id;

    // ── Tekil okuma ucu — DEBIT ──
    const debitSingle = await request(app.getHttpServer())
      .get(`/ledger/${debitEntryId}`)
      .set(planner.authHeader())
      .expect(200);
    expect(debitSingle.body.entryDirection).toBe('DEBIT');

    // ── GERÇEK reversal (CATEGORY_MANAGER veya ADMIN) ──
    const admin = await loginAs(app, 'ADMIN');
    await request(app.getHttpServer())
      .post(`/actuals-first/reversals/agreement-transaction/${transactionId}`)
      .set(admin.authHeader())
      .send({ justification: 'SC-5a e2e — yön ayrımı kanıtı' })
      .expect(200);

    // ── SONRASI: DEBIT + CREDIT çifti, birbirinden ayırt edilebiliyor ──
    const afterRes = await request(app.getHttpServer())
      .get('/ledger')
      .query({ agreementId })
      .set(planner.authHeader())
      .expect(200);
    expect(afterRes.body.length).toBe(2);

    const directions = afterRes.body
      .map((r: { entryDirection: string }) => r.entryDirection)
      .sort();
    expect(directions).toEqual(['CREDIT', 'DEBIT']);

    const creditRow = afterRes.body.find(
      (r: { entryDirection: string }) => r.entryDirection === 'CREDIT',
    );
    expect(creditRow).toBeDefined();
    expect(Number(creditRow.amount)).toBe(3000);

    // ── Tekil okuma ucu — CREDIT (reversal satırı) ──
    const creditSingle = await request(app.getHttpServer())
      .get(`/ledger/${creditRow.id}`)
      .set(planner.authHeader())
      .expect(200);
    expect(creditSingle.body.entryDirection).toBe('CREDIT');
    expect(creditSingle.body.id).not.toBe(debitEntryId);
  });

  it('GET /ledger/:id — var olmayan bir id 404 döner (var olanla AYNI davranış OLAMAZ)', async () => {
    const planner = await loginAs(app, 'PLANNER');
    const res = await request(app.getHttpServer())
      .get(`/ledger/${randomUUID()}`)
      .set(planner.authHeader());
    expect(res.status).toBe(404);
  });

  it('GET /ledger (kök, filtresiz) — gerçek satırlarımız listede GÖRÜNÜYOR (aggregation gerçekten çalışıyor, boş küme değil)', async () => {
    const planner = await loginAs(app, 'PLANNER');
    const res = await request(app.getHttpServer())
      .get('/ledger')
      .set(planner.authHeader())
      .expect(200);
    const ids = res.body.map((r: { id: string }) => r.id);
    const ourEntries = res.body.filter(
      (r: { agreementId?: string }) => r.agreementId === agreementId,
    );
    expect(ourEntries.length).toBe(2);
    expect(new Set(ids).size).toBe(ids.length); // tekillik — kopya satır yok
  });
});

/**
 * E2E Seed Helper
 *
 * E2E testleri için gerekli fixture verilerini doğrudan servis/endpoint
 * üzerinden oluşturur. Deterministik: aynı agreementCode ile tekrar
 * çağrılırsa mevcut kaydı döner (idempotent).
 *
 * Kullanım:
 *   const fixture = await buildE2EFixture(app);
 *   // fixture.approvedAgreementId, fixture.transactionId, fixture.tenantId
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { loginAs } from './auth';

export interface E2EFixture {
  tenantId: string;
  adminUserId: string;
  approvedAgreementId: string;
  draftAgreementId: string;
  /**
   * transactionId: reversal testleri için kullanılacak off-invoice transaction.
   * Her test çalışmasında TESLİM edilen bu ID reversal ile tüketilir,
   * bu nedenle reversal test suite'i kendi transaction'ını oluşturmalıdır.
   */
  approvedAgreementCode: string;
  cplId: string;
}

/** Tenant veritabanından mevcut seed verilerini okur — seed'i yeniden çalıştırmaz. */
export async function loadE2EFixture(
  app: INestApplication,
): Promise<E2EFixture> {
  const dataSource = app.get<DataSource>(getDataSourceToken());

  // Tenant
  const tenant = await dataSource.query(
    `SELECT id FROM main.tenants WHERE name = 'Wella Turkey' LIMIT 1`,
  );
  if (!tenant || tenant.length === 0) {
    throw new Error(
      'E2E fixture eksik: Wella Turkey tenant bulunamadı. `npm run seed` çalıştırın.',
    );
  }
  const tenantId: string = tenant[0].id;

  // Admin user
  const adminUser = await dataSource.query(
    `SELECT id FROM main.users WHERE tenant_id = $1 AND email = 'admin@wella.com' LIMIT 1`,
    [tenantId],
  );
  if (!adminUser || adminUser.length === 0) {
    throw new Error(
      'E2E fixture eksik: admin@wella.com bulunamadı. `npm run seed` çalıştırın.',
    );
  }
  const adminUserId: string = adminUser[0].id;

  // CPL (ilk CPL)
  const cpl = await dataSource.query(
    `SELECT id FROM main.cpls WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (!cpl || cpl.length === 0) {
    throw new Error(
      'E2E fixture eksik: CPL bulunamadı. `npm run seed` çalıştırın.',
    );
  }
  const cplId: string = cpl[0].id;

  // APPROVED agreement (seed'den: STA-2026-0002)
  // Seed sonrası test çalışması APPROVED'ı CLOSED yapabilir.
  // Bu durumda reset: agreement status'u geri APPROVED yap (e2e idempotency için).
  let approvedAgreement = await dataSource.query(
    `SELECT id, agreement_code FROM main.agreements
     WHERE tenant_id = $1 AND status = 'APPROVED'
     ORDER BY created_at ASC LIMIT 1`,
    [tenantId],
  );
  if (!approvedAgreement || approvedAgreement.length === 0) {
    // CLOSED olan STA-2026-0002'yi APPROVED'a geri döndür (fixture reset)
    await dataSource.query(
      `UPDATE main.agreements
       SET status = 'APPROVED', closed_at = NULL, closed_by = NULL
       WHERE tenant_id = $1 AND agreement_code = 'STA-2026-0002'`,
      [tenantId],
    );
    approvedAgreement = await dataSource.query(
      `SELECT id, agreement_code FROM main.agreements
       WHERE tenant_id = $1 AND status = 'APPROVED'
       ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );
    if (!approvedAgreement || approvedAgreement.length === 0) {
      throw new Error(
        'E2E fixture eksik: APPROVED agreement bulunamadı ve reset başarısız. ' +
          "`npm run seed` çalıştırın veya STA-2026-0002 agreement'ını kontrol edin.",
      );
    }
  }
  const approvedAgreementId: string = approvedAgreement[0].id;
  const approvedAgreementCode: string = approvedAgreement[0].agreement_code;

  // DRAFT agreement (seed'den: STA-2026-0001)
  const draftAgreement = await dataSource.query(
    `SELECT id FROM main.agreements
     WHERE tenant_id = $1 AND status = 'DRAFT'
     ORDER BY created_at ASC LIMIT 1`,
    [tenantId],
  );
  if (!draftAgreement || draftAgreement.length === 0) {
    throw new Error(
      'E2E fixture eksik: DRAFT agreement bulunamadı. `npm run seed` çalıştırın.',
    );
  }
  const draftAgreementId: string = draftAgreement[0].id;

  return {
    tenantId,
    adminUserId,
    approvedAgreementId,
    draftAgreementId,
    approvedAgreementCode,
    cplId,
  };
}

/**
 * E2E reversal testleri için agreement transaction'larını temizler.
 * `--runInBand` çalışımlarında test state birikimini önler.
 * Yalnızca test fixture transaction'larını siler (E2E-INV-* pattern).
 *
 * T-036 FIX (kök neden): önceki sorgu `ledger_entries.source_id`'nin
 * `agreement_transactions.id`'ye eşit olduğunu varsayıyordu — YANLIŞ.
 * `ledger-entry.entity.ts:32` ve `ledger.service.ts#createFromAgreementTransaction`
 * gösteriyor ki `source_id` = **agreement_id** (transaction id DEĞİL); asıl
 * transaction id `idempotency_key` içinde 4. segment olarak taşınır
 * (`LEDGER|AGREEMENT|{agreementId}|{transactionId}`). Bu yüzden eski
 * `source_id IN (SELECT id FROM agreement_transactions ...)` koşulu HİÇBİR
 * ZAMAN eşleşmiyordu ve DEBIT ledger satırları asla silinmiyordu — kısmi
 * tüketimli (reversal'sız) testlerde (örn. BR-E2E-02, role-journey C1-C5)
 * `consumed_amount` kalıcı olarak şişiyordu (bkz. T-036 task raporu, canlı
 * kanıt: temiz seed sonrası tek koşum → NKA-Q2 consumed=17000 kalıcı arttı).
 *
 * Doğru eşleştirme: idempotency_key'i TAM olarak yeniden inşa edip eşitlik
 * ile bul (üretim koduyla aynı format, ledger.service.ts:69/165/178) — bu,
 * orijinal DEBIT satırlarını kesin olarak bulur. REVERSAL CREDIT satırları
 * ise `reverses_entry_id` FK'sı (ledger.service.ts#createReversalEntry) ile
 * bulunur — string parse yerine güvenilir bir ilişki.
 */
export async function cleanupTestTransactions(
  app: INestApplication,
  agreementId: string,
): Promise<void> {
  const dataSource = app.get<DataSource>(getDataSourceToken());
  await dataSource.query(
    `WITH target_tx AS (
       SELECT id FROM main.agreement_transactions
       WHERE agreement_id = $1 AND invoice_no LIKE 'E2E-INV-%'
     ),
     orig_entries AS (
       SELECT le.id FROM main.ledger_entries le
       JOIN target_tx t
         ON le.idempotency_key = 'LEDGER|AGREEMENT|' || $1::text || '|' || t.id::text
       WHERE le.agreement_id = $1
     )
     DELETE FROM main.ledger_entries
     WHERE id IN (SELECT id FROM orig_entries)
        OR reverses_entry_id IN (SELECT id FROM orig_entries)`,
    [agreementId],
  );
  await dataSource.query(
    `DELETE FROM main.agreement_transactions
     WHERE agreement_id = $1 AND invoice_no LIKE 'E2E-INV-%'`,
    [agreementId],
  );
}

/**
 * E2E'nin ürettiği agreement'ları ve bunların bütçe/ledger/audit izlerini
 * TAMAMEN temizler (agreement'ın kendisi dahil).
 *
 * NEDEN GEREKLİ (T-036): `cleanupTestPlans`'ın agreement karşılığı. Bazı
 * e2e testleri (rol/senaryo kanıtı için) bir agreement'ı APPROVED'da
 * bırakır ve hiçbir zaman close/cancel etmez (örn.
 * role-journey.e2e-spec.ts C7-C9: reversal testi için ayrılan agreement —
 * amacı yalnızca off-invoice transaction + reversal akışını kanıtlamak,
 * agreement'ın kendi yaşam döngüsünü değil). Bu durumda RESERVE tx'i
 * kalıcı olarak `v_budget_summary.reserved_amount`'ı düşürür — envelope
 * her koşumda biraz daha tükenir (canlı kanıt: temiz seed sonrası tek
 * koşum → NKA-Q2 reserved_amount +20000 kalıcı arttı, hiç RELEASE yok).
 *
 * Kompanzasyon RELEASE satırı YAZILMAZ (ledger append-only, gerçek bir
 * bütçe hatasını sahte "iş" kaydıyla gizlememek için) — bunun yerine
 * `cleanupTestPlans` deseniyle birebir aynı şekilde testin ürettiği
 * SATIRLAR TAMAMEN SİLİNİR (agreement + tüm alt kayıtları). Yalnızca
 * `namePrefix` ile başlayan (varsayılan 'E2E-') agreement isimlerini
 * hedefler — seed verisi (`STA-2026-000x`) bu prefiksle eşleşmediğinden
 * dokunulmaz.
 */
export async function cleanupTestAgreements(
  app: INestApplication,
  tenantId: string,
  namePrefix: string = 'E2E-',
): Promise<void> {
  const dataSource = app.get<DataSource>(getDataSourceToken());

  const agreements = await dataSource.query(
    `SELECT id FROM main.agreements
      WHERE tenant_id = $1 AND agreement_name LIKE $2`,
    [tenantId, `${namePrefix}%`],
  );
  const agreementIds: string[] = agreements.map((a: { id: string }) => a.id);
  if (agreementIds.length === 0) {
    return;
  }

  // FK/bağımlılık sırası: ledger → budget_transactions → agreement_transactions
  // (FK main.agreements'a) → admin_audit_logs → agreements.
  await dataSource.query(
    `DELETE FROM main.ledger_entries WHERE agreement_id = ANY($1::uuid[])`,
    [agreementIds],
  );
  await dataSource.query(
    `DELETE FROM main.budget_transactions
      WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = ANY($2::uuid[])`,
    [tenantId, agreementIds],
  );
  await dataSource.query(
    `DELETE FROM main.agreement_transactions WHERE agreement_id = ANY($1::uuid[])`,
    [agreementIds],
  );
  await dataSource.query(
    `DELETE FROM main.admin_audit_logs
      WHERE entity_type = 'AGREEMENT' AND entity_id = ANY($1::uuid[])`,
    [agreementIds],
  );
  await dataSource.query(
    `DELETE FROM main.agreements WHERE id = ANY($1::uuid[])`,
    [agreementIds],
  );
}

/**
 * E2E sales-actuals testleri için oluşturulan batch/satır/audit fixture'larını
 * temizler. `--runInBand` tekrar koşumlarında ve dev DB'de state birikimini
 * önler.
 *
 * Kapsam: yalnızca test fixture'ları — `fiscalPeriod` LIKE '2027-%' olan
 * batch'ler (sales-actuals.e2e-spec.ts bilinçli olarak tüm senaryolarında
 * gerçek Wella verisiyle (2026-*) asla çakışmayacak 2027-* dönemlerini
 * kullanır; bu, `cleanupTestTransactions`'daki `E2E-INV-%` marker desenine
 * eşdeğer bir izolasyon stratejisidir). Silme sırası FK nedeniyle:
 * `sales_actuals` → `sales_actual_batches` → ilgili `admin_audit_logs`
 * (audit tablosunda FK yok ama mantıksal sıra korunur).
 *
 * NOT: Uygulama katmanının immutable audit/batch kuralını ihlal etmez —
 * bu doğrudan SQL yalnızca test ortamında, test helper'ından çağrılır
 * (tıpkı `cleanupTestTransactions`'ın ledger/agreement_transactions temizliği
 * gibi).
 */
export async function cleanupSalesActuals(
  app: INestApplication,
  tenantId: string,
  fiscalPeriodPrefix: string = '2027-',
): Promise<void> {
  const dataSource = app.get<DataSource>(getDataSourceToken());

  const batches = await dataSource.query(
    `SELECT id FROM main.sales_actual_batches
     WHERE tenant_id = $1 AND fiscal_period LIKE $2`,
    [tenantId, `${fiscalPeriodPrefix}%`],
  );
  const batchIds: string[] = batches.map((b: { id: string }) => b.id);
  if (batchIds.length === 0) {
    return;
  }

  await dataSource.query(
    `DELETE FROM main.sales_actuals
     WHERE tenant_id = $1 AND batch_id = ANY($2::uuid[])`,
    [tenantId, batchIds],
  );
  await dataSource.query(
    `DELETE FROM main.admin_audit_logs
     WHERE tenant_id = $1 AND entity_type = 'SalesActualBatch'
     AND entity_id = ANY($2::uuid[])`,
    [tenantId, batchIds],
  );
  await dataSource.query(
    `DELETE FROM main.sales_actual_batches
     WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, batchIds],
  );
}

/**
 * E2E'nin ürettiği planları ve bunların bütçe/audit izlerini temizler.
 *
 * NEDEN GEREKLİ: T-029'dan sonra onaylanan planlar bütçeyi doğru şekilde tutuyor
 * (COMMIT transaction). Ama BRD gereği yalnızca DRAFT plan API'den silinebiliyor —
 * yani e2e'nin ürettiği APPROVED planlar zarfı KALICI olarak tüketiyor. Birkaç koşum
 * sonra `ENV-2026-NKA-Q1` tükeniyor ve submit/approve testleri "Insufficient budget"
 * ile 400 alıyor (kod hatası değil, state birikimi).
 *
 * Bu temizlik uygulama katmanının immutability kuralını İHLAL ETMEZ: doğrudan SQL ile,
 * yalnızca test fixture'larını (`E2E-` önekli) siler — tıpkı `cleanupTestTransactions`ın
 * ledger/agreement_transactions temizlemesi gibi.
 */
export async function cleanupTestPlans(
  app: INestApplication,
  tenantId: string,
  namePrefix: string = 'E2E-',
): Promise<void> {
  const dataSource = app.get<DataSource>(getDataSourceToken());

  const plans = await dataSource.query(
    `SELECT id FROM main.plans
      WHERE tenant_id = $1 AND (plan_name LIKE $2 OR plan_code LIKE $2)`,
    [tenantId, `${namePrefix}%`],
  );
  const planIds: string[] = plans.map((p: { id: string }) => p.id);
  if (planIds.length === 0) {
    return;
  }

  // FK sırası: bütçe/audit izleri → plan alt kayıtları → plan
  await dataSource.query(
    `DELETE FROM main.budget_transactions
      WHERE tenant_id = $1 AND source_type = 'PLAN' AND source_id = ANY($2::uuid[])`,
    [tenantId, planIds],
  );
  await dataSource.query(
    `DELETE FROM main.plan_approval_history WHERE plan_id = ANY($1::uuid[])`,
    [planIds],
  );
  await dataSource.query(
    `DELETE FROM main.plan_mechanic_values
      WHERE plan_fu_id IN (SELECT id FROM main.plan_fus WHERE plan_id = ANY($1::uuid[]))`,
    [planIds],
  );
  await dataSource.query(
    `DELETE FROM main.plan_skus
      WHERE plan_fu_id IN (SELECT id FROM main.plan_fus WHERE plan_id = ANY($1::uuid[]))`,
    [planIds],
  );
  await dataSource.query(
    `DELETE FROM main.plan_fus WHERE plan_id = ANY($1::uuid[])`,
    [planIds],
  );
  await dataSource.query(`DELETE FROM main.plans WHERE id = ANY($1::uuid[])`, [
    planIds,
  ]);
}

/** Kod → id çözümlemesi; bulunamazsa anlaşılır hata (seed eksik demektir). */
export async function resolveIdByCode(
  app: INestApplication,
  tenantId: string,
  table: string,
  code: string,
): Promise<string> {
  const dataSource = app.get<DataSource>(getDataSourceToken());
  const rows = await dataSource.query(
    `SELECT id FROM main.${table} WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantId, code],
  );
  if (!rows?.[0]?.id) {
    throw new Error(
      `e2e fixture: main.${table} içinde code='${code}' bulunamadı — önce 'npm run seed' çalıştırın.`,
    );
  }
  return rows[0].id;
}

export interface CreateAgreementFixtureInput {
  tenantId: string;
  cplId: string;
  channelId: string;
  fuId: string;
  tacticId: string;
  mechanicId: string;
  capTotalAmount: number;
  namePrefix?: string; // default: 'E2E-BR'
  startDate?: string; // default: '2026-02-05'
  endDate?: string; // default: '2026-02-20'
  spendType?: 'ON_INVOICE' | 'OFF_INVOICE' | 'BOTH';
}

/**
 * T-030 e2e fixture'ları için: bir agreement'ı DRAFT → PENDING → APPROVED'a
 * taşır (create: ADMIN, submit: ADMIN, approve: FINANCE_MANAGER —
 * self-approval segregation-of-duties, bkz. role-journey.e2e-spec.ts C7).
 * Approve sonrası envelope'u da (RESERVE transaction'ından) döner.
 *
 * T-028e NOT: önceden approve 'MANAGER' (=CATEGORY_MANAGER alias,
 * manager@wella.com) ile yapılıyordu. AgreementService#approve artık CM
 * kategori-scope'unu zorunlu kılıyor (bkz. AgreementService#assertCmDecisionScope)
 * ve bu fixture çağrıları tenant'taki HERHANGİ bir FU'yu (dolayısıyla
 * herhangi bir kategoriyi) kullanabildiğinden, manager@wella.com'un sabit
 * scope'una (CAT-SAC-BOYASI/CAT-SET-BOYA) bağımlı kalmak kırılgan olurdu.
 * FINANCE_MANAGER kategori-scope'una tabi değildir (BRD: FM okuma+bütçe) ve
 * approve() route'u zaten @Roles(ADMIN, CATEGORY_MANAGER, FINANCE_MANAGER) —
 * bu yüzden fixture-genel (kategori-agnostik) bir onaylayıcı olarak doğru
 * seçim budur.
 */
export async function createAndApproveAgreement(
  app: INestApplication,
  input: CreateAgreementFixtureInput,
): Promise<{
  agreementId: string;
  envelopeId: string;
  capTotalAmount: number;
}> {
  const admin = await loginAs(app, 'ADMIN');
  const manager = await loginAs(app, 'FINANCE_MANAGER');

  const createRes = await request(app.getHttpServer())
    .post('/agreements')
    .set(admin.authHeader())
    .send({
      agreementName: `${input.namePrefix || 'E2E-BR'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agreementType: 'STA',
      cplId: input.cplId,
      channelId: input.channelId,
      fuId: input.fuId,
      tacticId: input.tacticId,
      mechanicId: input.mechanicId,
      skuScope: 'FU',
      capTotalAmount: input.capTotalAmount,
      spendType: input.spendType || 'OFF_INVOICE',
      startDate: input.startDate || '2026-02-05',
      endDate: input.endDate || '2026-02-20',
      justification: 'E2E T-030 budget release fixture',
    });
  if (createRes.status !== 201) {
    throw new Error(
      `createAndApproveAgreement: create başarısız ${createRes.status} ${JSON.stringify(createRes.body)}`,
    );
  }
  const agreementId: string = createRes.body.id;

  const submitRes = await request(app.getHttpServer())
    .post(`/agreements/${agreementId}/submit`)
    .set(admin.authHeader())
    .send({});
  if (submitRes.status !== 200) {
    throw new Error(
      `createAndApproveAgreement: submit başarısız ${submitRes.status} ${JSON.stringify(submitRes.body)}`,
    );
  }

  const approveRes = await request(app.getHttpServer())
    .post(`/agreements/${agreementId}/approve`)
    .set(manager.authHeader())
    .send({});
  if (approveRes.status !== 200) {
    throw new Error(
      `createAndApproveAgreement: approve başarısız ${approveRes.status} ${JSON.stringify(approveRes.body)}`,
    );
  }

  const dataSource = app.get<DataSource>(getDataSourceToken());
  const reserveTx = await dataSource.query(
    `SELECT envelope_id FROM main.budget_transactions
     WHERE tenant_id = $1 AND source_type = 'AGREEMENT' AND source_id = $2
       AND tx_type = 'RESERVE' AND tx_status = 'POSTED'
     ORDER BY created_at DESC LIMIT 1`,
    [input.tenantId, agreementId],
  );
  if (!reserveTx?.[0]?.envelope_id) {
    throw new Error(
      `createAndApproveAgreement: RESERVE transaction bulunamadı agreementId=${agreementId}`,
    );
  }

  return {
    agreementId,
    envelopeId: reserveTx[0].envelope_id,
    capTotalAmount: input.capTotalAmount,
  };
}

/**
 * Bir agreement'ı DRAFT → PENDING'e taşır (submit), APPROVE etmez.
 * Reject/no-op testleri için kullanılır.
 */
export async function createAndSubmitAgreement(
  app: INestApplication,
  input: CreateAgreementFixtureInput,
): Promise<string> {
  const admin = await loginAs(app, 'ADMIN');

  const createRes = await request(app.getHttpServer())
    .post('/agreements')
    .set(admin.authHeader())
    .send({
      agreementName: `${input.namePrefix || 'E2E-BR'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agreementType: 'STA',
      cplId: input.cplId,
      channelId: input.channelId,
      fuId: input.fuId,
      tacticId: input.tacticId,
      mechanicId: input.mechanicId,
      skuScope: 'FU',
      capTotalAmount: input.capTotalAmount,
      spendType: input.spendType || 'OFF_INVOICE',
      startDate: input.startDate || '2026-02-05',
      endDate: input.endDate || '2026-02-20',
      justification: 'E2E T-030 reject/no-op fixture',
    });
  if (createRes.status !== 201) {
    throw new Error(
      `createAndSubmitAgreement: create başarısız ${createRes.status} ${JSON.stringify(createRes.body)}`,
    );
  }
  const agreementId: string = createRes.body.id;

  const submitRes = await request(app.getHttpServer())
    .post(`/agreements/${agreementId}/submit`)
    .set(admin.authHeader())
    .send({});
  if (submitRes.status !== 200) {
    throw new Error(
      `createAndSubmitAgreement: submit başarısız ${submitRes.status} ${JSON.stringify(submitRes.body)}`,
    );
  }

  return agreementId;
}

/**
 * Reversal testi için yeni bir off-invoice transaction oluşturur.
 * Her test çağrısında benzersiz invoiceNo ile idempotent değil (bilinçli).
 */
export async function createOffInvoiceTransaction(
  app: INestApplication,
  agreementId: string,
  suffix: string = Date.now().toString(),
  amount: number = 5000,
): Promise<string> {
  const admin = await loginAs(app, 'ADMIN');

  const res = await request(app.getHttpServer())
    .post('/agreement-transactions')
    .set(admin.authHeader())
    .send({
      agreementId,
      invoiceNo: `E2E-INV-${suffix}`,
      invoiceDate: '2026-02-15',
      fiscalPeriod: '2026-02',
      amount,
      currency: 'TRY',
      notes: 'E2E test transaction',
    });

  if (res.status !== 201) {
    throw new Error(
      `Off-invoice transaction oluşturulamadı: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  return res.body.id;
}

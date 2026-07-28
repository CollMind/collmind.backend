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
 */
export async function cleanupTestTransactions(
  app: INestApplication,
  agreementId: string,
): Promise<void> {
  const dataSource = app.get<DataSource>(getDataSourceToken());
  await dataSource.query(
    `DELETE FROM main.ledger_entries
     WHERE agreement_id = $1
     AND idempotency_key LIKE 'LEDGER|AGREEMENT|%'
     AND source_id IN (
       SELECT id FROM main.agreement_transactions
       WHERE agreement_id = $1 AND invoice_no LIKE 'E2E-INV-%'
     )`,
    [agreementId],
  );
  await dataSource.query(
    `DELETE FROM main.agreement_transactions
     WHERE agreement_id = $1 AND invoice_no LIKE 'E2E-INV-%'`,
    [agreementId],
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
 * taşır (create: ADMIN, submit: ADMIN, approve: MANAGER — self-approval
 * segregation-of-duties, bkz. role-journey.e2e-spec.ts C7). Approve sonrası
 * envelope'u da (RESERVE transaction'ından) döner.
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
  const manager = await loginAs(app, 'MANAGER');

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

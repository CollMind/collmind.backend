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
 * Reversal testi için yeni bir off-invoice transaction oluşturur.
 * Her test çağrısında benzersiz invoiceNo ile idempotent değil (bilinçli).
 */
export async function createOffInvoiceTransaction(
  app: INestApplication,
  agreementId: string,
  suffix: string = Date.now().toString(),
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
      amount: 5000,
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

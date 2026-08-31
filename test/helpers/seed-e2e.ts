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
import { getAdminDataSource } from './admin-datasource';
// T-244/Z17: entity_type sabiti tek kaynaktan (m1 düzeltmesi öncesi
// burada bir string literal olarak kopyalanmıştı — DELETE'in kendisi
// yazıcıyla senkron kalmayı sabitin kendisine bağlı hale getiriyor).
import { SCOPE_AUDIT_ENTITY_TYPE } from '../../src/database/entities/user-scope.entity';

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
  //
  // T-037 FIX (kök neden): önceden burada, seed'in APPROVED agreement'ı
  // (STA-2026-0002) başka bir spec tarafından CLOSED edilmişse, durumu
  // doğrudan SQL ile `SET status = 'APPROVED', closed_at = NULL` yaparak
  // "diriltiyorduk". Bu, agreement'ı APPROVED'a geri döndürüyordu ama
  // close'un release ettiği bütçe rezervasyonunu GERİ KURMUYORDU — sonuç:
  // durumu APPROVED olan ama net rezervasyonu 0 olan bir agreement (BRD
  // "Approved bütçeden düşer" ihlali, yalnızca test fixture'ının ürettiği
  // bir durum, bkz. T-037 task raporu).
  //
  // Doğru çözüm: bu paylaşılan seed agreement'ını hiçbir spec artık MUTATE
  // ETMİYOR (kapatmıyor/tüketmiyor) — `settlement.e2e-spec.ts` ve
  // `reversal.e2e-spec.ts` artık `createAndApproveAgreement` ile kendi
  // izole agreement'larını yaratıyor (bkz. `settlement-budget-release.e2e-spec.ts`
  // deseni). Bu sayede STA-2026-0002 tüm koşumlar boyunca APPROVED ve tam
  // rezerve kalır; "diriltme" hack'ine hiç gerek kalmaz. Eğer bu hata
  // fırlatılırsa (APPROVED agreement bulunamadı), kök neden ya seed hiç
  // çalışmamıştır ya da bir spec bu paylaşılan agreement'ı hâlâ mutate
  // ediyordur — SQL ile durumu geri yazmak yerine ilgili spec'i izole
  // fixture'a taşı.
  const approvedAgreement = await dataSource.query(
    `SELECT id, agreement_code FROM main.agreements
     WHERE tenant_id = $1 AND status = 'APPROVED'
     ORDER BY created_at ASC LIMIT 1`,
    [tenantId],
  );
  if (!approvedAgreement || approvedAgreement.length === 0) {
    throw new Error(
      'E2E fixture eksik: APPROVED agreement bulunamadı. `npm run seed` çalıştırın; ' +
        "eğer seed çalıştıysa, bir spec paylaşılan STA-2026-0002 agreement'ını " +
        "mutate ediyor olabilir — izole fixture'a (createAndApproveAgreement) taşıyın.",
    );
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
 *
 * T-060 FIX (mutasyon kanıtı sırasında bulundu — bkz. task raporu): bu
 * fonksiyon `main.agreement_transactions` satırlarını `cleanupTestAgreements`
 * çağrılmadan ÖNCE (bazı testler bunu kendi `it()` bloğunun içinde/sonunda,
 * dosyanın `afterAll`'ından ÖNCE çağırıyor — örn. role-journey.e2e-spec.ts
 * C9, settlement-budget-release.e2e-spec.ts BR-E2E-06) hard-delete ediyordu.
 * `cleanupTestAgreements`'ın T-060'ta eklenen admin_audit_logs
 * (AGREEMENT_TRANSACTION) temizliği transaction id'lerini `agreement_
 * transactions`'tan SELECT ederek buluyor — ama bu fonksiyon onları çoktan
 * silmiş oluyordu, yani hiçbir zaman bulunamıyorlardı (transactionIds=[]).
 * Sonuç: reversal.service.ts'in yazdığı AGREEMENT_TRANSACTION audit satırı
 * öksüz kalıyordu. Aynı sınıf hata (FK'siz polimorfik referans, temizlik
 * kapsam dışı bıraktı) burada bir seviye daha erken tekrarlamıştı. Şimdi bu
 * fonksiyon da transaction id'lerini silmeden ÖNCE yakalayıp kendi
 * admin_audit_logs izlerini temizliyor.
 *
 * K-2.6.13 KARAR 1 (2026-08-16): `app_runtime`'ın `ledger_entries` /
 * `admin_audit_logs` / `agreement_transactions` üzerinde artık DELETE hakkı
 * YOK (kural: K-2.3.4/K-2.11.6/K-2.11.7/INV-L-003 — bu üç tablo bir
 * defter/denetim kaydıdır). Bu fonksiyon yalnızca bu üç tabloya dokunduğu
 * için TAMAMEN `app_migrate` bağlantısına (`getAdminDataSource()`) taşındı
 * — app'in kendi (app_runtime) DataSource'u artık burada KULLANILMIYOR.
 */
export async function cleanupTestTransactions(
  _app: INestApplication,
  agreementId: string,
): Promise<void> {
  const dataSource = await getAdminDataSource();

  const targetTx = await dataSource.query(
    `SELECT id FROM main.agreement_transactions
      WHERE agreement_id = $1 AND invoice_no LIKE 'E2E-INV-%'`,
    [agreementId],
  );
  const targetTxIds: string[] = targetTx.map((t: { id: string }) => t.id);

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
  if (targetTxIds.length > 0) {
    await dataSource.query(
      `DELETE FROM main.admin_audit_logs
        WHERE entity_type = 'AGREEMENT_TRANSACTION' AND entity_id = ANY($1::uuid[])`,
      [targetTxIds],
    );
  }
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
 *
 * T-060: `main.approval_requests` (entity_type='AGREEMENT') ve
 * `main.admin_audit_logs` (entity_type='AGREEMENT_TRANSACTION',
 * reversal.service.ts'in REVERSE audit satırı) da temizlenir. Her ikisi de
 * `entity_id` üzerinden POLİMORFİK referans tutar — main.agreements/
 * main.agreement_transactions'a FK YOKTUR (kasıtlı: approval_requests ve
 * admin_audit_logs birden çok entity tipini tek tabloda tutar). Bu
 * FK'sizlik, agreement/agreement_transaction hard-delete edildiğinde bu iki
 * tabloda kalıcı öksüz satır bırakıyordu (T-060 ölçümü: 9.116 satır
 * approval_requests'te, 3.167 satır admin_audit_logs'ta birikmişti — hepsi
 * %100 öksüzdü, canlı bir agreement/plan/transaction'a işaret eden TEK satır
 * yoktu). Kök neden `cleanupTestPlans`/`cleanupTestAgreements`'ın bu iki
 * tabloyu hiç kapsamamasıydı (FK cascade eksikliği + temizlik sorgusunun
 * kapsam dışı bırakması, ikisi birden).
 *
 * K-2.6.13 KARAR 1 (2026-08-16): bu fonksiyon `ledger_entries`/
 * `admin_audit_logs`/`agreement_transactions`'ı da sildiği için (ki
 * `app_runtime`'ın artık bu üç tabloda DELETE hakkı yok — bkz.
 * `cleanupTestTransactions`'ın JSDoc'u) TAMAMEN `app_migrate` bağlantısına
 * taşındı. `budget_transactions`/`approval_requests`/`agreements` hâlâ
 * `app_runtime`'da DELETE'e sahip olsa da, tek bir FK-sıralı zincir içinde
 * iki farklı bağlantı arasında geçiş yapmak yerine TÜMÜ aynı (app_migrate)
 * bağlantı üzerinden yürütülüyor — daha basit, ve app_migrate zaten bu
 * tabloların hepsinin SAHİBİ.
 */
export async function cleanupTestAgreements(
  _app: INestApplication,
  tenantId: string,
  namePrefix: string = 'E2E-',
): Promise<void> {
  const dataSource = await getAdminDataSource();

  const agreements = await dataSource.query(
    `SELECT id FROM main.agreements
      WHERE tenant_id = $1 AND agreement_name LIKE $2`,
    [tenantId, `${namePrefix}%`],
  );
  const agreementIds: string[] = agreements.map((a: { id: string }) => a.id);
  if (agreementIds.length === 0) {
    return;
  }

  // T-060: agreement_transactions hard-delete edilmeden ÖNCE id'lerini
  // yakala — reversal.service.ts bu id'lere işaret eden AGREEMENT_TRANSACTION
  // audit satırı yazmış olabilir, aşağıda agreement_transactions silinince
  // bu id'lere bir daha erişilemez (join imkansızlaşır).
  const transactions = await dataSource.query(
    `SELECT id FROM main.agreement_transactions WHERE agreement_id = ANY($1::uuid[])`,
    [agreementIds],
  );
  const transactionIds: string[] = transactions.map(
    (t: { id: string }) => t.id,
  );

  // FK/bağımlılık sırası: ledger → budget_transactions → approval_requests
  // (FK yok, polimorfik) → agreement_transaction audit izleri (FK yok,
  // polimorfik) → agreement_transactions (FK main.agreements'a) →
  // admin_audit_logs (AGREEMENT) → agreements.
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
    `DELETE FROM main.approval_requests
      WHERE tenant_id = $1 AND entity_type = 'AGREEMENT' AND entity_id = ANY($2::uuid[])`,
    [tenantId, agreementIds],
  );
  if (transactionIds.length > 0) {
    await dataSource.query(
      `DELETE FROM main.admin_audit_logs
        WHERE entity_type = 'AGREEMENT_TRANSACTION' AND entity_id = ANY($1::uuid[])`,
      [transactionIds],
    );
  }
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
 *
 * K-2.6.13 KARAR 1 (2026-08-16): `admin_audit_logs` DELETE'i içerdiği için
 * (bkz. `cleanupTestTransactions`'ın JSDoc'u) TAMAMEN `app_migrate`
 * bağlantısına taşındı.
 */
export async function cleanupSalesActuals(
  _app: INestApplication,
  tenantId: string,
  fiscalPeriodPrefix: string = '2027-',
): Promise<void> {
  const dataSource = await getAdminDataSource();

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
 *
 * T-060: `main.approval_requests` (entity_type='PLAN') de temizlenir —
 * plan.service.ts'nin submit/approve akışı her plan için bir approval_request
 * satırı yazıyor; bu tabloya `main.plans`'a FK YOKTUR (polimorfik entity_id).
 * Kök neden ve ölçüm için `cleanupTestAgreements`'ın JSDoc'una bakınız (aynı
 * sınıf hata, agreement tarafı).
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
    `DELETE FROM main.approval_requests
      WHERE tenant_id = $1 AND entity_type = 'PLAN' AND entity_id = ANY($2::uuid[])`,
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

/**
 * T-060: E2E'nin RBAC/scope teşhisi için `POST /users` ile oluşturduğu
 * tek-kullanımlık kullanıcıları hard-delete eder.
 *
 * NEDEN GEREKLİ: `DELETE /users` endpoint'i yok (BRD'de kullanıcı silme API'si
 * tanımlı değil) — role-journey.e2e-spec.ts'nin N9 testi (main.user_scopes
 * satırı olmayan PLANNER, fail-closed kanıtı) bu yüzden yalnızca deactivate
 * ediyordu, satır DB'de kalıcı birikti (ölçüldü: main.users'ın 289/298
 * satırı — %97'si — bu tek testten, INACTIVE ama fiziksel olarak hâlâ orada).
 *
 * `cleanupTestPlans`/`cleanupTestAgreements`'ın aksine burada `LIKE` örüntüsü
 * DEĞİL, çağıranın topladığı TAM id listesi kullanılır (T-051 dersi: örüntü
 * eşleştirme başka bir suite'in ürettiği, henüz temizlenmemiş bir satırı
 * yanlışlıkla silebilir — bu fonksiyon yalnızca kendi ürettiği kullanıcıları
 * bilir).
 */
export async function cleanupTestUsers(
  app: INestApplication,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  // T-244: `POST /users` şimdi kapsam verme SCOPE_UPDATE olarak
  // `admin_audit_logs`'a yazıyor (entity_type=SCOPE_AUDIT_ENTITY_TYPE
  // ('user', Z17/m1 — ÖNCEDEN 'user_scope'ydu, düzeltildi), entity_id=
  // <yaratılan kullanıcının id'si>). `main.user_scopes` satırları `users`'a
  // CASCADE FK ile bağlı olduğu için aşağıdaki DELETE onları otomatik
  // temizler — ama `admin_audit_logs.entity_id` polimorfik ve FK'siz
  // (`cleanupTestAgreements`'taki AGREEMENT_TRANSACTION deseninin aynısı):
  // kullanıcı silinince audit satırı orphan kalır ve T-047/T-060 satır-sayısı
  // invaryantını (test/helpers/e2e-row-count.js) kırar — ölçüldü, T-244
  // turunda `adminAuditLogs: 35 -> 42`.
  // `app_runtime`'ın `admin_audit_logs`'ta DELETE hakkı YOK (K-2.6.13 Karar
  // 1, cleanupTestAgreements'ın JSDoc'u) — bu yüzden `app_migrate`
  // (`getAdminDataSource()`) kullanılıyor, `main.users` DELETE'i ise
  // (aşağıda) `app_runtime` üzerinden kalıyor (mevcut, çalışan davranış).
  const adminDataSource = await getAdminDataSource();
  await adminDataSource.query(
    `DELETE FROM main.admin_audit_logs
      WHERE entity_type = $1 AND entity_id = ANY($2::uuid[])`,
    [SCOPE_AUDIT_ENTITY_TYPE, userIds],
  );

  const dataSource = app.get<DataSource>(getDataSourceToken());
  await dataSource.query(`DELETE FROM main.users WHERE id = ANY($1::uuid[])`, [
    userIds,
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

/**
 * [[T-293]] — LTA oran şartları için EBEVEYN yaşam döngüsü kaydı.
 *
 * `main.lta_agreements.agreement_id` `NOT NULL` (migration `1817000000000`,
 * `Z38 §3(a)`: *"oran kademesi ebeveyne BAĞLI DOĞAR"*), yani bir LTA
 * oran-şartları başlığı kurmak isteyen HER fixture önce bir
 * `agreements`(agreement_type='LTA') kaydı üretmelidir.
 *
 * ⚠️ Ad öneki `E2E-` — `cleanupTestAgreements` bu ön eke bakıyor.
 * ⚠️ LTA süre kuralı: `agreement.service.ts` `> 30 gün` şartı koyuyor.
 *
 * ── [[T-335]] — ESKİ ŞERH DÜŞTÜ (append-only iz, `F12` deseni) ──────────
 * Burada şu yazıyordu:
 *
 *   *"Kayıt `DRAFT` kalır; submit/approve akışı bu fixture'ın işi değil
 *   (LTA oran şartları yaşam döngüsü DURUMUNA değil, kaydın VARLIĞINA
 *   bağlı doğar — durum kapısı ayrı bir karar kalemidir, `T-293`
 *   raporu)."*
 *
 * ⛔ O cümlenin parantez içi bir KABULDÜ, bir kural değil — ve
 * `DISIPLIN`'in *"bilinen eksiklik TODO ile değil TASK ile kaydedilir"*
 * maddesinin ihlaliydi: ürünün en kritik finansal kapılarından biri bir
 * TEST YORUMUNDA yaşıyordu. `T-335` o kaydın kendisidir ve kabulü ölçtü:
 * `DRAFT` bir ebeveynin oran kademesi harcama motoruna GERÇEKTEN
 * iniyordu (e2e reprodüksiyon, `lta-parent-lifecycle-status-gate`).
 *
 * ⇒ `findActiveForCPL` artık ebeveynin `IN_FORCE_AGREEMENT_STATES`
 * (`{APPROVED, ACTIVE}`) içinde olmasını şart koşuyor. Bu yüzden bu
 * fixture, motoru besleyen testler için ebeveyni **`APPROVED`**'a taşır.
 *
 * @param lifecycleStatus  `'APPROVED'` (varsayılan) — oran kademesi motora
 *   inebilsin diye. `'DRAFT'` istendiğinde kayıt onaya HİÇ SUNULMAZ; yalnız
 *   durum kapısını SINAYAN testler bunu ister.
 *   ⚠️ `'APPROVED'` geçişi ADMIN `DataSource`'u ile DOĞRUDAN yazılır,
 *   `submit`+`approve` uçlarından DEĞİL. Sebep ölçüldü: `approve` bütçe
 *   rezervasyonu yapıyor ve zarflar yalnız `2026-01`/`2026-02` dönemleri
 *   için var — bu fixture'ın tarihleri ise BUGÜNden türüyor. Kısayol
 *   meşru çünkü bu fixture'ın konusu ONAY AKIŞI DEĞİL; onay akışının
 *   kapıyı GERÇEKTEN açtığı `lta-parent-lifecycle-status-gate.e2e-spec.ts`
 *   içinde ÜRETİM UÇLARIYLA (`submit`+`approve`, SoD'lu) kanıtlanıyor.
 */
export async function createLifecycleLtaAgreement(
  app: INestApplication,
  input: {
    cplId: string;
    channelId: string;
    fuId: string;
    tacticId: string;
    mechanicId: string;
    categoryId?: string;
    namePrefix?: string;
    startDate?: string;
    endDate?: string;
    lifecycleStatus?: 'DRAFT' | 'APPROVED';
  },
): Promise<string> {
  const admin = await loginAs(app, 'ADMIN');
  const res = await request(app.getHttpServer())
    .post('/agreements')
    .set(admin.authHeader())
    .send({
      agreementName: `${input.namePrefix || 'E2E-LTA-PARENT'}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`,
      agreementType: 'LTA',
      cplId: input.cplId,
      channelId: input.channelId,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      fuId: input.fuId,
      tacticId: input.tacticId,
      mechanicId: input.mechanicId,
      skuScope: 'FU',
      capTotalAmount: 100000,
      spendType: 'BOTH',
      startDate: input.startDate || isoOffsetDays(0),
      endDate: input.endDate || isoOffsetDays(90),
      justification: 'E2E T-293 — LTA yaşam döngüsü ebeveyni',
    });
  if (res.status !== 201) {
    throw new Error(
      `createLifecycleLtaAgreement başarısız (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  const lifecycleId: string = res.body.id;

  // [[T-335]] — durum kapısı. Varsayılan `APPROVED` (yukarıdaki şerh).
  const targetStatus = input.lifecycleStatus ?? 'APPROVED';
  if (targetStatus === 'APPROVED') {
    const adminDs = await getAdminDataSource();
    await adminDs.query(
      `UPDATE main.agreements SET status = 'APPROVED'
        WHERE id = $1 AND status = 'DRAFT'`,
      [lifecycleId],
    );
    // ⚠️ Yazma BAĞIMSIZ BİR OKUMAYLA doğrulanır, `query()`'nin dönüş
    // değeriyle DEĞİL (`DISIPLIN`: *"bir yazma işleminin dönüş değeri,
    // yazdığının kanıtı değildir"*). Ve bu bir tercih değil bir DERS:
    // ilk yazımı `RETURNING id` + `updated.length === 1` idi ve DÜŞTÜ —
    // node-pg/TypeORM `UPDATE ... RETURNING`'i `[rows, rowCount]` TUPLE'ı
    // olarak döndürüyor, yani `length` HER ZAMAN `2`. Doğru görünen,
    // sürücü şekline bağlı ve YANLIŞ bir ölçümdü.
    const check = await adminDs.query(
      `SELECT status FROM main.agreements WHERE id = $1`,
      [lifecycleId],
    );
    if (check.length !== 1 || check[0].status !== 'APPROVED') {
      throw new Error(
        `createLifecycleLtaAgreement: ebeveyn ${lifecycleId} APPROVED'a ` +
          `taşınamadı (okunan: ${JSON.stringify(check)}).`,
      );
    }
  }

  return lifecycleId;
}

/** `YYYY-MM-DD`, bugünden `days` gün sonrası (yerel takvim). */
export function isoOffsetDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

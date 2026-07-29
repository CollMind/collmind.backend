import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-030 — Kirli veri backfill: agreement bütçe rezerv sızıntısı.
 *
 * Bağlam (docs/analysis/0003-agreement-reservation-lifecycle.md §5):
 * approve() → RESERVE yazıyordu ama hiçbir terminal geçiş (özellikle CLOSE)
 * rezervi RELEASE etmiyordu (F1). staging/prod'da CLOSED/CANCELLED/REJECTED
 * agreement'lar zarfı sonsuza dek tutuyordu. Uygulama kodu T-030'da fix'lendi
 * (BudgetReservationService.releaseAgreementReservation, artık her terminal
 * geçişte çağrılıyor) — bu migration SADECE bu fix'ten ÖNCE terminal duruma
 * girmiş, hâlâ "sızdıran" mevcut satırları temizler.
 *
 * Yöntem: her (agreement, envelope) çifti için net = Σ(RESERVE+COMMIT) − ΣRELEASE
 * hesaplanır (v_budget_summary'nin reserved_amount formülüyle BİREBİR AYNI,
 * migration 1789). net > 0 olan çiftler için TEK bir RELEASE transaction'ı
 * yazılır — idempotency key uygulama koduyla birebir aynı format:
 * `RELEASE|AGREEMENT|<agreementId>|<envelopeId>` (ON CONFLICT DO NOTHING ile
 * tekrar çalıştırılabilir, ve uygulama kodunun kendisi de aynı key'i kullandığı
 * için gelecekte çakışma/çift-release riski yok).
 *
 * `main.agreements` JOIN'i sayesinde `source_id` bir agreement id'si OLMAYAN
 * satırlar (örn. REVERSAL|AGREEMENT|<transactionId> — F6, sourceId semantiği
 * karışık ölü kod) doğal olarak elenir; bunlar zaten join'de eşleşmez.
 *
 * Kapsam: yalnızca terminal state'teki agreement'lar (CLOSED, CANCELLED,
 * REJECTED) — bunlar bir daha bütçe rezervi tüketmeyecek durumlar, dolayısıyla
 * net'in kalıcı olarak sıfırlanması güvenlidir. APPROVED/ACTIVE agreement'lara
 * DOKUNULMAZ (hâlâ meşru şekilde rezerve tutuyorlar).
 *
 * Doğrulama (migration sonrası, manuel):
 *   SELECT a.status, SUM(net) FROM ( ... aynı net hesabı ... ) GROUP BY status;
 *   → CLOSED/CANCELLED/REJECTED için SUM(net) = 0 olmalı.
 */
export class BackfillAgreementBudgetReservationLeaks1790000000000 implements MigrationInterface {
  name = 'BackfillAgreementBudgetReservationLeaks1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO main.budget_transactions (
        id, tenant_id, envelope_id, tx_type, tx_status,
        source_type, source_id, amount, currency,
        idempotency_key, description, created_by, created_at, updated_at
      )
      SELECT
        uuid_generate_v4(),
        net.tenant_id,
        net.envelope_id,
        'RELEASE',
        'POSTED',
        'AGREEMENT',
        net.agreement_id,
        net.net_amount,
        net.currency,
        'RELEASE|AGREEMENT|' || net.agreement_id || '|' || net.envelope_id,
        'T-030 backfill: net reservation release for terminal-state agreement ' || net.agreement_id || ' (status=' || net.status || ')',
        NULL,
        now(),
        now()
      FROM (
        SELECT
          a.id AS agreement_id,
          a.tenant_id AS tenant_id,
          a.status AS status,
          bt.envelope_id AS envelope_id,
          MAX(bt.currency) AS currency,
          SUM(CASE WHEN bt.tx_type IN ('RESERVE', 'COMMIT') THEN bt.amount ELSE 0 END)
            - SUM(CASE WHEN bt.tx_type = 'RELEASE' THEN bt.amount ELSE 0 END) AS net_amount
        FROM main.agreements a
        JOIN main.budget_transactions bt
          ON bt.source_type = 'AGREEMENT'
         AND bt.source_id = a.id
         AND bt.tx_status = 'POSTED'
         AND bt.deleted_at IS NULL
        WHERE a.status IN ('CLOSED', 'CANCELLED', 'REJECTED')
          AND a.deleted_at IS NULL
        GROUP BY a.id, a.tenant_id, a.status, bt.envelope_id
      ) net
      WHERE net.net_amount > 0
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM main.budget_transactions
      WHERE description LIKE 'T-030 backfill:%';
    `);
  }
}

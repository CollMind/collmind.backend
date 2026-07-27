import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-028a — Rol konsolidasyonu: BRD'nin 4 canonical rolüne (ADMIN, PLANNER,
 * CATEGORY_MANAGER, FINANCE_MANAGER) + READONLY (operasyonel) taşınır.
 *
 * MANAGER, FINANCE, APPROVER artık DEPRECATED alias'lardır — koddan
 * kullanılmaz (bkz. user.entity.ts @deprecated JSDoc + ESLint
 * no-restricted-syntax kuralı) ama PostgreSQL enum'undan değer SİLİNEMEDİĞİ
 * için (bkz. migration 1775) enum tipinde kalırlar; yalnızca veri taşınır.
 *
 * Eşleme yönü (docs/analysis/0004-rbac-brd-alignment.md §2 — Seçenek C):
 *   MANAGER  → CATEGORY_MANAGER  (MANAGER bugün fiilen plan/agreement onaylıyor)
 *   APPROVER → CATEGORY_MANAGER  (APPROVER zaten MANAGER'ın önceki adı, migration 1775)
 *   FINANCE  → FINANCE_MANAGER   (FINANCE bugün budget+raporlama sahibi)
 *
 * Not: architect notu "1790" demişti ama 1790 T-030 backfill migration'ı
 * tarafından kullanıldı → bu migration 1791+ numarasını kullanır.
 */
export class ConsolidateRolesToBrd1791000000000 implements MigrationInterface {
  name = 'ConsolidateRolesToBrd1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'CATEGORY_MANAGER'
      WHERE role IN ('MANAGER', 'APPROVER');
    `);

    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'FINANCE_MANAGER'
      WHERE role = 'FINANCE';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // T-028a öncesi durum tam olarak geri getirilemez (MANAGER vs APPROVER
    // ayrımı kaybolmuştur — ikisi de CATEGORY_MANAGER'a taşınmıştı). Bilinen/
    // güvenli geri alma: FINANCE_MANAGER → FINANCE, CATEGORY_MANAGER → MANAGER
    // (migration 1775 sonrası zaten APPROVER kullanılmıyordu; bu nedenle
    // down() APPROVER'ı değil MANAGER'ı hedefler — 1775'in down() pattern'iyle
    // simetrik).
    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'FINANCE'
      WHERE role = 'FINANCE_MANAGER';
    `);

    await queryRunner.query(`
      UPDATE "main"."users"
      SET role = 'MANAGER'
      WHERE role = 'CATEGORY_MANAGER';
    `);

    console.warn(
      '⚠️  down() complete: FINANCE_MANAGER → FINANCE, CATEGORY_MANAGER → MANAGER. ' +
        'Bu geri alma yaklaşıktır: T-028a öncesi CATEGORY_MANAGER kullanıcıları ' +
        '(örn. category.manager@wella.com seed satırı) da MANAGER olur; ' +
        'seed öncesi orijinal MANAGER/CATEGORY_MANAGER ayrımı kurtarılamaz.',
    );
  }
}

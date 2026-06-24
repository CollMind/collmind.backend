import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Settlement desteği: agreements tablosuna closed_at ve closed_by sütunları eklenir.
 *
 * Bu migration yalnızca state geçiş meta-verisi için sütun ekler.
 * CLOSED state'e geçişte budget/ledger'a YAZILMAZ —
 * budget zaten transaction girilirken (ledger DEBIT) düşmüştür.
 * Çift-sayım riski: bu migration yok saymaz; bkz. SettlementCloseService.
 *
 * transaction = false: sütun ekleme DDL'leri transaction-safe olduğu için
 * varsayılan (true) bırakılabilirdi fakat reversal migration'ı ile tutarlılık için false.
 */
export class AddSettlementFieldsToAgreements1778000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // closed_at: CLOSED state geçiş zamanı
    await queryRunner.query(`
      ALTER TABLE "main"."agreements"
        ADD COLUMN IF NOT EXISTS "closed_at" timestamp NULL;
    `);

    // closed_by: CLOSED state geçişini yapan kullanıcının UUID'si
    await queryRunner.query(`
      ALTER TABLE "main"."agreements"
        ADD COLUMN IF NOT EXISTS "closed_by" uuid NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "main"."agreements"
        DROP COLUMN IF EXISTS "closed_by";
    `);
    await queryRunner.query(`
      ALTER TABLE "main"."agreements"
        DROP COLUMN IF EXISTS "closed_at";
    `);
  }
}

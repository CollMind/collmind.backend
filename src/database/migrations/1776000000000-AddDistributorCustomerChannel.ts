import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer.channel enum'una DISTRIBUTOR değerini ekler.
 * Channel master-data'sına eklenen DISTRIBUTOR kanalıyla hizalıdır
 * (kaynak: Wella Customer.xlsx — "Distribütör" kanalı).
 */
export class AddDistributorCustomerChannel1776000000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum değerini transaction dışında ekle ki anında commit'lensin
    await queryRunner.query(`
      ALTER TYPE "main"."customers_channel_enum" ADD VALUE IF NOT EXISTS 'DISTRIBUTOR';
    `);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // NOTE: PostgreSQL enum değeri kaldırmayı desteklemez.
    // DISTRIBUTOR değeri rollback sonrası enum'da kalır — beklenen davranış.
    console.warn(
      '⚠️  down() no-op: PostgreSQL enum değeri kaldıramaz; ' +
        "'DISTRIBUTOR' customers_channel_enum içinde kalır.",
    );
  }
}

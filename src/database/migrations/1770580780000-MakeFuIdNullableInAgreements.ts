import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class MakeFuIdNullableInAgreements1770580780000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, drop the existing foreign key constraint if it exists
    const table = await queryRunner.getTable('main.agreements');
    if (table) {
      const foreignKey = table.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('fu_id') !== -1,
      );

      if (foreignKey) {
        await queryRunner.dropForeignKey('main.agreements', foreignKey);
      }
    }

    // Make fu_id nullable in agreements table
    await queryRunner.changeColumn(
      'main.agreements',
      'fu_id',
      new TableColumn({
        name: 'fu_id',
        type: 'uuid',
        isNullable: true,
      }),
    );

    // Recreate foreign key with SET NULL on delete (allows NULL values)
    const fuTableExists = await queryRunner.hasTable('main.forecasting_units');
    if (fuTableExists) {
      // Check if constraint already exists
      const constraintExists = await queryRunner.query(`
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'FK_agreements_fu_id' 
        AND conrelid = 'main.agreements'::regclass;
      `);

      if (constraintExists.length === 0) {
        await queryRunner.query(`
          ALTER TABLE main.agreements
          ADD CONSTRAINT "FK_agreements_fu_id"
          FOREIGN KEY (fu_id)
          REFERENCES main.forecasting_units(id)
          ON DELETE SET NULL
          ON UPDATE CASCADE;
        `);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // First, set all NULL fu_id values to a default (if needed)
    // This is a safety check - in production, you might want to handle this differently
    await queryRunner.query(`
      UPDATE main.agreements
      SET fu_id = NULL
      WHERE fu_id IS NULL;
    `);

    // Drop the foreign key
    const table = await queryRunner.getTable('main.agreements');
    const foreignKey = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('fu_id') !== -1,
    );

    if (foreignKey) {
      await queryRunner.dropForeignKey('main.agreements', foreignKey);
    }

    // Make fu_id NOT NULL again
    await queryRunner.changeColumn(
      'main.agreements',
      'fu_id',
      new TableColumn({
        name: 'fu_id',
        type: 'uuid',
        isNullable: false,
      }),
    );

    // Recreate foreign key with RESTRICT on delete
    const fuTableExists = await queryRunner.hasTable('main.forecasting_units');
    if (fuTableExists) {
      await queryRunner.query(`
        ALTER TABLE main.agreements
        ADD CONSTRAINT "FK_agreements_fu_id"
        FOREIGN KEY (fu_id)
        REFERENCES main.forecasting_units(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
      `);
    }
  }
}

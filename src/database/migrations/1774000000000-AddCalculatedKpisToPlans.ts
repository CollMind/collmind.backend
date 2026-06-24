import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

export class AddCalculatedKpisToPlans1774000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add calculated_kpis column to plan_skus table
    await queryRunner.addColumn(
      'main.plan_skus',
      new TableColumn({
        name: 'calculated_kpis',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    // Add calculated_kpis column to plan_fus table
    await queryRunner.addColumn(
      'main.plan_fus',
      new TableColumn({
        name: 'calculated_kpis',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    // Create GIN index on plan_skus.calculated_kpis for fast JSONB queries
    // Note: TypeORM TableIndex doesn't support USING GIN syntax directly,
    // so we use raw SQL for JSONB GIN indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_plan_skus_calculated_kpis" 
      ON "main"."plan_skus" 
      USING GIN ("calculated_kpis")
    `);

    // Create GIN index on plan_fus.calculated_kpis for fast JSONB queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_plan_fus_calculated_kpis" 
      ON "main"."plan_fus" 
      USING GIN ("calculated_kpis")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first (using raw SQL since they're GIN indexes)
    await queryRunner.query(`
      DROP INDEX IF EXISTS "main"."IDX_plan_skus_calculated_kpis"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "main"."IDX_plan_fus_calculated_kpis"
    `);

    // Drop columns
    await queryRunner.dropColumn('main.plan_skus', 'calculated_kpis');
    await queryRunner.dropColumn('main.plan_fus', 'calculated_kpis');
  }
}

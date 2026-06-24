import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAdditionalParamsToAgreements1770568724090 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'main.agreements',
      new TableColumn({
        name: 'additional_params',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'main.agreements',
      new TableColumn({
        name: 'kpi_results',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('main.agreements', 'kpi_results');
    await queryRunner.dropColumn('main.agreements', 'additional_params');
  }
}

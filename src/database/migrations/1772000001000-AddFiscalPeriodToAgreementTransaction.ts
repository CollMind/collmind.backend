import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddFiscalPeriodToAgreementTransaction1772000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'main.agreement_transactions',
      new TableColumn({
        name: 'fiscal_period',
        type: 'varchar',
        length: '7',
        isNullable: true,
        comment: 'Fiscal period in YYYY-MM format, used for budget deduction',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn(
      'main.agreement_transactions',
      'fiscal_period',
    );
  }
}

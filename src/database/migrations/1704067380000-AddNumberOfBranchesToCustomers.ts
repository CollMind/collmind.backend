import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddNumberOfBranchesToCustomers1704067380000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'main.customers',
      new TableColumn({
        name: 'number_of_branches',
        type: 'int',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('main.customers', 'number_of_branches');
  }
}




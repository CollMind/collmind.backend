import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelCategoryToBudgetEnvelope1707400000000 implements MigrationInterface {
  name = 'AddChannelCategoryToBudgetEnvelope1707400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns
    await queryRunner.query(`
      ALTER TABLE main.budget_envelopes 
      ADD COLUMN IF NOT EXISTS channel VARCHAR(50),
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS channel_id UUID,
      ADD COLUMN IF NOT EXISTS category_id UUID
    `);

    // Create indexes for dimension-based lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_envelopes_channel_period 
      ON main.budget_envelopes(tenant_id, channel, period)
      WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_envelopes_category 
      ON main.budget_envelopes(tenant_id, category)
      WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_envelopes_channel_category_period 
      ON main.budget_envelopes(tenant_id, channel, category, period)
      WHERE deleted_at IS NULL
    `);

    // Migrate existing data from metadata to new columns
    await queryRunner.query(`
      UPDATE main.budget_envelopes 
      SET 
        channel = metadata->>'channel',
        category = metadata->>'category'
      WHERE metadata IS NOT NULL 
        AND (metadata->>'channel' IS NOT NULL OR metadata->>'category' IS NOT NULL)
        AND (channel IS NULL AND category IS NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS main.idx_budget_envelopes_channel_period
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS main.idx_budget_envelopes_category
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS main.idx_budget_envelopes_channel_category_period
    `);
    await queryRunner.query(`
      ALTER TABLE main.budget_envelopes 
      DROP COLUMN IF EXISTS channel,
      DROP COLUMN IF EXISTS category,
      DROP COLUMN IF EXISTS channel_id,
      DROP COLUMN IF EXISTS category_id
    `);
  }
}

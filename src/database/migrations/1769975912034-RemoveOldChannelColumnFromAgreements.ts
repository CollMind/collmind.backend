import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveOldChannelColumnFromAgreements1769975912034 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop old channel column if it exists (after channel_id is added and foreign key is created)
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'main' 
          AND table_name = 'agreements' 
          AND column_name = 'channel'
          AND column_name != 'channel_id'
        ) THEN
          -- First, make it nullable to avoid constraint issues
          ALTER TABLE "main"."agreements"
          ALTER COLUMN "channel" DROP NOT NULL;
          
          -- Then drop the column
          ALTER TABLE "main"."agreements"
          DROP COLUMN "channel";
          
          RAISE NOTICE 'Dropped old channel column from agreements table';
        ELSE
          RAISE NOTICE 'Old channel column does not exist, skipping';
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add old channel column if it was dropped
    await queryRunner.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'main' 
          AND table_name = 'agreements' 
          AND column_name = 'channel'
        ) THEN
          ALTER TABLE "main"."agreements"
          ADD COLUMN "channel" varchar(30) NOT NULL DEFAULT '';
          
          RAISE NOTICE 'Re-added old channel column to agreements table';
        ELSE
          RAISE NOTICE 'Old channel column already exists, skipping';
        END IF;
      END $$;
    `);
  }
}

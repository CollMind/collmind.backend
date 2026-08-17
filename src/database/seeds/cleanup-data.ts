import { DataSource } from 'typeorm';
import { SnakeCaseNamingStrategy } from '../strategies/snake-case-naming.strategy';
import { config } from 'dotenv';
import { migrateDbCredentials } from '../../config/db-role-env';

config();

/**
 * Cleanup script to delete all data from:
 * - Agreements and related tables
 * - Budget tables
 * - Plans and related tables
 */
export async function cleanupAgreementsBudgetPlans(
  dataSource: DataSource,
): Promise<void> {
  console.log('🧹 Starting cleanup of Agreements, Budget, and Plans data...\n');

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    // Start transaction
    await queryRunner.startTransaction();

    // Delete in order (respecting foreign key constraints)

    // 1. Plan related tables (delete in reverse dependency order)
    console.log('📋 Cleaning up Plan related tables...');
    await queryRunner.query(`DELETE FROM main.plan_approval_history`);
    console.log('   ✅ Deleted plan_approval_history');

    await queryRunner.query(`DELETE FROM main.plan_mechanic_values`);
    console.log('   ✅ Deleted plan_mechanic_values');

    await queryRunner.query(`DELETE FROM main.plan_skus`);
    console.log('   ✅ Deleted plan_skus');

    await queryRunner.query(`DELETE FROM main.plan_fus`);
    console.log('   ✅ Deleted plan_fus');

    await queryRunner.query(`DELETE FROM main.lta_plan_overrides`);
    console.log('   ✅ Deleted lta_plan_overrides');

    await queryRunner.query(`DELETE FROM main.plans`);
    console.log('   ✅ Deleted plans');

    // 2. Agreement related tables
    console.log('\n📄 Cleaning up Agreement related tables...');
    await queryRunner.query(`DELETE FROM main.agreement_transactions`);
    console.log('   ✅ Deleted agreement_transactions');

    await queryRunner.query(`DELETE FROM main.agreements`);
    console.log('   ✅ Deleted agreements');

    await queryRunner.query(`DELETE FROM main.lta_agreements`);
    console.log('   ✅ Deleted lta_agreements');

    // 3. Budget related tables (delete in reverse dependency order)
    console.log('\n💰 Cleaning up Budget related tables...');
    await queryRunner.query(`DELETE FROM main.budget_transaction_logs`);
    console.log('   ✅ Deleted budget_transaction_logs');

    // T-225: `main.budget_reservations` düşürüldü (migration
    // 1805000000000-DropBudgetReservations) — ölü iskeleydi, hiç yazılmamıştı.
    // Bu DELETE satırı KASITLI olarak kaldırıldı; tablo artık yok, kalsaydı
    // `42P01 relation does not exist` ile patlardı.

    await queryRunner.query(`DELETE FROM main.budget_allocations`);
    console.log('   ✅ Deleted budget_allocations');

    await queryRunner.query(`DELETE FROM main.budget_transactions`);
    console.log('   ✅ Deleted budget_transactions');

    await queryRunner.query(`DELETE FROM main.budget_alert_configurations`);
    console.log('   ✅ Deleted budget_alert_configurations');

    await queryRunner.query(`DELETE FROM main.budget_envelopes`);
    console.log('   ✅ Deleted budget_envelopes');

    // 3b. Sales actuals (T-020) — FK: sales_actual_batches → categories/cpls/channels.
    // Kategorilerden ÖNCE silinmeli; satırlar → batch'ler sırası FK gereği.
    console.log('\n📦 Cleaning up Sales Actuals (T-020)...');
    await queryRunner.query(`DELETE FROM main.sales_actuals`);
    console.log('   ✅ Deleted sales_actuals');

    await queryRunner.query(`DELETE FROM main.sales_actual_batches`);
    console.log('   ✅ Deleted sales_actual_batches');

    // 4. Master data tables used by agreements (delete in reverse dependency order)
    console.log('\n📦 Cleaning up Master Data tables used by Agreements...');
    await queryRunner.query(`DELETE FROM main.mechanics`);
    console.log('   ✅ Deleted mechanics');

    await queryRunner.query(`DELETE FROM main.tactics`);
    console.log('   ✅ Deleted tactics');

    await queryRunner.query(`DELETE FROM main.skus`);
    console.log('   ✅ Deleted skus');

    await queryRunner.query(`DELETE FROM main.forecasting_units`);
    console.log('   ✅ Deleted forecasting_units');

    await queryRunner.query(`DELETE FROM main.generic_units`);
    console.log('   ✅ Deleted generic_units');

    // T-237: main.user_scopes.category_id artık FK taşıyor (ON DELETE
    // RESTRICT, migration 1808000000000) — bu script AŞAĞIDA main.categories'i
    // TAMAMEN siliyor, ve bu satır olmadan `DELETE FROM main.categories`
    // ilk category-scope'lu satırda RESTRICT ile PATLAR (önceden sessizce
    // ÖKSÜZ SATIR biriktiriyordu — T-235 ölçümünün 115/148 bulduğu kaynak
    // tam olarak buydu). cpl-scope'lu ve wildcard (category_id NULL) satırlar
    // dokunulmadan kalır — yalnız kategoriye bağlı satırlar siliniyor,
    // çünkü yalnız onlar main.categories'e bağımlı.
    await queryRunner.query(
      `DELETE FROM main.user_scopes WHERE category_id IS NOT NULL`,
    );
    console.log('   ✅ Deleted category-scoped user_scopes rows (T-237)');

    await queryRunner.query(`DELETE FROM main.categories`);
    console.log('   ✅ Deleted categories');

    await queryRunner.query(`DELETE FROM main.brands`);
    console.log('   ✅ Deleted brands');

    // Commit transaction
    await queryRunner.commitTransaction();
    console.log('\n✅ Cleanup completed successfully!\n');
  } catch (error) {
    // Rollback transaction on error
    await queryRunner.rollbackTransaction();
    console.error('❌ Cleanup failed:', error);
    throw error;
  } finally {
    await queryRunner.release();
  }
}

// Standalone execution
async function bootstrap() {
  // K-2.6.13a/d (S2): seed bir kurulum işlemidir, runtime işlemi değil —
  // `app_migrate` ile koşar. Eksik kimlik sessizce 'postgres'e düşmez.
  const { username, password } = migrateDbCredentials();
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username,
    password,
    database: process.env.DB_DATABASE || 'collmind_tpm',
    schema: process.env.DB_SCHEMA || 'main',
    entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
    synchronize: false,
    // T-035: uygulama DataSource'u ile AYNI strateji olmak zorunda.
    namingStrategy: new SnakeCaseNamingStrategy(),
  });

  let exitCode = 0;
  try {
    await dataSource.initialize();
    console.log('📦 Database connected\n');
    await cleanupAgreementsBudgetPlans(dataSource);
  } catch (error) {
    console.error('❌ Error:', error);
    exitCode = 1;
  } finally {
    try {
      if (dataSource && dataSource.isInitialized) {
        await dataSource.destroy();
        console.log('📦 Database connection closed');
      }
    } catch (cleanupError) {
      console.error('⚠️  Error during cleanup:', cleanupError);
    }
    process.exit(exitCode);
  }
}

if (require.main === module) {
  bootstrap();
}

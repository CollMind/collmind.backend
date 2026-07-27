import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { cleanupAgreementsBudgetPlans } from './cleanup-data';
import { seedTenants } from './tenant.seed';
import { seedUsers } from './user.seed';
import { seedChannels } from './channel.seed';
import { seedCustomers } from './customer.seed';
import { seedCpls } from './cpl.seed';
import { seedBudgetEnvelopes } from './budget-envelope.seed';
import { seedMechanics } from './mechanic.seed';
import { seedProducts } from './product.seed';
import { seedAgreements } from './agreement.seed';
import { seedBudgetTransactions } from './budget-transaction.seed';
import { seedKpis } from './kpi.seed';

config();

/**
 * Main script to:
 * 1. Cleanup all agreements, budget, and plans data
 * 2. Seed new data with @wella.com users for all roles
 */
export async function cleanupAndSeed(dataSource: DataSource): Promise<void> {
  console.log('🚀 Starting cleanup and seed process...\n');

  // Step 1: Cleanup existing data
  await cleanupAgreementsBudgetPlans(dataSource);

  // Step 2: Seed new data
  console.log('🌱 Starting seed process...\n');

  // 1. Seed tenants
  const tenants = await seedTenants(dataSource);
  if (!tenants || tenants.length === 0) {
    throw new Error('❌ No tenants were seeded. Cannot continue.');
  }
  const tenant = tenants[0];
  console.log(`   Tenant: ${tenant.name} (${tenant.id})\n`);

  // 2. Seed users (all roles including FINANCE_MANAGER and CATEGORY_MANAGER)
  const users = await seedUsers(dataSource, tenant.id);
  if (!users || users.length === 0) {
    throw new Error('❌ No users were seeded. Cannot continue.');
  }
  console.log(`   ✅ Seeded ${users.length} users with all roles:`);
  users.forEach((user) => {
    console.log(`      - ${user.email} (${user.role})`);
  });
  console.log();

  const adminUser = users.find((u) => u.role === 'ADMIN') || users[0];
  const plannerUser = users.find((u) => u.role === 'PLANNER') || users[0];
  const financeManagerUser =
    users.find((u) => u.role === 'FINANCE_MANAGER') || users[0];
  const categoryManagerUser =
    users.find((u) => u.role === 'CATEGORY_MANAGER') || users[0];

  if (!adminUser) {
    throw new Error('❌ No admin user found. Cannot continue.');
  }
  if (!plannerUser) {
    throw new Error('❌ No planner user found. Cannot continue.');
  }

  // 3. Seed channels (required for CPLs and agreements)
  const channels = await seedChannels(dataSource, tenant.id, adminUser.id);
  if (!channels || channels.length === 0) {
    throw new Error('❌ No channels were seeded. Cannot continue.');
  }
  const nkaChannel = channels.find((c) => c.code === 'NKA');
  if (!nkaChannel) {
    throw new Error('❌ NKA channel not found after seeding.');
  }
  console.log(`   NKA Channel: ${nkaChannel.name} (${nkaChannel.id})\n`);

  // 4. Seed CPLs (required for agreements)
  const cpls = await seedCpls(dataSource, tenant.id, channels, adminUser.id);
  if (!cpls || cpls.length === 0) {
    throw new Error('❌ No CPLs were seeded. Cannot continue.');
  }
  const cpl = cpls[0];
  console.log(`   CPL: ${cpl.name} (${cpl.id})\n`);

  // 5. Seed customers (her CPL için bir müşteri, cplId ile bağlı)
  const customers = await seedCustomers(
    dataSource,
    tenant.id,
    cpls,
    channels,
    adminUser.id,
  );
  if (!customers || customers.length === 0) {
    throw new Error('❌ No customers were seeded. Cannot continue.');
  }
  console.log(`   Customers: ${customers.length} created & linked to CPLs\n`);

  // 6. Seed budget envelopes
  const envelopes = await seedBudgetEnvelopes(dataSource, tenant.id);
  if (!envelopes || envelopes.length === 0) {
    throw new Error('❌ No budget envelopes were seeded. Cannot continue.');
  }
  const nkaEnvelope =
    envelopes.find((e) => e.code.includes('NKA')) || envelopes[0];
  if (!nkaEnvelope) {
    throw new Error('❌ No budget envelope found. Cannot continue.');
  }
  console.log(
    `   NKA Envelope: ${nkaEnvelope.code} (${nkaEnvelope.allocatedAmount} TRY)\n`,
  );

  // 7. Seed mechanics (master-data; bağımlılık sırası: channels, CPLs tamamlandı)
  await seedMechanics(dataSource, tenant.id, adminUser.id);

  // 7a. Seed product master-data (T-010) — Wella Product.xlsx: Brand/Category/
  // GenericUnit/ForecastingUnit/Sku. WELLA brand'i agreement.seed ile paylaşılır;
  // agreement.seed'in HAIR_CARE placeholder zincirine dokunmaz.
  const productSeed = await seedProducts(dataSource, tenant.id, adminUser.id);
  console.log(
    `   Product master-data: ${productSeed.categories.length} categories, ${productSeed.genericUnits.length} GUs, ${productSeed.forecastingUnits.length} FUs, ${productSeed.skus.length} SKUs\n`,
  );

  // 8. Seed agreements (use CPL ID instead of customer ID)
  const agreements = await seedAgreements(
    dataSource,
    tenant.id,
    cpl.id,
    plannerUser.id,
  );
  if (!agreements || agreements.length === 0) {
    throw new Error('❌ No agreements were seeded. Cannot continue.');
  }
  const approvedAgreement = agreements.find((a) => a.status === 'APPROVED');
  console.log(`   Agreements: ${agreements.length} created`);
  console.log(
    `   - DRAFT: ${agreements.filter((a) => a.status === 'DRAFT').length}`,
  );
  console.log(
    `   - APPROVED: ${agreements.filter((a) => a.status === 'APPROVED').length}\n`,
  );

  // 9. Seed KPI definitions (BRD canonical formulas — idempotent upsert)
  const kpis = await seedKpis(dataSource, tenant.id);
  console.log(`   KPIs: ${kpis.length} inserted/updated\n`);

  // 10. Seed budget transactions (for approved agreement)
  const matchingEnvelope = nkaEnvelope;
  if (approvedAgreement) {
    const transactions = await seedBudgetTransactions(
      dataSource,
      tenant.id,
      matchingEnvelope.id,
      approvedAgreement.id,
      financeManagerUser.id,
    );
    console.log(`   Budget Transactions: ${transactions.length} created\n`);
  }

  console.log('✅ Cleanup and seed process completed successfully!\n');
  console.log('📋 Summary:');
  console.log(`   - Users: ${users.length} (all roles)`);
  console.log(`   - Agreements: ${agreements.length}`);
  console.log(`   - Budget Envelopes: ${envelopes.length}`);
  console.log(`   - CPLs: ${cpls.length}`);
  console.log(`   - Channels: ${channels.length}`);
  console.log(`   - Customers: ${customers.length}\n`);
}

// Standalone execution
async function bootstrap() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'collmind_tpm',
    schema: process.env.DB_SCHEMA || 'main',
    entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
    synchronize: false,
  });

  let exitCode = 0;
  try {
    await dataSource.initialize();
    console.log('📦 Database connected\n');
    await cleanupAndSeed(dataSource);
  } catch (error) {
    console.error('❌ Process failed:', error);
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

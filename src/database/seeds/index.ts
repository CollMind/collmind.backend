import { DataSource } from 'typeorm';
import { UserRole } from '../entities/user.entity';
import { seedFiscalPeriods } from './fiscal-period.seed';
import { seedTenants } from './tenant.seed';
import { seedUsers } from './user.seed';
import { seedChannels } from './channel.seed';
import { seedCustomers } from './customer.seed';
import { seedCpls } from './cpl.seed';
import { seedBudgetEnvelopes } from './budget-envelope.seed';
import { seedBudgetAlertConfigurations } from './budget-alert-configuration.seed';
import { seedMechanics } from './mechanic.seed';
import { seedProducts } from './product.seed';
import { seedAgreements } from './agreement.seed';
import { seedBudgetTransactions } from './budget-transaction.seed';
import { seedKpis } from './kpi.seed';
import { seedSalesActuals } from './sales-actual.seed';
import { seedUserScopes } from './user-scope.seed';

export async function runAllSeeds(dataSource: DataSource): Promise<void> {
  console.log('🌱 Starting seed process...\n');

  // 1. Seed tenants
  const tenants = await seedTenants(dataSource);
  if (!tenants || tenants.length === 0) {
    throw new Error('❌ No tenants were seeded. Cannot continue.');
  }
  const tenant = tenants[0];
  console.log(`   Tenant: ${tenant.name} (${tenant.id})\n`);

  // 2. Seed users
  const users = await seedUsers(dataSource, tenant.id);
  if (!users || users.length === 0) {
    throw new Error('❌ No users were seeded. Cannot continue.');
  }
  // B dalgası / R2a: enum DEĞERLERİ ASCII kalır (⛔ P0 düzeltmesi — bkz. user.entity.ts
  // üst yorumu); `UserRole.ADMIN` üzerinden karşılaştırmak yine de doğru ve tercih
  // edilen yol (string literal yerine enum key'e bağlanır).
  const adminUser = users.find((u) => u.role === UserRole.ADMIN) || users[0];
  const plannerUser =
    users.find((u) => u.role === UserRole.PLANNER) || users[0];
  if (!adminUser) {
    throw new Error('❌ No admin user found. Cannot continue.');
  }
  if (!plannerUser) {
    throw new Error('❌ No planner user found. Cannot continue.');
  }
  console.log(`   Admin: ${adminUser.email}`);
  console.log(`   Planner: ${plannerUser.email}\n`);

  // 2b. Seed fiscal periods (B dalgası / S11 seed item 4) — agreement/budget-
  // transaction/sales-actual seed'leri period_month/fiscal_period yazıyor ve bu
  // kolonlar artık fiscal_periods'a FK'lı; bu adım ONLARDAN ÖNCE çalışmalı.
  await seedFiscalPeriods(dataSource, tenant.id, adminUser.id);

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

  // 4. Seed CPLs (required for agreements) — kaynak: Wella Customer.xlsx
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
  const customer = customers[0];
  console.log(`   Customers: ${customers.length} created & linked to CPLs\n`);

  // 6. Seed budget envelopes
  const envelopes = await seedBudgetEnvelopes(dataSource, tenant.id);
  if (!envelopes || envelopes.length === 0) {
    throw new Error('❌ No budget envelopes were seeded. Cannot continue.');
  }

  // 6a. Seed budget alert configurations (config-driven thresholds — T-012)
  await seedBudgetAlertConfigurations(dataSource, tenant.id);
  const nkaEnvelope =
    envelopes.find((e) => e.code.includes('NKA')) || envelopes[0];
  if (!nkaEnvelope) {
    throw new Error('❌ No budget envelope found. Cannot continue.');
  }
  console.log(
    `   NKA Envelope: ${nkaEnvelope.code} (${nkaEnvelope.allocatedAmount} TRY)\n`,
  );

  // 7. Seed mechanics (master-data; bağımlılık: tactic'ler bu adımda oluşturulur)
  // ÖNCE agreement.seed'den çalışmalı — agreement seed TAC-PROMO'yu da oluşturuyor
  // ancak mechanic seed kendi tactic'lerini idempotent yönetiyor.
  await seedMechanics(dataSource, tenant.id, adminUser.id);

  // 7a. Seed product master-data (T-010) — Wella Product.xlsx: Brand/Category/
  // GenericUnit/ForecastingUnit/Sku. WELLA brand'i agreement.seed ile paylaşılır;
  // agreement.seed'in HAIR_CARE placeholder zincirine dokunmaz.
  const productSeed = await seedProducts(dataSource, tenant.id, adminUser.id);
  console.log(
    `   Product master-data: ${productSeed.categories.length} categories, ${productSeed.genericUnits.length} GUs, ${productSeed.forecastingUnits.length} FUs, ${productSeed.skus.length} SKUs\n`,
  );

  // 7a-2. Seed UserScope (T-028b) — CM kategori-scoped onay + PLANNER
  // cross-CPL negatif testler. cpls (adım 4) VE kategoriler (adım 7a) sonrası
  // çalışmalı; deny-by-default (AccessScopeService R-2) açıldığında
  // scope'suz PLANNER/CM hiçbir şey görmez — sıra kritik.
  const userScopeSeed = await seedUserScopes(
    dataSource,
    tenant.id,
    users,
    adminUser.id,
  );
  console.log(
    `   UserScope: ${userScopeSeed.rowsCreated} created, ${userScopeSeed.rowsSkipped} already present (${userScopeSeed.totalRows} total)\n`,
  );

  // 7b. Seed sales actuals (T-020) — Wella actuals_2026-01/02.csv fixture'ları.
  // CPL/Category/Channel master-data'ya bağımlı; product seed'den (kategoriler)
  // ve cpl/channel seed'den (adım 3-4) SONRA çalışmalı.
  await seedSalesActuals(dataSource, tenant.id, adminUser.id, adminUser.email);

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
  let matchingEnvelope = nkaEnvelope;
  if (approvedAgreement) {
    // Find envelope matching the approved agreement's period and channel
    // This ensures budget reservations are made from the correct period envelope
    matchingEnvelope =
      envelopes.find(
        (e) =>
          e.period === approvedAgreement.periodMonth && e.code.includes('NKA'),
      ) ||
      envelopes.find((e) => e.code.includes('NKA')) ||
      envelopes[0];

    if (!matchingEnvelope) {
      throw new Error(
        `❌ No matching envelope found for agreement ${approvedAgreement.agreementCode}. Cannot create budget transaction.`,
      );
    }

    console.log(
      `   Using envelope: ${matchingEnvelope.code} (period: ${matchingEnvelope.period}) for agreement: ${approvedAgreement.agreementCode} (period: ${approvedAgreement.periodMonth})\n`,
    );

    await seedBudgetTransactions(
      dataSource,
      tenant.id,
      matchingEnvelope.id,
      approvedAgreement.id,
      adminUser.id,
    );
  }

  console.log('\n✅ Seed process completed!\n');

  // Print test credentials
  console.log('📋 Test Credentials:');
  console.log('─'.repeat(40));
  if (users && users.length > 0) {
    users.forEach((user) => {
      console.log(`   ${user.role}: ${user.email} / Collmind2026!`);
    });
  } else {
    console.log('   ⚠️  No users available');
  }
  console.log('─'.repeat(40));

  // Print test data summary
  console.log('\n📋 Test Data Summary:');
  console.log('─'.repeat(40));
  if (tenant) {
    console.log(`   Tenant ID: ${tenant.id}`);
  }
  if (customer) {
    console.log(`   Customer ID: ${customer.id}`);
  }
  if (nkaEnvelope) {
    console.log(`   NKA Envelope ID: ${nkaEnvelope.id}`);
  }
  if (approvedAgreement) {
    console.log(`   Approved Agreement ID: ${approvedAgreement.id}`);
    if (matchingEnvelope) {
      console.log(
        `   Matching Envelope ID: ${matchingEnvelope.id} (period: ${matchingEnvelope.period})`,
      );
    }
  }
  console.log('─'.repeat(40));
}

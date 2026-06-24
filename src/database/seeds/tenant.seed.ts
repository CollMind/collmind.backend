import { DataSource } from 'typeorm';
import { Tenant, TenantStatus, TenantPlan } from '../entities/tenant.entity';

export async function seedTenants(dataSource: DataSource): Promise<Tenant[]> {
  const tenantRepository = dataSource.getRepository(Tenant);

  const tenants = [
    {
      name: 'Wella Turkey',
      domain: 'wella.tsp.local',
      status: TenantStatus.ACTIVE,
      plan: TenantPlan.PROFESSIONAL,
      contactEmail: 'admin@wella.com',
      contactPerson: 'Wella Admin',
      city: 'Istanbul',
      country: 'Turkey',
      industry: 'FMCG',
      maxUsers: 50,
      maxStorageGB: 100,
      settings: {
        defaultCurrency: 'TRY',
        fiscalYearStart: '01-01',
        timezone: 'Europe/Istanbul',
        features: {
          advancedAnalytics: true,
          apiAccess: true,
          customReports: true,
          bulkImport: true,
        },
      },
    },
  ];

  const created: Tenant[] = [];
  for (const tenantData of tenants) {
    const existing = await tenantRepository.findOne({
      where: { name: tenantData.name },
    });

    if (!existing) {
      const tenant = tenantRepository.create(tenantData);
      created.push(await tenantRepository.save(tenant));
      console.log(`✅ Created tenant: ${tenant.name}`);
    } else {
      created.push(existing);
    }
  }

  console.log(`✅ Seeded ${created.length} tenants`);
  return created;
}

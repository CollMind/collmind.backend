import { DataSource } from 'typeorm';
import { Tenant, TenantStatus, TenantPlan } from '../entities/tenant.entity';

export async function seedTenants(dataSource: DataSource) {
  const tenantRepository = dataSource.getRepository(Tenant);

  const tenants = [
    {
      name: 'Demo Corporation',
      domain: 'demo.tsp.local',
      status: TenantStatus.ACTIVE,
      plan: TenantPlan.PROFESSIONAL,
      contactEmail: 'admin@demo.com',
      contactPerson: 'Demo Admin',
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
    {
      name: 'Test Company',
      domain: 'test.tsp.local',
      status: TenantStatus.TRIAL,
      plan: TenantPlan.BASIC,
      contactEmail: 'info@test.com',
      city: 'Ankara',
      country: 'Turkey',
    },
  ];

  for (const tenantData of tenants) {
    const existing = await tenantRepository.findOne({
      where: { name: tenantData.name },
    });

    if (!existing) {
      const tenant = tenantRepository.create(tenantData);
      await tenantRepository.save(tenant);
      console.log(`✅ Created tenant: ${tenant.name}`);
    }
  }
}


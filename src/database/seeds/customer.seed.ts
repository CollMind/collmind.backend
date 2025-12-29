import { DataSource } from 'typeorm';
import { Customer, CustomerChannel, CustomerType, CustomerStatus } from '../entities/customer.entity';
import { Tenant } from '../entities/tenant.entity';

export async function seedCustomers(dataSource: DataSource) {
  const customerRepository = dataSource.getRepository(Customer);
  const tenantRepository = dataSource.getRepository(Tenant);

  const demoTenant = await tenantRepository.findOne({
    where: { name: 'Demo Corporation' },
  });

  if (!demoTenant) {
    console.log('❌ Demo tenant not found');
    return;
  }

  const customers = [
    {
      code: 'CUST001',
      name: 'Metro Türkiye',
      channel: CustomerChannel.NKA,
      type: CustomerType.DIRECT,
      status: CustomerStatus.ACTIVE,
      city: 'Istanbul',
      district: 'Beşiktaş',
      region: 'Marmara',
      country: 'Turkey',
      address: 'Metro Plaza, Beşiktaş',
      postalCode: '34349',
      taxNumber: '1234567890',
      taxOffice: 'Beşiktaş',
      contactPerson: 'Ahmet Yılmaz',
      contactEmail: 'ahmet.yilmaz@metro.com.tr',
      contactPhone: '+90 212 555 1234',
      paymentTerms: 'NET30',
      creditLimit: 500000,
      currency: 'TRY',
      salesRepresentative: 'John Doe',
      accountManager: 'Jane Smith',
      customerGroup: 'Modern Trade',
      customerSegment: 'Hypermarket',
      customerTier: 'A',
      businessSize: 'Large',
      isVip: true,
      metadata: {
        storeSize: 5000,
        numberOfEmployees: 200,
        numberOfLocations: 15,
      },
      tenantId: demoTenant.id,
    },
    {
      code: 'CUST002',
      name: 'Migros',
      channel: CustomerChannel.NKA,
      type: CustomerType.DIRECT,
      status: CustomerStatus.ACTIVE,
      city: 'Istanbul',
      region: 'Marmara',
      country: 'Turkey',
      customerTier: 'A',
      isVip: true,
      tenantId: demoTenant.id,
    },
    {
      code: 'CUST003',
      name: 'CarrefourSA',
      channel: CustomerChannel.NKA,
      type: CustomerType.DIRECT,
      status: CustomerStatus.ACTIVE,
      city: 'Istanbul',
      region: 'Marmara',
      country: 'Turkey',
      customerTier: 'A',
      tenantId: demoTenant.id,
    },
  ];

  for (const customerData of customers) {
    const existing = await customerRepository.findOne({
      where: { tenantId: customerData.tenantId, code: customerData.code },
    });

    if (!existing) {
      const customer = customerRepository.create(customerData);
      await customerRepository.save(customer);
      console.log(`✅ Created customer: ${customer.name} (${customer.code})`);
    }
  }
}


import { DataSource } from 'typeorm';
import { Customer, CustomerChannel, CustomerType, CustomerStatus } from '../entities/customer.entity';

export async function seedCustomers(dataSource: DataSource, tenantId: string): Promise<Customer[]> {
  const customerRepository = dataSource.getRepository(Customer);

  const customers = [
    {
      code: 'CUST001',
      name: 'Migros',
      channel: CustomerChannel.NKA,
      type: CustomerType.DIRECT,
      status: CustomerStatus.ACTIVE,
      city: 'Istanbul',
      region: 'Marmara',
      country: 'Turkey',
      customerTier: 'A',
      isVip: true,
      tenantId,
    },
    {
      code: 'CUST002',
      name: 'CarrefourSA',
      channel: CustomerChannel.NKA,
      type: CustomerType.DIRECT,
      status: CustomerStatus.ACTIVE,
      city: 'Istanbul',
      region: 'Marmara',
      country: 'Turkey',
      customerTier: 'A',
      isVip: true,
      tenantId,
    },
    {
      code: 'CUST003',
      name: 'Metro Türkiye',
      channel: CustomerChannel.NKA,
      type: CustomerType.DIRECT,
      status: CustomerStatus.ACTIVE,
      city: 'Istanbul',
      region: 'Marmara',
      country: 'Turkey',
      customerTier: 'A',
      isVip: true,
      tenantId,
    },
  ];

  const created: Customer[] = [];
  for (const customerData of customers) {
    const existing = await customerRepository.findOne({
      where: { tenantId: customerData.tenantId, code: customerData.code },
    });

    if (!existing) {
      const customer = customerRepository.create(customerData);
      created.push(await customerRepository.save(customer));
      console.log(`✅ Created customer: ${customer.name} (${customer.code})`);
    } else {
      created.push(existing);
    }
  }

  console.log(`✅ Seeded ${created.length} customers`);
  return created;
}


import { DataSource } from 'typeorm';
import { seedTenants } from './tenant.seed';
import { seedUsers } from './user.seed';
import { seedCustomers } from './customer.seed';

export async function runSeeds(dataSource: DataSource) {
  console.log('🌱 Starting database seeding...\n');

  try {
    await seedTenants(dataSource);
    await seedUsers(dataSource);
    await seedCustomers(dataSource);

    console.log('\n✅ Database seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    throw error;
  }
}


import { DataSource } from 'typeorm';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import { Tenant } from '../entities/tenant.entity';
import * as bcrypt from 'bcrypt';

export async function seedUsers(dataSource: DataSource) {
  const userRepository = dataSource.getRepository(User);
  const tenantRepository = dataSource.getRepository(Tenant);

  const demoTenant = await tenantRepository.findOne({
    where: { name: 'Demo Corporation' },
  });

  if (!demoTenant) {
    console.log('❌ Demo tenant not found');
    return;
  }

  const users = [
    {
      email: 'admin@demo.com',
      fullName: 'System Admin',
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      department: 'IT',
      jobTitle: 'System Administrator',
      passwordHash: await bcrypt.hash('Admin123!', 10),
      emailVerified: true,
      tenantId: demoTenant.id,
    },
    {
      email: 'planner@demo.com',
      fullName: 'John Planner',
      firstName: 'John',
      lastName: 'Planner',
      role: UserRole.PLANNER,
      status: UserStatus.ACTIVE,
      department: 'Sales',
      jobTitle: 'Trade Planner',
      passwordHash: await bcrypt.hash('Planner123!', 10),
      emailVerified: true,
      tenantId: demoTenant.id,
    },
    {
      email: 'approver@demo.com',
      fullName: 'Jane Approver',
      firstName: 'Jane',
      lastName: 'Approver',
      role: UserRole.APPROVER,
      status: UserStatus.ACTIVE,
      department: 'Sales',
      jobTitle: 'Sales Manager',
      passwordHash: await bcrypt.hash('Approver123!', 10),
      emailVerified: true,
      tenantId: demoTenant.id,
    },
    {
      email: 'finance@demo.com',
      fullName: 'Bob Finance',
      firstName: 'Bob',
      lastName: 'Finance',
      role: UserRole.FINANCE,
      status: UserStatus.ACTIVE,
      department: 'Finance',
      jobTitle: 'Finance Analyst',
      passwordHash: await bcrypt.hash('Finance123!', 10),
      emailVerified: true,
      tenantId: demoTenant.id,
    },
  ];

  for (const userData of users) {
    const existing = await userRepository.findOne({
      where: { tenantId: userData.tenantId, email: userData.email },
    });

    if (!existing) {
      const user = userRepository.create(userData);
      await userRepository.save(user);
      console.log(`✅ Created user: ${user.email}`);
    }
  }
}


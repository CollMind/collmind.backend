import { DataSource } from 'typeorm';
import { User, UserRole, UserStatus } from '../entities/user.entity';
import * as bcrypt from 'bcrypt';

export async function seedUsers(
  dataSource: DataSource,
  tenantId: string,
): Promise<User[]> {
  const userRepository = dataSource.getRepository(User);

  const users = [
    {
      email: 'admin@wella.com',
      fullName: 'System Admin',
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      department: 'IT',
      jobTitle: 'System Administrator',
      passwordHash: await bcrypt.hash('Collmind2026!', 10),
      emailVerified: true,
      tenantId,
    },
    {
      email: 'planner@wella.com',
      fullName: 'John Planner',
      firstName: 'John',
      lastName: 'Planner',
      role: UserRole.PLANNER,
      status: UserStatus.ACTIVE,
      department: 'Sales',
      jobTitle: 'Trade Planner',
      passwordHash: await bcrypt.hash('Collmind2026!', 10),
      emailVerified: true,
      tenantId,
    },
    {
      email: 'manager@wella.com',
      fullName: 'Jane Manager',
      firstName: 'Jane',
      lastName: 'Manager',
      // T-028a: MANAGER deprecated alias → CATEGORY_MANAGER (BRD canonical).
      // E-posta korunur (e2e login helper'ları buna göre eşleşiyor).
      role: UserRole.CATEGORY_MANAGER,
      status: UserStatus.ACTIVE,
      department: 'Sales',
      jobTitle: 'Sales Manager',
      passwordHash: await bcrypt.hash('Collmind2026!', 10),
      emailVerified: true,
      tenantId,
    },
    {
      email: 'finance@wella.com',
      fullName: 'Bob Finance',
      firstName: 'Bob',
      lastName: 'Finance',
      // T-028a: FINANCE deprecated alias → FINANCE_MANAGER (BRD canonical).
      // E-posta korunur (e2e login helper'ları buna göre eşleşiyor).
      role: UserRole.FINANCE_MANAGER,
      status: UserStatus.ACTIVE,
      department: 'Finance',
      jobTitle: 'Finance Analyst',
      passwordHash: await bcrypt.hash('Collmind2026!', 10),
      emailVerified: true,
      tenantId,
    },
    {
      email: 'finance.manager@wella.com',
      fullName: 'Sarah Finance Manager',
      firstName: 'Sarah',
      lastName: 'Finance Manager',
      role: UserRole.FINANCE_MANAGER,
      status: UserStatus.ACTIVE,
      department: 'Finance',
      jobTitle: 'Finance Manager',
      passwordHash: await bcrypt.hash('Collmind2026!', 10),
      emailVerified: true,
      tenantId,
    },
    {
      email: 'category.manager@wella.com',
      fullName: 'Mike Category Manager',
      firstName: 'Mike',
      lastName: 'Category Manager',
      role: UserRole.CATEGORY_MANAGER,
      status: UserStatus.ACTIVE,
      department: 'Sales',
      jobTitle: 'Category Manager',
      passwordHash: await bcrypt.hash('Collmind2026!', 10),
      emailVerified: true,
      tenantId,
    },
    {
      email: 'readonly@wella.com',
      fullName: 'Read Only User',
      firstName: 'Read',
      lastName: 'Only',
      role: UserRole.READONLY,
      status: UserStatus.ACTIVE,
      department: 'Audit',
      jobTitle: 'Auditor',
      passwordHash: await bcrypt.hash('Collmind2026!', 10),
      emailVerified: true,
      tenantId,
    },
  ];

  const created: User[] = [];
  for (const userData of users) {
    const existing = await userRepository.findOne({
      where: { tenantId: userData.tenantId, email: userData.email },
    });

    if (!existing) {
      const user = userRepository.create(userData);
      created.push(await userRepository.save(user));
      console.log(`✅ Created user: ${user.email}`);
    } else {
      // Update existing user including password_hash
      await userRepository.update(
        { tenantId: userData.tenantId, email: userData.email },
        {
          fullName: userData.fullName,
          firstName: userData.firstName,
          lastName: userData.lastName,
          role: userData.role,
          status: userData.status,
          department: userData.department,
          jobTitle: userData.jobTitle,
          passwordHash: userData.passwordHash,
          emailVerified: userData.emailVerified,
        },
      );
      const updated = await userRepository.findOne({
        where: { tenantId: userData.tenantId, email: userData.email },
      });
      created.push(updated!);
      console.log(`✅ Updated user: ${updated!.email}`);
    }
  }

  console.log(`✅ Seeded ${created.length} users`);
  return created;
}

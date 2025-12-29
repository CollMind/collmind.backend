import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';

@Injectable()
export class TenantRepository {
  constructor(
    @InjectRepository(Tenant)
    private readonly repository: Repository<Tenant>,
  ) {}

  async findByDomain(domain: string): Promise<Tenant | null> {
    return this.repository.findOne({ where: { domain } });
  }

  async findByName(name: string): Promise<Tenant | null> {
    return this.repository.findOne({ where: { name } });
  }

  async findActiveTenants(): Promise<Tenant[]> {
    return this.repository.find({ where: { status: TenantStatus.ACTIVE } });
  }

  async findOne(options: any): Promise<Tenant | null> {
    return this.repository.findOne(options);
  }

  async find(options?: any): Promise<Tenant[]> {
    return this.repository.find(options);
  }

  create(entity: Partial<Tenant>): Tenant {
    return this.repository.create(entity);
  }

  async save(entity: Tenant): Promise<Tenant> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Tenant): Promise<Tenant> {
    return this.repository.softRemove(entity);
  }

  async getTenantStats(tenantId: string): Promise<any> {
    return this.repository
      .createQueryBuilder('tenant')
      .leftJoinAndSelect('tenant.users', 'users')
      .where('tenant.id = :tenantId', { tenantId })
      .select([
        'tenant.id',
        'tenant.name',
        'COUNT(DISTINCT users.id) as userCount',
        'tenant.maxUsers',
        'tenant.currentStorageGB',
        'tenant.maxStorageGB',
      ])
      .groupBy('tenant.id')
      .getRawOne();
  }
}


import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from '../../../database/entities/brand.entity';

@Injectable()
export class BrandRepository {
  constructor(
    @InjectRepository(Brand)
    private readonly repository: Repository<Brand>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Brand | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(
    tenantId: string,
    activeOnly = false,
  ): Promise<Brand[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    return this.repository.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Brand | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Brand>): Brand {
    return this.repository.create(entity);
  }

  async save(entity: Brand): Promise<Brand> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Brand): Promise<Brand> {
    return this.repository.softRemove(entity);
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Region } from '../../../database/entities/region.entity';

@Injectable()
export class RegionRepository {
  constructor(
    @InjectRepository(Region)
    private readonly repository: Repository<Region>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Region | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(tenantId: string, activeOnly = false): Promise<Region[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    return this.repository.find({
      where,
      relations: ['parentRegion', 'children'],
      order: { level: 'ASC', name: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Region | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Region>): Region {
    return this.repository.create(entity);
  }

  async save(entity: Region): Promise<Region> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Region): Promise<Region> {
    return this.repository.softRemove(entity);
  }
}

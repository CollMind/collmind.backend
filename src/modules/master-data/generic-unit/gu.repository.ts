import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GenericUnit } from '../../../database/entities/generic-unit.entity';

@Injectable()
export class GuRepository {
  constructor(
    @InjectRepository(GenericUnit)
    private readonly repository: Repository<GenericUnit>,
  ) {}

  async findByCode(
    tenantId: string,
    code: string,
  ): Promise<GenericUnit | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(
    tenantId: string,
    activeOnly = false,
  ): Promise<GenericUnit[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    return this.repository.find({
      where,
      relations: ['brand', 'category'],
      order: { name: 'ASC' },
    });
  }

  async findOne(options: any): Promise<GenericUnit | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<GenericUnit>): GenericUnit {
    return this.repository.create(entity);
  }

  async save(entity: GenericUnit): Promise<GenericUnit> {
    return this.repository.save(entity);
  }

  async softRemove(entity: GenericUnit): Promise<GenericUnit> {
    return this.repository.softRemove(entity);
  }
}

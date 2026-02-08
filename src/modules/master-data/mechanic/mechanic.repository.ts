import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mechanic } from '../../../database/entities/mechanic.entity';

@Injectable()
export class MechanicRepository {
  constructor(
    @InjectRepository(Mechanic)
    private readonly repository: Repository<Mechanic>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Mechanic | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(tenantId: string, activeOnly = false, tacticId?: string): Promise<Mechanic[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    if (tacticId) {
      where.tacticId = tacticId;
    }
    return this.repository.find({
      where,
      relations: ['tactic'],
      order: { name: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Mechanic | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Mechanic>): Mechanic {
    return this.repository.create(entity);
  }

  async save(entity: Mechanic): Promise<Mechanic> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Mechanic): Promise<Mechanic> {
    return this.repository.softRemove(entity);
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tactic } from '../../../database/entities/tactic.entity';

@Injectable()
export class TacticRepository {
  constructor(
    @InjectRepository(Tactic)
    private readonly repository: Repository<Tactic>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Tactic | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(
    tenantId: string,
    activeOnly = false,
  ): Promise<Tactic[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    return this.repository.find({
      where,
      relations: ['mechanics'],
      order: { name: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Tactic | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Tactic>): Tactic {
    return this.repository.create(entity);
  }

  async save(entity: Tactic): Promise<Tactic> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Tactic): Promise<Tactic> {
    return this.repository.softRemove(entity);
  }
}

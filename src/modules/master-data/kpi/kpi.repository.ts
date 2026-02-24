import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Kpi } from '../../../database/entities/kpi.entity';

@Injectable()
export class KpiRepository {
  constructor(
    @InjectRepository(Kpi)
    private readonly repository: Repository<Kpi>,
  ) {}

  async findByCode(tenantId: string, kpiCode: string): Promise<Kpi | null> {
    return this.repository.findOne({ where: { tenantId, kpiCode } });
  }

  async findAllByTenant(tenantId: string, activeOnly = false): Promise<Kpi[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    return this.repository.find({
      where,
      order: { calculationOrder: 'ASC', kpiCode: 'ASC' },
    });
  }

  async findGridKpis(tenantId: string): Promise<Kpi[]> {
    return this.repository.find({
      where: { tenantId, isActive: true, showInGrid: true },
      order: { columnOrder: 'ASC', calculationOrder: 'ASC' },
    });
  }

  async findCalculableKpis(tenantId: string): Promise<Kpi[]> {
    return this.repository.find({
      where: { tenantId, isActive: true },
      order: { calculationOrder: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Kpi | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Kpi>): Kpi {
    return this.repository.create(entity);
  }

  async save(entity: Kpi): Promise<Kpi> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Kpi): Promise<Kpi> {
    return this.repository.softRemove(entity);
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ForecastingUnit } from '../../../database/entities/forecasting-unit.entity';

@Injectable()
export class FuRepository {
  constructor(
    @InjectRepository(ForecastingUnit)
    private readonly repository: Repository<ForecastingUnit>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<ForecastingUnit | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(tenantId: string, activeOnly = false, guId?: string, categoryId?: string): Promise<ForecastingUnit[]> {
    const query = this.repository.createQueryBuilder('fu')
      .leftJoinAndSelect('fu.genericUnit', 'gu')
      .leftJoinAndSelect('gu.category', 'category')
      .leftJoinAndSelect('gu.brand', 'brand')
      .leftJoinAndSelect('fu.skus', 'skus')
      .where('fu.tenantId = :tenantId', { tenantId })
      .andWhere('fu.deletedAt IS NULL');

    if (activeOnly) {
      query.andWhere('fu.isActive = :isActive', { isActive: true });
    }
    if (guId) {
      query.andWhere('fu.guId = :guId', { guId });
    }
    if (categoryId) {
      query.andWhere('gu.categoryId = :categoryId', { categoryId });
    }

    return query.orderBy('fu.name', 'ASC').getMany();
  }

  async findOne(options: any): Promise<ForecastingUnit | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<ForecastingUnit>): ForecastingUnit {
    return this.repository.create(entity);
  }

  async save(entity: ForecastingUnit): Promise<ForecastingUnit> {
    return this.repository.save(entity);
  }

  async softRemove(entity: ForecastingUnit): Promise<ForecastingUnit> {
    return this.repository.softRemove(entity);
  }
}

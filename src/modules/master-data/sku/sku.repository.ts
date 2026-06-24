import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sku } from '../../../database/entities/sku.entity';

@Injectable()
export class SkuRepository {
  constructor(
    @InjectRepository(Sku)
    private readonly repository: Repository<Sku>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Sku | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(
    tenantId: string,
    activeOnly = false,
    fuId?: string,
    brandId?: string,
    categoryId?: string,
  ): Promise<Sku[]> {
    const query = this.repository
      .createQueryBuilder('sku')
      .leftJoinAndSelect('sku.genericUnit', 'gu')
      .leftJoinAndSelect('gu.brand', 'brand')
      .leftJoinAndSelect('gu.category', 'category')
      .leftJoinAndSelect('sku.forecastingUnit', 'fu')
      .where('sku.tenantId = :tenantId', { tenantId })
      .andWhere('sku.deletedAt IS NULL');

    if (activeOnly) {
      query.andWhere('sku.isActive = :isActive', { isActive: true });
    }
    if (fuId) {
      query.andWhere('sku.fuId = :fuId', { fuId });
    }
    if (brandId) {
      query.andWhere('gu.brandId = :brandId', { brandId });
    }
    if (categoryId) {
      query.andWhere('gu.categoryId = :categoryId', { categoryId });
    }

    return query.orderBy('sku.name', 'ASC').getMany();
  }

  async findOne(options: any): Promise<Sku | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Sku>): Sku {
    return this.repository.create(entity);
  }

  async save(entity: Sku): Promise<Sku> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Sku): Promise<Sku> {
    return this.repository.softRemove(entity);
  }
}

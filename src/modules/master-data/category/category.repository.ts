import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../../../database/entities/category.entity';

@Injectable()
export class CategoryRepository {
  constructor(
    @InjectRepository(Category)
    private readonly repository: Repository<Category>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Category | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(
    tenantId: string,
    activeOnly = false,
  ): Promise<Category[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    return this.repository.find({
      where,
      relations: ['parentCategory', 'children'],
      order: { level: 'ASC', name: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Category | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Category>): Category {
    return this.repository.create(entity);
  }

  async save(entity: Category): Promise<Category> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Category): Promise<Category> {
    return this.repository.softRemove(entity);
  }
}

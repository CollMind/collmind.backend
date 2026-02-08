import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CategoryRepository } from './category.repository';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from '../../../database/entities/category.entity';

@Injectable()
export class CategoryService {
  constructor(private readonly categoryRepository: CategoryRepository) {}

  async create(tenantId: string, createCategoryDto: CreateCategoryDto): Promise<Category> {
    const existing = await this.categoryRepository.findByCode(tenantId, createCategoryDto.code);
    if (existing) {
      throw new ConflictException('Category with this code already exists');
    }

    // If parent category is provided, validate it
    if (createCategoryDto.parentCategoryId) {
      const parent = await this.categoryRepository.findOne({
        where: { tenantId, id: createCategoryDto.parentCategoryId },
      });
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
      createCategoryDto.level = (parent.level || 1) + 1;
    } else {
      createCategoryDto.level = createCategoryDto.level || 1;
    }

    const category = this.categoryRepository.create({
      ...createCategoryDto,
      tenantId,
      isActive: createCategoryDto.isActive ?? true,
    });

    return this.categoryRepository.save(category);
  }

  async findAll(tenantId: string, activeOnly = false): Promise<Category[]> {
    return this.categoryRepository.findAllByTenant(tenantId, activeOnly);
  }

  async findOne(tenantId: string, id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { tenantId, id },
      relations: ['parentCategory', 'children'],
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async update(
    tenantId: string,
    id: string,
    updateCategoryDto: UpdateCategoryDto,
  ): Promise<Category> {
    const category = await this.findOne(tenantId, id);

    if (updateCategoryDto.code && updateCategoryDto.code !== category.code) {
      const existing = await this.categoryRepository.findByCode(tenantId, updateCategoryDto.code);
      if (existing && existing.id !== id) {
        throw new ConflictException('Category with this code already exists');
      }
    }

    if (updateCategoryDto.parentCategoryId) {
      const parent = await this.categoryRepository.findOne({
        where: { tenantId, id: updateCategoryDto.parentCategoryId },
      });
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
      updateCategoryDto.level = (parent.level || 1) + 1;
    }

    Object.assign(category, updateCategoryDto);
    return this.categoryRepository.save(category);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const category = await this.findOne(tenantId, id);
    await this.categoryRepository.softRemove(category);
  }
}

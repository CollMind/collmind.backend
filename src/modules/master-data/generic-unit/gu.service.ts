import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GuRepository } from './gu.repository';
import { CreateGuDto } from './dto/create-gu.dto';
import { UpdateGuDto } from './dto/update-gu.dto';
import { GenericUnit } from '../../../database/entities/generic-unit.entity';
import { BrandRepository } from '../brand/brand.repository';
import { CategoryRepository } from '../category/category.repository';

@Injectable()
export class GuService {
  constructor(
    private readonly guRepository: GuRepository,
    private readonly brandRepository: BrandRepository,
    private readonly categoryRepository: CategoryRepository,
  ) {}

  async create(tenantId: string, createGuDto: CreateGuDto): Promise<GenericUnit> {
    const existing = await this.guRepository.findByCode(tenantId, createGuDto.code);
    if (existing) {
      throw new ConflictException('Generic Unit with this code already exists');
    }

    // Validate brand exists
    const brand = await this.brandRepository.findOne({
      where: { tenantId, id: createGuDto.brandId },
    });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    // Validate category exists
    const category = await this.categoryRepository.findOne({
      where: { tenantId, id: createGuDto.categoryId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const gu = this.guRepository.create({
      ...createGuDto,
      tenantId,
      isActive: createGuDto.isActive ?? true,
    });

    return this.guRepository.save(gu);
  }

  async findAll(tenantId: string, activeOnly = false): Promise<GenericUnit[]> {
    return this.guRepository.findAllByTenant(tenantId, activeOnly);
  }

  async findOne(tenantId: string, id: string): Promise<GenericUnit> {
    const gu = await this.guRepository.findOne({
      where: { tenantId, id },
      relations: ['brand', 'category'],
    });

    if (!gu) {
      throw new NotFoundException(`Generic Unit with ID ${id} not found`);
    }

    return gu;
  }

  async update(
    tenantId: string,
    id: string,
    updateGuDto: UpdateGuDto,
  ): Promise<GenericUnit> {
    const gu = await this.findOne(tenantId, id);

    if (updateGuDto.code && updateGuDto.code !== gu.code) {
      const existing = await this.guRepository.findByCode(tenantId, updateGuDto.code);
      if (existing && existing.id !== id) {
        throw new ConflictException('Generic Unit with this code already exists');
      }
    }

    if (updateGuDto.brandId) {
      const brand = await this.brandRepository.findOne({
        where: { tenantId, id: updateGuDto.brandId },
      });
      if (!brand) {
        throw new NotFoundException('Brand not found');
      }
    }

    if (updateGuDto.categoryId) {
      const category = await this.categoryRepository.findOne({
        where: { tenantId, id: updateGuDto.categoryId },
      });
      if (!category) {
        throw new NotFoundException('Category not found');
      }
    }

    Object.assign(gu, updateGuDto);
    return this.guRepository.save(gu);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const gu = await this.findOne(tenantId, id);
    await this.guRepository.softRemove(gu);
  }
}

import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BrandRepository } from './brand.repository';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { Brand } from '../../../database/entities/brand.entity';

@Injectable()
export class BrandService {
  constructor(private readonly brandRepository: BrandRepository) {}

  async create(
    tenantId: string,
    createBrandDto: CreateBrandDto,
  ): Promise<Brand> {
    const existing = await this.brandRepository.findByCode(
      tenantId,
      createBrandDto.code,
    );
    if (existing) {
      throw new ConflictException('Brand with this code already exists');
    }

    const brand = this.brandRepository.create({
      ...createBrandDto,
      tenantId,
      isActive: createBrandDto.isActive ?? true,
    });

    return this.brandRepository.save(brand);
  }

  async findAll(tenantId: string, activeOnly = false): Promise<Brand[]> {
    return this.brandRepository.findAllByTenant(tenantId, activeOnly);
  }

  async findOne(tenantId: string, id: string): Promise<Brand> {
    const brand = await this.brandRepository.findOne({
      where: { tenantId, id },
    });

    if (!brand) {
      throw new NotFoundException(`Brand with ID ${id} not found`);
    }

    return brand;
  }

  async update(
    tenantId: string,
    id: string,
    updateBrandDto: UpdateBrandDto,
  ): Promise<Brand> {
    const brand = await this.findOne(tenantId, id);

    if (updateBrandDto.code && updateBrandDto.code !== brand.code) {
      const existing = await this.brandRepository.findByCode(
        tenantId,
        updateBrandDto.code,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException('Brand with this code already exists');
      }
    }

    Object.assign(brand, updateBrandDto);
    return this.brandRepository.save(brand);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const brand = await this.findOne(tenantId, id);
    await this.brandRepository.softRemove(brand);
  }
}

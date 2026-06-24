import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SkuRepository } from './sku.repository';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { Sku } from '../../../database/entities/sku.entity';
import { GuRepository } from '../generic-unit/gu.repository';
import { FuRepository } from '../forecasting-unit/fu.repository';

@Injectable()
export class SkuService {
  constructor(
    private readonly skuRepository: SkuRepository,
    private readonly guRepository: GuRepository,
    private readonly fuRepository: FuRepository,
  ) {}

  async create(tenantId: string, createSkuDto: CreateSkuDto): Promise<Sku> {
    const existing = await this.skuRepository.findByCode(
      tenantId,
      createSkuDto.code,
    );
    if (existing) {
      throw new ConflictException('SKU with this code already exists');
    }

    // Validate GU exists
    const gu = await this.guRepository.findOne({
      where: { tenantId, id: createSkuDto.guId },
    });
    if (!gu) {
      throw new NotFoundException('Generic Unit not found');
    }

    // Validate FU exists if provided
    if (createSkuDto.fuId) {
      const fu = await this.fuRepository.findOne({
        where: { tenantId, id: createSkuDto.fuId },
      });
      if (!fu) {
        throw new NotFoundException('Forecasting Unit not found');
      }
    }

    const sku = this.skuRepository.create({
      ...createSkuDto,
      tenantId,
      isActive: createSkuDto.isActive ?? true,
      currency: createSkuDto.currency || 'TRY',
    });

    return this.skuRepository.save(sku);
  }

  async findAll(
    tenantId: string,
    activeOnly = false,
    fuId?: string,
    brandId?: string,
    categoryId?: string,
  ): Promise<Sku[]> {
    return this.skuRepository.findAllByTenant(
      tenantId,
      activeOnly,
      fuId,
      brandId,
      categoryId,
    );
  }

  async findOne(tenantId: string, id: string): Promise<Sku> {
    const sku = await this.skuRepository.findOne({
      where: { tenantId, id },
      relations: ['genericUnit', 'forecastingUnit'],
    });

    if (!sku) {
      throw new NotFoundException(`SKU with ID ${id} not found`);
    }

    return sku;
  }

  async findByCode(tenantId: string, code: string): Promise<Sku> {
    const sku = await this.skuRepository.findByCode(tenantId, code);
    if (!sku) {
      throw new NotFoundException(`SKU with code ${code} not found`);
    }
    // Relations'ı yükle
    const skuWithRelations = await this.skuRepository.findOne({
      where: { tenantId, id: sku.id },
      relations: ['genericUnit', 'forecastingUnit', 'genericUnit.category'],
    });
    return skuWithRelations || sku;
  }

  async update(
    tenantId: string,
    id: string,
    updateSkuDto: UpdateSkuDto,
  ): Promise<Sku> {
    const sku = await this.findOne(tenantId, id);

    if (updateSkuDto.code && updateSkuDto.code !== sku.code) {
      const existing = await this.skuRepository.findByCode(
        tenantId,
        updateSkuDto.code,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException('SKU with this code already exists');
      }
    }

    if (updateSkuDto.guId) {
      const gu = await this.guRepository.findOne({
        where: { tenantId, id: updateSkuDto.guId },
      });
      if (!gu) {
        throw new NotFoundException('Generic Unit not found');
      }
    }

    if (updateSkuDto.fuId) {
      const fu = await this.fuRepository.findOne({
        where: { tenantId, id: updateSkuDto.fuId },
      });
      if (!fu) {
        throw new NotFoundException('Forecasting Unit not found');
      }
    }

    Object.assign(sku, updateSkuDto);
    return this.skuRepository.save(sku);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const sku = await this.findOne(tenantId, id);
    await this.skuRepository.softRemove(sku);
  }
}

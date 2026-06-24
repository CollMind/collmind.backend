import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RegionRepository } from './region.repository';
import { CreateRegionDto } from './dto/create-region.dto';
import { UpdateRegionDto } from './dto/update-region.dto';
import { Region } from '../../../database/entities/region.entity';

@Injectable()
export class RegionService {
  constructor(private readonly regionRepository: RegionRepository) {}

  async create(
    tenantId: string,
    createRegionDto: CreateRegionDto,
  ): Promise<Region> {
    const existing = await this.regionRepository.findByCode(
      tenantId,
      createRegionDto.code,
    );
    if (existing) {
      throw new ConflictException('Region with this code already exists');
    }

    // If parent region is provided, validate it
    if (createRegionDto.parentRegionId) {
      const parent = await this.regionRepository.findOne({
        where: { tenantId, id: createRegionDto.parentRegionId },
      });
      if (!parent) {
        throw new NotFoundException('Parent region not found');
      }
      createRegionDto.level = (parent.level || 1) + 1;
    } else {
      createRegionDto.level = createRegionDto.level || 1;
    }

    const region = this.regionRepository.create({
      ...createRegionDto,
      tenantId,
      isActive: createRegionDto.isActive ?? true,
    });

    return this.regionRepository.save(region);
  }

  async findAll(tenantId: string, activeOnly = false): Promise<Region[]> {
    return this.regionRepository.findAllByTenant(tenantId, activeOnly);
  }

  async findOne(tenantId: string, id: string): Promise<Region> {
    const region = await this.regionRepository.findOne({
      where: { tenantId, id },
      relations: ['parentRegion', 'children'],
    });

    if (!region) {
      throw new NotFoundException(`Region with ID ${id} not found`);
    }

    return region;
  }

  async update(
    tenantId: string,
    id: string,
    updateRegionDto: UpdateRegionDto,
  ): Promise<Region> {
    const region = await this.findOne(tenantId, id);

    if (updateRegionDto.code && updateRegionDto.code !== region.code) {
      const existing = await this.regionRepository.findByCode(
        tenantId,
        updateRegionDto.code,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException('Region with this code already exists');
      }
    }

    if (updateRegionDto.parentRegionId) {
      const parent = await this.regionRepository.findOne({
        where: { tenantId, id: updateRegionDto.parentRegionId },
      });
      if (!parent) {
        throw new NotFoundException('Parent region not found');
      }
      updateRegionDto.level = (parent.level || 1) + 1;
    }

    Object.assign(region, updateRegionDto);
    return this.regionRepository.save(region);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const region = await this.findOne(tenantId, id);
    await this.regionRepository.softRemove(region);
  }
}

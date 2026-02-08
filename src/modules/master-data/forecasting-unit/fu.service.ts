import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FuRepository } from './fu.repository';
import { CreateFuDto } from './dto/create-fu.dto';
import { UpdateFuDto } from './dto/update-fu.dto';
import { ForecastingUnit } from '../../../database/entities/forecasting-unit.entity';
import { GuRepository } from '../generic-unit/gu.repository';

@Injectable()
export class FuService {
  constructor(
    private readonly fuRepository: FuRepository,
    private readonly guRepository: GuRepository,
  ) {}

  async create(tenantId: string, createFuDto: CreateFuDto): Promise<ForecastingUnit> {
    const existing = await this.fuRepository.findByCode(tenantId, createFuDto.code);
    if (existing) {
      throw new ConflictException('Forecasting Unit with this code already exists');
    }

    // Validate GU exists
    const gu = await this.guRepository.findOne({
      where: { tenantId, id: createFuDto.guId },
    });
    if (!gu) {
      throw new NotFoundException('Generic Unit not found');
    }

    const fu = this.fuRepository.create({
      ...createFuDto,
      tenantId,
      isPlannable: createFuDto.isPlannable ?? true,
      isActive: createFuDto.isActive ?? true,
      currency: createFuDto.currency || 'TRY',
    });

    return this.fuRepository.save(fu);
  }

  async findAll(tenantId: string, activeOnly = false, guId?: string, categoryId?: string): Promise<ForecastingUnit[]> {
    return this.fuRepository.findAllByTenant(tenantId, activeOnly, guId, categoryId);
  }

  async findOne(tenantId: string, id: string): Promise<ForecastingUnit> {
    const fu = await this.fuRepository.findOne({
      where: { tenantId, id },
      relations: ['genericUnit'],
    });

    if (!fu) {
      throw new NotFoundException(`Forecasting Unit with ID ${id} not found`);
    }

    return fu;
  }

  async update(
    tenantId: string,
    id: string,
    updateFuDto: UpdateFuDto,
  ): Promise<ForecastingUnit> {
    const fu = await this.findOne(tenantId, id);

    if (updateFuDto.code && updateFuDto.code !== fu.code) {
      const existing = await this.fuRepository.findByCode(tenantId, updateFuDto.code);
      if (existing && existing.id !== id) {
        throw new ConflictException('Forecasting Unit with this code already exists');
      }
    }

    if (updateFuDto.guId) {
      const gu = await this.guRepository.findOne({
        where: { tenantId, id: updateFuDto.guId },
      });
      if (!gu) {
        throw new NotFoundException('Generic Unit not found');
      }
    }

    Object.assign(fu, updateFuDto);
    return this.fuRepository.save(fu);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const fu = await this.findOne(tenantId, id);
    await this.fuRepository.softRemove(fu);
  }
}

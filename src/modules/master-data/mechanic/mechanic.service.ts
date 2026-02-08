import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MechanicRepository } from './mechanic.repository';
import { CreateMechanicDto } from './dto/create-mechanic.dto';
import { UpdateMechanicDto } from './dto/update-mechanic.dto';
import { Mechanic } from '../../../database/entities/mechanic.entity';
import { TacticRepository } from '../tactic/tactic.repository';

@Injectable()
export class MechanicService {
  constructor(
    private readonly mechanicRepository: MechanicRepository,
    private readonly tacticRepository: TacticRepository,
  ) {}

  async create(tenantId: string, createMechanicDto: CreateMechanicDto): Promise<Mechanic> {
    const existing = await this.mechanicRepository.findByCode(tenantId, createMechanicDto.code);
    if (existing) {
      throw new ConflictException('Mechanic with this code already exists');
    }

    // Validate tactic exists
    const tactic = await this.tacticRepository.findOne({
      where: { tenantId, id: createMechanicDto.tacticId },
    });
    if (!tactic) {
      throw new NotFoundException('Tactic not found');
    }

    const mechanic = this.mechanicRepository.create({
      ...createMechanicDto,
      tenantId,
      isActive: createMechanicDto.isActive ?? true,
    });

    return this.mechanicRepository.save(mechanic);
  }

  async findAll(tenantId: string, activeOnly = false, tacticId?: string): Promise<Mechanic[]> {
    return this.mechanicRepository.findAllByTenant(tenantId, activeOnly, tacticId);
  }

  async findOne(tenantId: string, id: string): Promise<Mechanic> {
    const mechanic = await this.mechanicRepository.findOne({
      where: { tenantId, id },
      relations: ['tactic'],
    });

    if (!mechanic) {
      throw new NotFoundException(`Mechanic with ID ${id} not found`);
    }

    return mechanic;
  }

  async update(
    tenantId: string,
    id: string,
    updateMechanicDto: UpdateMechanicDto,
  ): Promise<Mechanic> {
    const mechanic = await this.findOne(tenantId, id);

    if (updateMechanicDto.code && updateMechanicDto.code !== mechanic.code) {
      const existing = await this.mechanicRepository.findByCode(tenantId, updateMechanicDto.code);
      if (existing && existing.id !== id) {
        throw new ConflictException('Mechanic with this code already exists');
      }
    }

    if (updateMechanicDto.tacticId) {
      const tactic = await this.tacticRepository.findOne({
        where: { tenantId, id: updateMechanicDto.tacticId },
      });
      if (!tactic) {
        throw new NotFoundException('Tactic not found');
      }
    }

    Object.assign(mechanic, updateMechanicDto);
    return this.mechanicRepository.save(mechanic);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const mechanic = await this.findOne(tenantId, id);
    await this.mechanicRepository.softRemove(mechanic);
  }
}

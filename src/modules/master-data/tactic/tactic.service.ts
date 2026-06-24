import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TacticRepository } from './tactic.repository';
import { CreateTacticDto } from './dto/create-tactic.dto';
import { UpdateTacticDto } from './dto/update-tactic.dto';
import { Tactic } from '../../../database/entities/tactic.entity';

@Injectable()
export class TacticService {
  constructor(private readonly tacticRepository: TacticRepository) {}

  async create(
    tenantId: string,
    createTacticDto: CreateTacticDto,
  ): Promise<Tactic> {
    const existing = await this.tacticRepository.findByCode(
      tenantId,
      createTacticDto.code,
    );
    if (existing) {
      throw new ConflictException('Tactic with this code already exists');
    }

    const tactic = this.tacticRepository.create({
      ...createTacticDto,
      tenantId,
      isActive: createTacticDto.isActive ?? true,
    });

    return this.tacticRepository.save(tactic);
  }

  async findAll(tenantId: string, activeOnly = false): Promise<Tactic[]> {
    return this.tacticRepository.findAllByTenant(tenantId, activeOnly);
  }

  async findOne(tenantId: string, id: string): Promise<Tactic> {
    const tactic = await this.tacticRepository.findOne({
      where: { tenantId, id },
      relations: ['mechanics'],
    });

    if (!tactic) {
      throw new NotFoundException(`Tactic with ID ${id} not found`);
    }

    return tactic;
  }

  async update(
    tenantId: string,
    id: string,
    updateTacticDto: UpdateTacticDto,
  ): Promise<Tactic> {
    const tactic = await this.findOne(tenantId, id);

    if (updateTacticDto.code && updateTacticDto.code !== tactic.code) {
      const existing = await this.tacticRepository.findByCode(
        tenantId,
        updateTacticDto.code,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException('Tactic with this code already exists');
      }
    }

    Object.assign(tactic, updateTacticDto);
    return this.tacticRepository.save(tactic);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const tactic = await this.findOne(tenantId, id);
    await this.tacticRepository.softRemove(tactic);
  }
}

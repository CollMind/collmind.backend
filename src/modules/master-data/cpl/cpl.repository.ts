import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cpl } from '../../../database/entities/cpl.entity';

@Injectable()
export class CplRepository {
  constructor(
    @InjectRepository(Cpl)
    private readonly repository: Repository<Cpl>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Cpl | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(
    tenantId: string,
    activeOnly = false,
    channelId?: string,
  ): Promise<Cpl[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.status = 'ACTIVE';
    }
    if (channelId) {
      where.channelId = channelId;
    }
    return this.repository.find({
      where,
      relations: ['channel', 'customers'],
      order: { name: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Cpl | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Cpl>): Cpl {
    return this.repository.create(entity);
  }

  async save(entity: Cpl): Promise<Cpl> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Cpl): Promise<Cpl> {
    return this.repository.softRemove(entity);
  }
}

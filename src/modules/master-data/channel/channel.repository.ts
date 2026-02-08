import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from '../../../database/entities/channel.entity';

@Injectable()
export class ChannelRepository {
  constructor(
    @InjectRepository(Channel)
    private readonly repository: Repository<Channel>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Channel | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(tenantId: string, activeOnly = false): Promise<Channel[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    return this.repository.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Channel | null> {
    return this.repository.findOne(options);
  }

  create(entity: Partial<Channel>): Channel {
    return this.repository.create(entity);
  }

  async save(entity: Channel): Promise<Channel> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Channel): Promise<Channel> {
    return this.repository.softRemove(entity);
  }
}

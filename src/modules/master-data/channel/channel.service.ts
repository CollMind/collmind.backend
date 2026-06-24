import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ChannelRepository } from './channel.repository';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { Channel } from '../../../database/entities/channel.entity';
import { AdminAuditService } from '../../../common/services/admin-audit.service';

@Injectable()
export class ChannelService {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly auditService: AdminAuditService,
  ) {}

  async create(
    tenantId: string,
    createChannelDto: CreateChannelDto,
    userId?: string,
    userEmail?: string,
    ipAddress?: string,
  ): Promise<Channel> {
    const existing = await this.channelRepository.findByCode(
      tenantId,
      createChannelDto.code,
    );
    if (existing) {
      throw new ConflictException('Channel with this code already exists');
    }

    const channel = this.channelRepository.create({
      ...createChannelDto,
      tenantId,
      sortOrder: createChannelDto.sortOrder ?? 0,
      isActive: createChannelDto.isActive ?? true,
    });

    const savedChannel = await this.channelRepository.save(channel);

    // Audit log: Master data değişiklikleri audit log'a yazılmalı
    if (userId && userEmail) {
      await this.auditService.logAdminAction(
        tenantId,
        userId,
        userEmail,
        'CREATE',
        'CHANNEL',
        savedChannel.id,
        ipAddress,
        'SUCCESS',
        undefined,
        { code: savedChannel.code, name: savedChannel.name },
      );
    }

    return savedChannel;
  }

  async findAll(tenantId: string, activeOnly = false): Promise<Channel[]> {
    return this.channelRepository.findAllByTenant(tenantId, activeOnly);
  }

  async findOne(tenantId: string, id: string): Promise<Channel> {
    const channel = await this.channelRepository.findOne({
      where: { tenantId, id },
    });

    if (!channel) {
      throw new NotFoundException(`Channel with ID ${id} not found`);
    }

    return channel;
  }

  async update(
    tenantId: string,
    id: string,
    updateChannelDto: UpdateChannelDto,
    userId?: string,
    userEmail?: string,
    ipAddress?: string,
  ): Promise<Channel> {
    const channel = await this.findOne(tenantId, id);
    const beforeValues = {
      code: channel.code,
      name: channel.name,
      isActive: channel.isActive,
    };

    if (updateChannelDto.code && updateChannelDto.code !== channel.code) {
      const existing = await this.channelRepository.findByCode(
        tenantId,
        updateChannelDto.code,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException('Channel with this code already exists');
      }
    }

    Object.assign(channel, updateChannelDto);
    const savedChannel = await this.channelRepository.save(channel);

    // Audit log
    if (userId && userEmail) {
      await this.auditService.logAdminAction(
        tenantId,
        userId,
        userEmail,
        'UPDATE',
        'CHANNEL',
        savedChannel.id,
        ipAddress,
        'SUCCESS',
        beforeValues,
        {
          code: savedChannel.code,
          name: savedChannel.name,
          isActive: savedChannel.isActive,
        },
      );
    }

    return savedChannel;
  }

  async remove(
    tenantId: string,
    id: string,
    userId?: string,
    userEmail?: string,
    ipAddress?: string,
  ): Promise<void> {
    const channel = await this.findOne(tenantId, id);
    const beforeValues = { code: channel.code, name: channel.name };

    await this.channelRepository.softRemove(channel);

    // Audit log
    if (userId && userEmail) {
      await this.auditService.logAdminAction(
        tenantId,
        userId,
        userEmail,
        'DELETE',
        'CHANNEL',
        id,
        ipAddress,
        'SUCCESS',
        beforeValues,
        undefined,
      );
    }
  }
}

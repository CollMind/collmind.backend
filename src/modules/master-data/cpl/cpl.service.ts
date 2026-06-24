import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CplRepository } from './cpl.repository';
import { CreateCplDto } from './dto/create-cpl.dto';
import { UpdateCplDto } from './dto/update-cpl.dto';
import { Cpl } from '../../../database/entities/cpl.entity';
import { ChannelRepository } from '../channel/channel.repository';
import { CustomerRepository } from '../../customer/customer.repository';

@Injectable()
export class CplService {
  constructor(
    private readonly cplRepository: CplRepository,
    private readonly channelRepository: ChannelRepository,
    private readonly customerRepository: CustomerRepository,
  ) {}

  async create(tenantId: string, createCplDto: CreateCplDto): Promise<Cpl> {
    const existing = await this.cplRepository.findByCode(
      tenantId,
      createCplDto.code,
    );
    if (existing) {
      throw new ConflictException('CPL with this code already exists');
    }

    // Validate channel exists
    const channel = await this.channelRepository.findOne({
      where: { tenantId, id: createCplDto.channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const cpl = this.cplRepository.create({
      ...createCplDto,
      tenantId,
      status: createCplDto.status || 'ACTIVE',
      isVip: createCplDto.isVip ?? false,
    });

    const savedCpl = await this.cplRepository.save(cpl);

    // Assign customers to CPL if provided
    if (createCplDto.customerIds && createCplDto.customerIds.length > 0) {
      await Promise.all(
        createCplDto.customerIds.map(async (customerId) => {
          const customer = await this.customerRepository.findOne({
            where: { tenantId, id: customerId },
          });
          if (customer) {
            customer.cplId = savedCpl.id;
            await this.customerRepository.save(customer);
          }
        }),
      );
    }

    return savedCpl;
  }

  async findAll(
    tenantId: string,
    activeOnly = false,
    channelId?: string,
  ): Promise<Cpl[]> {
    return this.cplRepository.findAllByTenant(tenantId, activeOnly, channelId);
  }

  async findOne(tenantId: string, id: string): Promise<Cpl> {
    const cpl = await this.cplRepository.findOne({
      where: { tenantId, id },
      relations: ['channel'],
    });

    if (!cpl) {
      throw new NotFoundException(`CPL with ID ${id} not found`);
    }

    return cpl;
  }

  async update(
    tenantId: string,
    id: string,
    updateCplDto: UpdateCplDto,
  ): Promise<Cpl> {
    const cpl = await this.findOne(tenantId, id);

    if (updateCplDto.code && updateCplDto.code !== cpl.code) {
      const existing = await this.cplRepository.findByCode(
        tenantId,
        updateCplDto.code,
      );
      if (existing && existing.id !== id) {
        throw new ConflictException('CPL with this code already exists');
      }
    }

    if (updateCplDto.channelId) {
      const channel = await this.channelRepository.findOne({
        where: { tenantId, id: updateCplDto.channelId },
      });
      if (!channel) {
        throw new NotFoundException('Channel not found');
      }
    }

    Object.assign(cpl, updateCplDto);
    return this.cplRepository.save(cpl);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const cpl = await this.findOne(tenantId, id);
    await this.cplRepository.softRemove(cpl);
  }
}

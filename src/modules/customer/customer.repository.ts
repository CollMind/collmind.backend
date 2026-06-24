import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { CustomerFilterDto } from './dto/customer-filter.dto';

@Injectable()
export class CustomerRepository {
  constructor(
    @InjectRepository(Customer)
    private readonly repository: Repository<Customer>,
  ) {}

  async findByCode(tenantId: string, code: string): Promise<Customer | null> {
    return this.repository.findOne({ where: { tenantId, code } });
  }

  async findAllByTenant(tenantId: string): Promise<Customer[]> {
    return this.repository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(options: any): Promise<Customer | null> {
    return this.repository.findOne(options);
  }

  async find(options?: any): Promise<Customer[]> {
    return this.repository.find(options);
  }

  create(entity: Partial<Customer>): Customer {
    return this.repository.create(entity);
  }

  async save(entity: Customer): Promise<Customer> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Customer): Promise<Customer> {
    return this.repository.softRemove(entity);
  }

  async findWithFilters(tenantId: string, filters: CustomerFilterDto) {
    const queryBuilder = this.repository
      .createQueryBuilder('customer')
      .leftJoinAndSelect('customer.cpl', 'cpl')
      .where('customer.tenantId = :tenantId', { tenantId })
      .andWhere('customer.deletedAt IS NULL');

    if (filters.channel) {
      queryBuilder.andWhere('customer.channel = :channel', {
        channel: filters.channel,
      });
    }

    if (filters.city) {
      queryBuilder.andWhere('customer.city = :city', { city: filters.city });
    }

    if (filters.region) {
      queryBuilder.andWhere('customer.region = :region', {
        region: filters.region,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('customer.status = :status', {
        status: filters.status,
      });
    }

    if (filters.tier) {
      queryBuilder.andWhere('customer.customerTier = :tier', {
        tier: filters.tier,
      });
    }

    if (filters.isVip !== undefined) {
      queryBuilder.andWhere('customer.isVip = :isVip', {
        isVip: filters.isVip,
      });
    }

    if (filters.search) {
      queryBuilder.andWhere(
        '(customer.name ILIKE :search OR customer.code ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    const sortOrder = filters.sortOrder || 'ASC';
    const sortBy = filters.sortBy || 'name';
    queryBuilder.orderBy(`customer.${sortBy}`, sortOrder);

    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    queryBuilder.skip(skip).take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findByChannel(tenantId: string, channel: string): Promise<Customer[]> {
    return this.repository.find({
      where: { tenantId, channel: channel as any },
      relations: ['cpl'],
      order: { name: 'ASC' },
    });
  }

  async findByChannelId(
    tenantId: string,
    channelId: string,
  ): Promise<Customer[]> {
    // First, get the channel to find its code
    const channel = await this.repository.manager
      .createQueryBuilder()
      .select('channel.code', 'code')
      .from('main.channels', 'channel')
      .where('channel.id = :channelId', { channelId })
      .andWhere('channel.tenant_id = :tenantId', { tenantId })
      .getRawOne();

    if (!channel || !channel.code) {
      return [];
    }

    // Then find customers with matching channel enum value
    return this.repository.find({
      where: { tenantId, channel: channel.code as any },
      relations: ['cpl'],
      order: { name: 'ASC' },
    });
  }

  async findByCity(tenantId: string, city: string): Promise<Customer[]> {
    return this.repository.find({
      where: { tenantId, city },
      order: { name: 'ASC' },
    });
  }

  async findVipCustomers(tenantId: string): Promise<Customer[]> {
    return this.repository.find({
      where: { tenantId, isVip: true },
      order: { name: 'ASC' },
    });
  }

  async getCplList(
    tenantId: string,
    channel?: string,
    categoryId?: string,
  ): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
      channel: string;
      customerCount: number;
      activeAgreementCount: number;
    }>
  > {
    // Get distinct customers (CPLs) grouped by code
    const query = this.repository
      .createQueryBuilder('customer')
      .select('customer.id', 'id')
      .addSelect('customer.code', 'code')
      .addSelect('customer.name', 'name')
      .addSelect('customer.channel', 'channel')
      .where('customer.tenantId = :tenantId', { tenantId })
      .andWhere('customer.deletedAt IS NULL')
      .groupBy('customer.id')
      .addGroupBy('customer.code')
      .addGroupBy('customer.name')
      .addGroupBy('customer.channel');

    if (channel) {
      // Check if channel is a UUID (channelId) or an enum value
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          channel,
        );

      if (isUuid) {
        // If it's a UUID, join with CPL table and filter by channelId
        query
          .leftJoin('customer.cpl', 'cpl')
          .andWhere('cpl.channelId = :channelId', { channelId: channel });
      } else {
        // If it's an enum value, filter directly by channel field
        query.andWhere('customer.channel = :channel', { channel });
      }
    }

    const customers = await query.getRawMany();

    // Get customer count and active agreement count for each CPL
    const result = await Promise.all(
      customers.map(async (cpl) => {
        // Count customers with same code (branches)
        const customerCount = await this.repository.count({
          where: { tenantId, code: cpl.code, deletedAt: null as any },
        });

        // Count active agreements for this CPL
        const activeAgreementCount = await this.repository.manager
          .createQueryBuilder()
          .select('COUNT(*)', 'count')
          .from('main.agreements', 'agreement')
          .where('agreement.cpl_id = :cplId', { cplId: cpl.id })
          .andWhere('agreement.tenant_id = :tenantId', { tenantId })
          .andWhere('agreement.status = :status', { status: 'ACTIVE' })
          .andWhere('agreement.deleted_at IS NULL')
          .getRawOne();

        return {
          id: cpl.id,
          code: cpl.code,
          name: cpl.name,
          channel: cpl.channel,
          customerCount: customerCount || 0,
          activeAgreementCount: parseInt(
            activeAgreementCount?.count || '0',
            10,
          ),
        };
      }),
    );

    return result;
  }
}

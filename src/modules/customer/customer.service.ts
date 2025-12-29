import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CustomerRepository } from './customer.repository';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerFilterDto } from './dto/customer-filter.dto';
import { Customer, CustomerStatus } from '../../database/entities/customer.entity';

@Injectable()
export class CustomerService {
  constructor(private readonly customerRepository: CustomerRepository) {}

  private convertDateFields(dto: CreateCustomerDto | UpdateCustomerDto): Partial<Customer> {
    const { lastOrderDate, firstOrderDate, contractStartDate, contractEndDate, ...rest } = dto;
    
    return {
      ...rest,
      ...(lastOrderDate && { lastOrderDate: new Date(lastOrderDate) }),
      ...(firstOrderDate && { firstOrderDate: new Date(firstOrderDate) }),
      ...(contractStartDate && { contractStartDate: new Date(contractStartDate) }),
      ...(contractEndDate && { contractEndDate: new Date(contractEndDate) }),
    };
  }

  async create(tenantId: string, createCustomerDto: CreateCustomerDto): Promise<Customer> {
    // Check if customer with same code exists
    const existing = await this.customerRepository.findByCode(tenantId, createCustomerDto.code);
    if (existing) {
      throw new ConflictException('Customer with this code already exists');
    }

    const customer = this.customerRepository.create({
      ...this.convertDateFields(createCustomerDto),
      tenantId,
    });

    return this.customerRepository.save(customer);
  }

  async createBulk(tenantId: string, customers: CreateCustomerDto[]): Promise<Customer[]> {
    const createdCustomers: Customer[] = [];

    for (const customerDto of customers) {
      const existing = await this.customerRepository.findByCode(tenantId, customerDto.code);
      if (!existing) {
        const customer = this.customerRepository.create({
          ...this.convertDateFields(customerDto),
          tenantId,
        });
        createdCustomers.push(await this.customerRepository.save(customer));
      }
    }

    return createdCustomers;
  }

  async findAll(tenantId: string, filters?: CustomerFilterDto): Promise<any> {
    if (filters) {
      return this.customerRepository.findWithFilters(tenantId, filters);
    }
    return this.customerRepository.findAllByTenant(tenantId);
  }

  async findOne(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { tenantId, id },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return customer;
  }

  async findByCode(tenantId: string, code: string): Promise<Customer> {
    const customer = await this.customerRepository.findByCode(tenantId, code);

    if (!customer) {
      throw new NotFoundException(`Customer with code ${code} not found`);
    }

    return customer;
  }

  async update(
    tenantId: string,
    id: string,
    updateCustomerDto: UpdateCustomerDto,
  ): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);

    // Check code uniqueness if changing
    if (updateCustomerDto.code && updateCustomerDto.code !== customer.code) {
      const existing = await this.customerRepository.findByCode(tenantId, updateCustomerDto.code);
      if (existing) {
        throw new ConflictException('Customer with this code already exists');
      }
    }

    Object.assign(customer, this.convertDateFields(updateCustomerDto));
    return this.customerRepository.save(customer);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const customer = await this.findOne(tenantId, id);
    await this.customerRepository.softRemove(customer);
  }

  async activate(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);
    customer.status = CustomerStatus.ACTIVE;
    return this.customerRepository.save(customer);
  }

  async deactivate(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);
    customer.status = CustomerStatus.INACTIVE;
    return this.customerRepository.save(customer);
  }

  async findByChannel(tenantId: string, channel: string): Promise<Customer[]> {
    return this.customerRepository.findByChannel(tenantId, channel);
  }

  async findByCity(tenantId: string, city: string): Promise<Customer[]> {
    return this.customerRepository.findByCity(tenantId, city);
  }

  async findVipCustomers(tenantId: string): Promise<Customer[]> {
    return this.customerRepository.findVipCustomers(tenantId);
  }

  async getStats(tenantId: string, id: string): Promise<any> {
    const customer = await this.findOne(tenantId, id);

    return {
      customerId: customer.id,
      totalOrders: customer.totalOrders,
      lastOrderDate: customer.lastOrderDate,
      firstOrderDate: customer.firstOrderDate,
      annualRevenue: customer.annualRevenue,
    };
  }
}


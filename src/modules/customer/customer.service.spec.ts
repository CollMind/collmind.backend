import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { CustomerRepository } from './customer.repository';
import { FileParserService } from './services/file-parser.service';
import { Customer, CustomerStatus, CustomerChannel } from '../../database/entities/customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerFilterDto } from './dto/customer-filter.dto';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

describe('CustomerService', () => {
  let service: CustomerService;
  let customerRepository: jest.Mocked<CustomerRepository>;
  let fileParserService: jest.Mocked<FileParserService>;

  const mockTenantId = 'tenant-123';
  const mockCustomerId = 'customer-123';
  const mockCustomer: Customer = {
    id: mockCustomerId,
    code: 'CUST001',
    name: 'Test Customer',
    channel: CustomerChannel.RETAIL,
    status: CustomerStatus.ACTIVE,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    totalOrders: 0,
    annualRevenue: 0,
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        {
          provide: CustomerRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findByCode: jest.fn(),
            findOne: jest.fn(),
            findAllByTenant: jest.fn(),
            findWithFilters: jest.fn(),
            findByChannel: jest.fn(),
            findByChannelId: jest.fn(),
            findByCity: jest.fn(),
            findVipCustomers: jest.fn(),
            softRemove: jest.fn(),
            getCplList: jest.fn(),
          },
        },
        {
          provide: FileParserService,
          useValue: {
            parseExcel: jest.fn(),
            parseCSV: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    customerRepository = module.get(CustomerRepository) as jest.Mocked<CustomerRepository>;
    fileParserService = module.get(FileParserService) as jest.Mocked<FileParserService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createCustomerDto: CreateCustomerDto = {
      code: 'CUST001',
      name: 'New Customer',
      channel: CustomerChannel.RETAIL,
    };

    it('should create a new customer successfully', async () => {
      customerRepository.findByCode.mockResolvedValue(null);
      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      const result = await service.create(mockTenantId, createCustomerDto);

      expect(customerRepository.findByCode).toHaveBeenCalledWith(
        mockTenantId,
        createCustomerDto.code,
      );
      expect(customerRepository.create).toHaveBeenCalled();
      expect(customerRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockCustomer);
    });

    it('should throw ConflictException if customer with code already exists', async () => {
      customerRepository.findByCode.mockResolvedValue(mockCustomer);

      await expect(service.create(mockTenantId, createCustomerDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should convert date fields correctly', async () => {
      const dtoWithDates: CreateCustomerDto = {
        ...createCustomerDto,
        lastOrderDate: '2024-01-15',
        firstOrderDate: '2023-01-01',
      };

      customerRepository.findByCode.mockResolvedValue(null);
      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      await service.create(mockTenantId, dtoWithDates);

      expect(customerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lastOrderDate: expect.any(Date),
          firstOrderDate: expect.any(Date),
        }),
      );
    });
  });

  describe('createBulk', () => {
    const customers: CreateCustomerDto[] = [
      { code: 'CUST001', name: 'Customer 1', channel: CustomerChannel.RETAIL },
      { code: 'CUST002', name: 'Customer 2', channel: CustomerChannel.WHOLESALE },
    ];

    it('should create multiple customers successfully', async () => {
      customerRepository.findByCode.mockResolvedValue(null);
      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      const result = await service.createBulk(mockTenantId, customers);

      expect(customerRepository.findByCode).toHaveBeenCalledTimes(2);
      expect(customerRepository.save).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('should skip existing customers', async () => {
      customerRepository.findByCode
        .mockResolvedValueOnce(mockCustomer) // First customer exists
        .mockResolvedValueOnce(null); // Second customer is new

      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      const result = await service.createBulk(mockTenantId, customers);

      expect(result).toHaveLength(1);
    });
  });

  describe('findAll', () => {
    it('should return all customers when no filters provided', async () => {
      const customers = [mockCustomer];
      customerRepository.findAllByTenant.mockResolvedValue(customers as any);

      const result = await service.findAll(mockTenantId);

      expect(customerRepository.findAllByTenant).toHaveBeenCalledWith(mockTenantId);
      expect(result).toEqual(customers);
    });

    it('should use filters when provided', async () => {
      const filters: CustomerFilterDto = {
        channel: CustomerChannel.RETAIL,
        city: 'Istanbul',
      };
      const customers = [mockCustomer];

      customerRepository.findWithFilters.mockResolvedValue(customers as any);

      const result = await service.findAll(mockTenantId, filters);

      expect(customerRepository.findWithFilters).toHaveBeenCalledWith(
        mockTenantId,
        filters,
      );
      expect(result).toEqual(customers);
    });

    it('should not use filters when only pagination params provided', async () => {
      const filters: CustomerFilterDto = {
        page: 1,
        limit: 10,
      };
      const customers = [mockCustomer];

      customerRepository.findAllByTenant.mockResolvedValue(customers as any);

      const result = await service.findAll(mockTenantId, filters);

      expect(customerRepository.findAllByTenant).toHaveBeenCalledWith(mockTenantId);
      expect(customerRepository.findWithFilters).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return customer by id', async () => {
      customerRepository.findOne.mockResolvedValue(mockCustomer);

      const result = await service.findOne(mockTenantId, mockCustomerId);

      expect(customerRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId, id: mockCustomerId },
      });
      expect(result).toEqual(mockCustomer);
    });

    it('should throw NotFoundException if customer not found', async () => {
      customerRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(mockTenantId, mockCustomerId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByCode', () => {
    it('should return customer by code', async () => {
      customerRepository.findByCode.mockResolvedValue(mockCustomer);

      const result = await service.findByCode(mockTenantId, 'CUST001');

      expect(customerRepository.findByCode).toHaveBeenCalledWith(mockTenantId, 'CUST001');
      expect(result).toEqual(mockCustomer);
    });

    it('should throw NotFoundException if customer not found', async () => {
      customerRepository.findByCode.mockResolvedValue(null);

      await expect(service.findByCode(mockTenantId, 'INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const updateCustomerDto: UpdateCustomerDto = {
      name: 'Updated Customer Name',
    };

    it('should update customer successfully', async () => {
      customerRepository.findOne.mockResolvedValue(mockCustomer);
      customerRepository.save.mockResolvedValue({ ...mockCustomer, ...updateCustomerDto } as any);

      const result = await service.update(mockTenantId, mockCustomerId, updateCustomerDto);

      expect(customerRepository.findOne).toHaveBeenCalled();
      expect(customerRepository.save).toHaveBeenCalled();
      expect(result.name).toBe(updateCustomerDto.name);
    });

    it('should check code uniqueness when updating code', async () => {
      const updateDto: UpdateCustomerDto = { code: 'NEWCODE' };
      const existingCustomer = { ...mockCustomer, code: 'OLDCODE' };
      const conflictingCustomer = { ...mockCustomer, id: 'other-id', code: 'NEWCODE' };

      customerRepository.findOne.mockResolvedValue(existingCustomer);
      customerRepository.findByCode.mockResolvedValue(conflictingCustomer);

      await expect(
        service.update(mockTenantId, mockCustomerId, updateDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should soft remove customer', async () => {
      customerRepository.findOne.mockResolvedValue(mockCustomer);
      customerRepository.softRemove.mockResolvedValue(mockCustomer);

      await service.remove(mockTenantId, mockCustomerId);

      expect(customerRepository.softRemove).toHaveBeenCalledWith(mockCustomer);
    });
  });

  describe('activate', () => {
    it('should activate customer', async () => {
      const inactiveCustomer = { ...mockCustomer, status: CustomerStatus.INACTIVE };
      customerRepository.findOne.mockResolvedValue(inactiveCustomer);
      customerRepository.save.mockResolvedValue({
        ...inactiveCustomer,
        status: CustomerStatus.ACTIVE,
      } as any);

      const result = await service.activate(mockTenantId, mockCustomerId);

      expect(result.status).toBe(CustomerStatus.ACTIVE);
    });
  });

  describe('deactivate', () => {
    it('should deactivate customer', async () => {
      customerRepository.findOne.mockResolvedValue(mockCustomer);
      customerRepository.save.mockResolvedValue({
        ...mockCustomer,
        status: CustomerStatus.INACTIVE,
      } as any);

      const result = await service.deactivate(mockTenantId, mockCustomerId);

      expect(result.status).toBe(CustomerStatus.INACTIVE);
    });
  });

  describe('findByChannel', () => {
    it('should return customers by channel', async () => {
      const customers = [mockCustomer];
      customerRepository.findByChannel.mockResolvedValue(customers as any);

      const result = await service.findByChannel(mockTenantId, CustomerChannel.RETAIL);

      expect(customerRepository.findByChannel).toHaveBeenCalledWith(mockTenantId, CustomerChannel.RETAIL);
      expect(result).toEqual(customers);
    });
  });

  describe('findVipCustomers', () => {
    it('should return VIP customers', async () => {
      const vipCustomers = [mockCustomer];
      customerRepository.findVipCustomers.mockResolvedValue(vipCustomers as any);

      const result = await service.findVipCustomers(mockTenantId);

      expect(customerRepository.findVipCustomers).toHaveBeenCalledWith(mockTenantId);
      expect(result).toEqual(vipCustomers);
    });
  });

  describe('getStats', () => {
    it('should return customer statistics', async () => {
      const customerWithStats = {
        ...mockCustomer,
        totalOrders: 100,
        lastOrderDate: new Date('2024-01-15'),
        firstOrderDate: new Date('2023-01-01'),
        annualRevenue: 50000,
      };

      customerRepository.findOne.mockResolvedValue(customerWithStats as any);

      const result = await service.getStats(mockTenantId, mockCustomerId);

      expect(result).toHaveProperty('customerId');
      expect(result).toHaveProperty('totalOrders');
      expect(result).toHaveProperty('lastOrderDate');
      expect(result).toHaveProperty('firstOrderDate');
      expect(result).toHaveProperty('annualRevenue');
    });
  });

  describe('importFromFile', () => {
    const mockFile: Express.Multer.File = {
      originalname: 'customers.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('mock file content'),
      size: 1024,
      fieldname: 'file',
      encoding: '7bit',
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    it('should import customers from Excel file successfully', async () => {
      const parsedCustomers = [
        {
          dto: { code: 'CUST001', name: 'Customer 1', channel: CustomerChannel.RETAIL },
          originalRowNumber: 2,
        },
        {
          dto: { code: 'CUST002', name: 'Customer 2', channel: CustomerChannel.WHOLESALE },
          originalRowNumber: 3,
        },
      ];

      fileParserService.parseExcel.mockResolvedValue(parsedCustomers as any);
      customerRepository.findByCode.mockResolvedValue(null);
      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      const result = await service.importFromFile(mockTenantId, mockFile);

      expect(fileParserService.parseExcel).toHaveBeenCalledWith(mockFile);
      expect(result.total).toBe(2);
      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should import customers from CSV file successfully', async () => {
      const csvFile = { ...mockFile, originalname: 'customers.csv' };
      const parsedCustomers = [
        {
          dto: { code: 'CUST001', name: 'Customer 1', channel: 'RETAIL' },
          originalRowNumber: 2,
        },
      ];

      fileParserService.parseCSV.mockResolvedValue(parsedCustomers as any);
      customerRepository.findByCode.mockResolvedValue(null);
      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      const result = await service.importFromFile(mockTenantId, csvFile);

      expect(fileParserService.parseCSV).toHaveBeenCalledWith(csvFile);
      expect(result.created).toBe(1);
    });

    it('should throw BadRequestException if file is not provided', async () => {
      await expect(service.importFromFile(mockTenantId, null as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for unsupported file format', async () => {
      const unsupportedFile = { ...mockFile, originalname: 'customers.pdf' };

      await expect(service.importFromFile(mockTenantId, unsupportedFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should validate customer data and return errors for invalid rows', async () => {
      const parsedCustomers = [
        {
          dto: { code: '', name: 'Customer 1', channel: CustomerChannel.RETAIL }, // Missing code
          originalRowNumber: 2,
        },
        {
          dto: { code: 'CUST002', name: '', channel: CustomerChannel.WHOLESALE }, // Missing name
          originalRowNumber: 3,
        },
        {
          dto: { code: 'CUST003', name: 'Customer 3', channel: CustomerChannel.RETAIL }, // Valid
          originalRowNumber: 4,
        },
      ];

      fileParserService.parseExcel.mockResolvedValue(parsedCustomers as any);
      customerRepository.findByCode.mockResolvedValue(null);
      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      const result = await service.importFromFile(mockTenantId, mockFile);

      expect(result.total).toBe(3);
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(2);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect duplicate codes in file', async () => {
      const parsedCustomers = [
        {
          dto: { code: 'CUST001', name: 'Customer 1', channel: CustomerChannel.RETAIL },
          originalRowNumber: 2,
        },
        {
          dto: { code: 'CUST001', name: 'Customer 2', channel: CustomerChannel.WHOLESALE }, // Duplicate
          originalRowNumber: 3,
        },
      ];

      fileParserService.parseExcel.mockResolvedValue(parsedCustomers as any);
      customerRepository.findByCode.mockResolvedValue(null);
      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      const result = await service.importFromFile(mockTenantId, mockFile);

      expect(result.errors.some((e) => e.error_type === 'DUPLICATE_IN_FILE')).toBe(true);
    });

    it('should skip customers that already exist in database', async () => {
      const parsedCustomers = [
        {
          dto: { code: 'CUST001', name: 'Customer 1', channel: 'RETAIL' },
          originalRowNumber: 2,
        },
      ];

      fileParserService.parseExcel.mockResolvedValue(parsedCustomers as any);
      customerRepository.findByCode.mockResolvedValue(mockCustomer); // Already exists
      customerRepository.create.mockReturnValue(mockCustomer);
      customerRepository.save.mockResolvedValue(mockCustomer);

      const result = await service.importFromFile(mockTenantId, mockFile);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors.some((e) => e.error_type === 'ALREADY_EXISTS')).toBe(true);
    });

    it('should validate date formats', async () => {
      const parsedCustomers = [
        {
          dto: {
            code: 'CUST001',
            name: 'Customer 1',
            channel: CustomerChannel.RETAIL,
            lastOrderDate: 'invalid-date',
          },
          originalRowNumber: 2,
        },
      ];

      fileParserService.parseExcel.mockResolvedValue(parsedCustomers as any);

      const result = await service.importFromFile(mockTenantId, mockFile);

      expect(result.errors.some((e) => e.error_type === 'INVALID_DATE')).toBe(true);
    });

    it('should validate email format', async () => {
      const parsedCustomers = [
        {
          dto: {
            code: 'CUST001',
            name: 'Customer 1',
            channel: CustomerChannel.RETAIL,
            contactEmail: 'invalid-email',
          },
          originalRowNumber: 2,
        },
      ];

      fileParserService.parseExcel.mockResolvedValue(parsedCustomers as any);

      const result = await service.importFromFile(mockTenantId, mockFile);

      expect(result.errors.some((e) => e.error_type === 'INVALID_EMAIL')).toBe(true);
    });
  });

  describe('getCplList', () => {
    it('should return CPL list', async () => {
      const cplList = [
        {
          id: 'cpl-1',
          code: 'CPL001',
          name: 'CPL 1',
          channel: CustomerChannel.RETAIL,
          customerCount: 10,
          activeAgreementCount: 5,
        },
      ];

      customerRepository.getCplList.mockResolvedValue(cplList);

      const result = await service.getCplList(mockTenantId);

      expect(customerRepository.getCplList).toHaveBeenCalledWith(mockTenantId, undefined, undefined);
      expect(result).toEqual(cplList);
    });

    it('should filter CPL list by channel and category', async () => {
      const cplList: Array<{
        id: string;
        code: string;
        name: string;
        channel: string;
        customerCount: number;
        activeAgreementCount: number;
      }> = [];
      customerRepository.getCplList.mockResolvedValue(cplList);

      const result = await service.getCplList(mockTenantId, CustomerChannel.RETAIL, 'cat-1');

      expect(customerRepository.getCplList).toHaveBeenCalledWith(
        mockTenantId,
        CustomerChannel.RETAIL,
        'cat-1',
      );
      expect(result).toEqual(cplList);
    });
  });
});

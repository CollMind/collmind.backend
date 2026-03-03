import { Test, TestingModule } from '@nestjs/testing';
import { TenantService } from './tenant.service';
import { TenantRepository } from './tenant.repository';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('TenantService', () => {
  let service: TenantService;
  let tenantRepository: jest.Mocked<TenantRepository>;

  const mockTenantId = 'tenant-123';
  const mockTenant: Tenant = {
    id: mockTenantId,
    name: 'Test Tenant',
    domain: 'test-tenant',
    status: TenantStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        {
          provide: TenantRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findByName: jest.fn(),
            findByDomain: jest.fn(),
            softRemove: jest.fn(),
            getTenantStats: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);
    tenantRepository = module.get(TenantRepository) as jest.Mocked<TenantRepository>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createTenantDto: CreateTenantDto = {
      name: 'New Tenant',
      domain: 'new-tenant',
    };

    it('should create a new tenant successfully', async () => {
      tenantRepository.findByName.mockResolvedValue(null);
      tenantRepository.findByDomain.mockResolvedValue(null);
      tenantRepository.create.mockReturnValue(mockTenant);
      tenantRepository.save.mockResolvedValue(mockTenant);

      const result = await service.create(createTenantDto);

      expect(tenantRepository.findByName).toHaveBeenCalledWith(createTenantDto.name);
      expect(tenantRepository.findByDomain).toHaveBeenCalledWith(createTenantDto.domain);
      expect(tenantRepository.create).toHaveBeenCalled();
      expect(tenantRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockTenant);
    });

    it('should throw ConflictException if tenant with name already exists', async () => {
      tenantRepository.findByName.mockResolvedValue(mockTenant);

      await expect(service.create(createTenantDto)).rejects.toThrow(ConflictException);
      expect(tenantRepository.findByName).toHaveBeenCalledWith(createTenantDto.name);
    });

    it('should throw ConflictException if domain is already taken', async () => {
      tenantRepository.findByName.mockResolvedValue(null);
      tenantRepository.findByDomain.mockResolvedValue(mockTenant);

      await expect(service.create(createTenantDto)).rejects.toThrow(ConflictException);
      expect(tenantRepository.findByDomain).toHaveBeenCalledWith(createTenantDto.domain);
    });

    it('should convert date strings to Date objects', async () => {
      const dtoWithDates: CreateTenantDto = {
        ...createTenantDto,
        subscriptionStartDate: '2024-01-01',
        subscriptionEndDate: '2024-12-31',
      };

      tenantRepository.findByName.mockResolvedValue(null);
      tenantRepository.findByDomain.mockResolvedValue(null);
      tenantRepository.create.mockReturnValue(mockTenant);
      tenantRepository.save.mockResolvedValue(mockTenant);

      await service.create(dtoWithDates);

      expect(tenantRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionStartDate: expect.any(Date),
          subscriptionEndDate: expect.any(Date),
        }),
      );
    });

    it('should allow creating tenant without domain', async () => {
      const dtoWithoutDomain: CreateTenantDto = {
        name: 'New Tenant',
      };

      tenantRepository.findByName.mockResolvedValue(null);
      tenantRepository.create.mockReturnValue(mockTenant);
      tenantRepository.save.mockResolvedValue(mockTenant);

      const result = await service.create(dtoWithoutDomain);

      expect(tenantRepository.findByDomain).not.toHaveBeenCalled();
      expect(result).toEqual(mockTenant);
    });
  });

  describe('findAll', () => {
    it('should return all tenants', async () => {
      const tenants = [mockTenant];
      tenantRepository.find.mockResolvedValue(tenants);

      const result = await service.findAll();

      expect(tenantRepository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(tenants);
    });
  });

  describe('findOne', () => {
    it('should return tenant by id', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);

      const result = await service.findOne(mockTenantId);

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockTenantId },
        relations: ['users'],
      });
      expect(result).toEqual(mockTenant);
    });

    it('should throw NotFoundException if tenant not found', async () => {
      tenantRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(mockTenantId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const updateTenantDto: UpdateTenantDto = {
      name: 'Updated Tenant Name',
    };

    it('should update tenant successfully', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);
      tenantRepository.save.mockResolvedValue({ ...mockTenant, ...updateTenantDto } as any);

      const result = await service.update(mockTenantId, updateTenantDto);

      expect(tenantRepository.findOne).toHaveBeenCalled();
      expect(tenantRepository.save).toHaveBeenCalled();
      expect(result.name).toBe(updateTenantDto.name);
    });

    it('should check name uniqueness when updating name', async () => {
      const updateDto: UpdateTenantDto = { name: 'New Name' };
      const existingTenant = { ...mockTenant, name: 'Old Name' };
      const conflictingTenant = { ...mockTenant, id: 'other-id', name: 'New Name' };

      tenantRepository.findOne.mockResolvedValue(existingTenant);
      tenantRepository.findByName.mockResolvedValue(conflictingTenant);

      await expect(service.update(mockTenantId, updateDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should check domain uniqueness when updating domain', async () => {
      const updateDto: UpdateTenantDto = { domain: 'new-domain' };
      const existingTenant = { ...mockTenant, domain: 'old-domain' };
      const conflictingTenant = { ...mockTenant, id: 'other-id', domain: 'new-domain' };

      tenantRepository.findOne.mockResolvedValue(existingTenant);
      tenantRepository.findByDomain.mockResolvedValue(conflictingTenant);

      await expect(service.update(mockTenantId, updateDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should allow updating without changing name or domain', async () => {
      const updateDto: UpdateTenantDto = { status: TenantStatus.SUSPENDED };

      tenantRepository.findOne.mockResolvedValue(mockTenant);
      tenantRepository.save.mockResolvedValue({ ...mockTenant, ...updateDto } as any);

      const result = await service.update(mockTenantId, updateDto);

      expect(tenantRepository.findByName).not.toHaveBeenCalled();
      expect(tenantRepository.findByDomain).not.toHaveBeenCalled();
      expect(result.status).toBe(TenantStatus.SUSPENDED);
    });
  });

  describe('remove', () => {
    it('should soft remove tenant', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);
      tenantRepository.softRemove.mockResolvedValue(mockTenant);

      await service.remove(mockTenantId);

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockTenantId },
        relations: ['users'],
      });
      expect(tenantRepository.softRemove).toHaveBeenCalledWith(mockTenant);
    });
  });

  describe('activate', () => {
    it('should activate tenant', async () => {
      const suspendedTenant = { ...mockTenant, status: TenantStatus.SUSPENDED };
      tenantRepository.findOne.mockResolvedValue(suspendedTenant);
      tenantRepository.save.mockResolvedValue({
        ...suspendedTenant,
        status: TenantStatus.ACTIVE,
      } as any);

      const result = await service.activate(mockTenantId);

      expect(result.status).toBe(TenantStatus.ACTIVE);
    });
  });

  describe('suspend', () => {
    it('should suspend tenant', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);
      tenantRepository.save.mockResolvedValue({
        ...mockTenant,
        status: TenantStatus.SUSPENDED,
      } as any);

      const result = await service.suspend(mockTenantId);

      expect(result.status).toBe(TenantStatus.SUSPENDED);
    });
  });

  describe('getStats', () => {
    it('should return tenant statistics', async () => {
      const stats = {
        totalUsers: 10,
        activeUsers: 8,
        totalCustomers: 50,
        activeCustomers: 45,
      };

      tenantRepository.getTenantStats.mockResolvedValue(stats);

      const result = await service.getStats(mockTenantId);

      expect(tenantRepository.getTenantStats).toHaveBeenCalledWith(mockTenantId);
      expect(result).toEqual(stats);
    });
  });
});

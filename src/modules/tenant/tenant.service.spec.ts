import { Test, TestingModule } from '@nestjs/testing';
import { TenantService } from './tenant.service';
import { TenantRepository } from './tenant.repository';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

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
    tenantRepository = module.get(
      TenantRepository,
    ) as jest.Mocked<TenantRepository>;
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

      expect(tenantRepository.findByName).toHaveBeenCalledWith(
        createTenantDto.name,
      );
      expect(tenantRepository.findByDomain).toHaveBeenCalledWith(
        createTenantDto.domain,
      );
      expect(tenantRepository.create).toHaveBeenCalled();
      expect(tenantRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockTenant);
    });

    it('should throw ConflictException if tenant with name already exists', async () => {
      tenantRepository.findByName.mockResolvedValue(mockTenant);

      await expect(service.create(createTenantDto)).rejects.toThrow(
        ConflictException,
      );
      expect(tenantRepository.findByName).toHaveBeenCalledWith(
        createTenantDto.name,
      );
    });

    it('should throw ConflictException if domain is already taken', async () => {
      tenantRepository.findByName.mockResolvedValue(null);
      tenantRepository.findByDomain.mockResolvedValue(mockTenant);

      await expect(service.create(createTenantDto)).rejects.toThrow(
        ConflictException,
      );
      expect(tenantRepository.findByDomain).toHaveBeenCalledWith(
        createTenantDto.domain,
      );
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
    // T-307 / Z45 §2: `findAll` no longer lists every tenant in the DB — it
    // returns the caller's OWN tenant (as a 1-element array) or an empty
    // array. `tenants` has no `tenant_id` column, so this is the only place
    // the scope can be enforced (bkz. `tenant.service.ts` başlık yorumu).
    it("returns the caller's own tenant as a single-element array", async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);

      const result = await service.findAll(mockTenantId);

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockTenantId },
      });
      expect(result).toEqual([mockTenant]);
    });

    it('returns an empty array when the caller has no tenant row', async () => {
      tenantRepository.findOne.mockResolvedValue(null);

      const result = await service.findAll('nonexistent-tenant');

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return tenant by id when the caller is that tenant', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);

      const result = await service.findOne(mockTenantId, mockTenantId);

      // [[T-258]] relations: ['users'] KALDIRILDI — tek tüketici ölçüldü
      // ve hiçbiri `.users` okumuyordu; ilişki artık hiç yüklenmiyor.
      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockTenantId },
      });
      expect(result).toEqual(mockTenant);
    });

    it('should throw NotFoundException if tenant not found', async () => {
      tenantRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(mockTenantId, mockTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });

    // T-307 / Z45 §2 — REPRO PİNİ: `T1`'in ADMIN'i `T2`'yi okumaya
    // çalışırsa 403 alır, satır asla katalogdan OKUNMAZ (`tenantRepository.
    // findOne` hiç çağrılmadığı doğrulanıyor — early-return, yarış yok).
    it('[YAPISAL] throws ForbiddenException — and never reads the DB row — for a cross-tenant id (INV-T cross-tenant pin)', async () => {
      await expect(
        service.findOne('T2-id', 'T1-caller-tenant-id'),
      ).rejects.toThrow(ForbiddenException);
      expect(tenantRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const updateTenantDto: UpdateTenantDto = {
      name: 'Updated Tenant Name',
    };

    it('should update tenant successfully', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);
      tenantRepository.save.mockResolvedValue({
        ...mockTenant,
        ...updateTenantDto,
      } as any);

      const result = await service.update(
        mockTenantId,
        updateTenantDto,
        mockTenantId,
      );

      expect(tenantRepository.findOne).toHaveBeenCalled();
      expect(tenantRepository.save).toHaveBeenCalled();
      expect(result.name).toBe(updateTenantDto.name);
    });

    it('should check name uniqueness when updating name', async () => {
      const updateDto: UpdateTenantDto = { name: 'New Name' };
      const existingTenant = { ...mockTenant, name: 'Old Name' };
      const conflictingTenant = {
        ...mockTenant,
        id: 'other-id',
        name: 'New Name',
      };

      tenantRepository.findOne.mockResolvedValue(existingTenant);
      tenantRepository.findByName.mockResolvedValue(conflictingTenant);

      await expect(
        service.update(mockTenantId, updateDto, mockTenantId),
      ).rejects.toThrow(ConflictException);
    });

    it('should check domain uniqueness when updating domain', async () => {
      const updateDto: UpdateTenantDto = { domain: 'new-domain' };
      const existingTenant = { ...mockTenant, domain: 'old-domain' };
      const conflictingTenant = {
        ...mockTenant,
        id: 'other-id',
        domain: 'new-domain',
      };

      tenantRepository.findOne.mockResolvedValue(existingTenant);
      tenantRepository.findByDomain.mockResolvedValue(conflictingTenant);

      await expect(
        service.update(mockTenantId, updateDto, mockTenantId),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow updating without changing name or domain', async () => {
      const updateDto: UpdateTenantDto = { status: TenantStatus.SUSPENDED };

      tenantRepository.findOne.mockResolvedValue(mockTenant);
      tenantRepository.save.mockResolvedValue({
        ...mockTenant,
        ...updateDto,
      } as any);

      const result = await service.update(
        mockTenantId,
        updateDto,
        mockTenantId,
      );

      expect(tenantRepository.findByName).not.toHaveBeenCalled();
      expect(tenantRepository.findByDomain).not.toHaveBeenCalled();
      expect(result.status).toBe(TenantStatus.SUSPENDED);
    });
  });

  describe('remove', () => {
    it('should soft remove tenant', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);
      tenantRepository.softRemove.mockResolvedValue(mockTenant);

      await service.remove(mockTenantId, mockTenantId);

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockTenantId },
      });
      expect(tenantRepository.softRemove).toHaveBeenCalledWith(mockTenant);
    });

    // T-307 headline bug: "a tenant's ADMIN could delete ANOTHER tenant".
    it('[YAPISAL] refuses to remove another tenant (cross-tenant delete pin)', async () => {
      await expect(
        service.remove('T2-id', 'T1-caller-tenant-id'),
      ).rejects.toThrow(ForbiddenException);
      expect(tenantRepository.softRemove).not.toHaveBeenCalled();
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

      const result = await service.activate(mockTenantId, mockTenantId);

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

      const result = await service.suspend(mockTenantId, mockTenantId);

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

      const result = await service.getStats(mockTenantId, mockTenantId);

      expect(tenantRepository.getTenantStats).toHaveBeenCalledWith(
        mockTenantId,
      );
      expect(result).toEqual(stats);
    });
  });
});

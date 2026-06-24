import { Test, TestingModule } from '@nestjs/testing';
import { BrandService } from './brand.service';
import { BrandRepository } from './brand.repository';
import { Brand } from '../../../database/entities/brand.entity';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('BrandService', () => {
  let service: BrandService;
  let brandRepository: jest.Mocked<BrandRepository>;

  const mockTenantId = 'tenant-123';
  const mockBrandId = 'brand-123';
  const mockBrand: Brand = {
    id: mockBrandId,
    code: 'BRAND001',
    name: 'Test Brand',
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandService,
        {
          provide: BrandRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findByCode: jest.fn(),
            findAllByTenant: jest.fn(),
            findOne: jest.fn(),
            softRemove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BrandService>(BrandService);
    brandRepository = module.get(
      BrandRepository,
    ) as jest.Mocked<BrandRepository>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createBrandDto: CreateBrandDto = {
      code: 'BRAND001',
      name: 'New Brand',
    };

    it('should create a new brand successfully', async () => {
      brandRepository.findByCode.mockResolvedValue(null);
      brandRepository.create.mockReturnValue(mockBrand);
      brandRepository.save.mockResolvedValue(mockBrand);

      const result = await service.create(mockTenantId, createBrandDto);

      expect(brandRepository.findByCode).toHaveBeenCalledWith(
        mockTenantId,
        createBrandDto.code,
      );
      expect(brandRepository.create).toHaveBeenCalled();
      expect(brandRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockBrand);
    });

    it('should throw ConflictException if brand with code already exists', async () => {
      brandRepository.findByCode.mockResolvedValue(mockBrand);

      await expect(
        service.create(mockTenantId, createBrandDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return all brands for tenant', async () => {
      const brands = [mockBrand];
      brandRepository.findAllByTenant.mockResolvedValue(brands as any);

      const result = await service.findAll(mockTenantId);

      expect(brandRepository.findAllByTenant).toHaveBeenCalledWith(
        mockTenantId,
        false,
      );
      expect(result).toEqual(brands);
    });
  });

  describe('findOne', () => {
    it('should return brand by id', async () => {
      brandRepository.findOne.mockResolvedValue(mockBrand);

      const result = await service.findOne(mockTenantId, mockBrandId);

      expect(brandRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId, id: mockBrandId },
      });
      expect(result).toEqual(mockBrand);
    });

    it('should throw NotFoundException if brand not found', async () => {
      brandRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(mockTenantId, mockBrandId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const updateBrandDto: UpdateBrandDto = {
      name: 'Updated Brand Name',
    };

    it('should update brand successfully', async () => {
      brandRepository.findOne.mockResolvedValue(mockBrand);
      brandRepository.save.mockResolvedValue({
        ...mockBrand,
        ...updateBrandDto,
      } as any);

      const result = await service.update(
        mockTenantId,
        mockBrandId,
        updateBrandDto,
      );

      expect(brandRepository.findOne).toHaveBeenCalled();
      expect(brandRepository.save).toHaveBeenCalled();
      expect(result.name).toBe(updateBrandDto.name);
    });

    it('should check code uniqueness when updating code', async () => {
      const updateDto: UpdateBrandDto = { code: 'NEWCODE' };
      const existingBrand = { ...mockBrand, code: 'OLDCODE' };
      const conflictingBrand = {
        ...mockBrand,
        id: 'other-id',
        code: 'NEWCODE',
      };

      brandRepository.findOne.mockResolvedValue(existingBrand);
      brandRepository.findByCode.mockResolvedValue(conflictingBrand);

      await expect(
        service.update(mockTenantId, mockBrandId, updateDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should soft remove brand', async () => {
      brandRepository.findOne.mockResolvedValue(mockBrand);
      brandRepository.softRemove.mockResolvedValue(mockBrand);

      await service.remove(mockTenantId, mockBrandId);

      expect(brandRepository.softRemove).toHaveBeenCalledWith(mockBrand);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpendCalculationService } from './spend-calculation.service';
import { PlanSku, PlanFu } from '../../../database/entities/plan.entity';
import { Mechanic, MechanicCategory, SpendingType } from '../../../database/entities/mechanic.entity';
import { PlanMechanicValue, DistributionMethod } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { LTAAgreementService } from '../lta/lta-agreement.service';
import { CalculationContext, SKUContext } from './dto/calculation-context.dto';
import { SpendBreakdown } from './dto/spend-breakdown.dto';

describe('SpendCalculationService', () => {
  let service: SpendCalculationService;
  let planSkuRepo: jest.Mocked<Repository<PlanSku>>;
  let planFuRepo: jest.Mocked<Repository<PlanFu>>;
  let mechanicRepo: jest.Mocked<Repository<Mechanic>>;
  let planMechanicValueRepo: jest.Mocked<Repository<PlanMechanicValue>>;
  let mechanicSpendBreakdownRepo: jest.Mocked<Repository<MechanicSpendBreakdown>>;
  let ltaAgreementService: jest.Mocked<LTAAgreementService>;

  const mockTenantId = 'tenant-1';
  const mockPlanId = 'plan-1';
  const mockFuId = 'fu-1';
  const mockSkuId = 'sku-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpendCalculationService,
        {
          provide: getRepositoryToken(PlanSku),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlanFu),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Mechanic),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PlanMechanicValue),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(MechanicSpendBreakdown),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: LTAAgreementService,
          useValue: {
            getLTAForPlanContext: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SpendCalculationService>(SpendCalculationService);
    planSkuRepo = module.get(getRepositoryToken(PlanSku));
    planFuRepo = module.get(getRepositoryToken(PlanFu));
    mechanicRepo = module.get(getRepositoryToken(Mechanic));
    planMechanicValueRepo = module.get(getRepositoryToken(PlanMechanicValue));
    mechanicSpendBreakdownRepo = module.get(getRepositoryToken(MechanicSpendBreakdown));
    ltaAgreementService = module.get(LTAAgreementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateMechanicSpend', () => {
    it('should calculate on-invoice discount spend correctly', async () => {
      const mechanic: Partial<Mechanic> = {
        id: 'mech-1',
        code: 'CPP_ON',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
        spendingType: SpendingType.ON_INVOICE,
        isActive: true,
      };

      const skuContext: SKUContext = {
        skuId: mockSkuId,
        baseVolume: 1000,
        plannedVolume: 1200,
        listPrice: 10,
        cogsPerUnit: 6,
        cplId: 'cpl-1',
      };

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: { CPP_ON: 5 }, // 5%
      };

      ltaAgreementService.getLTAForPlanContext.mockResolvedValue({
        agreement: {} as any,
        rate: {} as any,
        finalOnInvoicePct: 2, // 2%
        finalOffInvoicePct: 1, // 1%
      });

      mechanicRepo.findOne.mockResolvedValue(mechanic as Mechanic);

      const spend = await service.calculateMechanicSpend(mockTenantId, 'CPP_ON', context, skuContext);

      // Expected: (1200 * 10 - 1200 * 10 * 0.02) * 0.05 = (12000 - 240) * 0.05 = 11760 * 0.05 = 588
      expect(spend).toBeCloseTo(588, 2);
    });

    it('should calculate per-unit support spend correctly', async () => {
      const mechanic: Partial<Mechanic> = {
        id: 'mech-2',
        code: 'PRICE_SUPPORT',
        category: MechanicCategory.PER_UNIT_SUPPORT,
        spendingType: SpendingType.OFF_INVOICE,
        isActive: true,
      };

      const skuContext: SKUContext = {
        skuId: mockSkuId,
        baseVolume: 1000,
        plannedVolume: 1200,
        listPrice: 10,
        cogsPerUnit: 6,
      };

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: { PRICE_SUPPORT: 0.5 }, // 0.5 per unit
      };

      mechanicRepo.findOne.mockResolvedValue(mechanic as Mechanic);

      const spend = await service.calculateMechanicSpend(mockTenantId, 'PRICE_SUPPORT', context, skuContext);

      // Expected: 0.5 * 1200 = 600
      expect(spend).toBe(600);
    });
  });

  describe('calculateAllSpendsForSKU', () => {
    it('should calculate complete spend breakdown for SKU', async () => {
      const skuContext: SKUContext = {
        skuId: mockSkuId,
        baseVolume: 1000,
        plannedVolume: 1200,
        listPrice: 10,
        cogsPerUnit: 6,
        cplId: 'cpl-1',
        channelCode: 'NKA',
        categoryCode: 'Dairy',
      };

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: {
          CPP_ON: 5, // 5%
          PRICE_SUPPORT: 0.5, // 0.5 per unit
        },
      };

      ltaAgreementService.getLTAForPlanContext.mockResolvedValue({
        agreement: {} as any,
        rate: {} as any,
        finalOnInvoicePct: 2, // 2%
        finalOffInvoicePct: 1, // 1%
      });

      const onInvoiceMechanic: Partial<Mechanic> = {
        id: 'mech-1',
        code: 'CPP_ON',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
        spendingType: SpendingType.ON_INVOICE,
        isActive: true,
      };

      const offInvoiceMechanic: Partial<Mechanic> = {
        id: 'mech-2',
        code: 'PRICE_SUPPORT',
        category: MechanicCategory.PER_UNIT_SUPPORT,
        spendingType: SpendingType.OFF_INVOICE,
        isActive: true,
      };

      mechanicRepo.find.mockResolvedValue([onInvoiceMechanic, offInvoiceMechanic] as Mechanic[]);
      mechanicRepo.findOne.mockImplementation((options: any) => {
        if (options.where.code === 'CPP_ON') {
          return Promise.resolve(onInvoiceMechanic as Mechanic);
        }
        return Promise.resolve(offInvoiceMechanic as Mechanic);
      });

      const breakdown = await service.calculateAllSpendsForSKU(mockTenantId, skuContext, context);

      expect(breakdown.skuId).toBe(mockSkuId);
      expect(breakdown.base.ltaOnInvoice).toBeGreaterThan(0);
      expect(breakdown.planned.ltaOnInvoice).toBeGreaterThan(0);
      expect(breakdown.planned.totalPromoOnInvoice).toBeGreaterThan(0);
      expect(breakdown.planned.totalPromoOffInvoice).toBeGreaterThan(0);
      expect(breakdown.incremental.total).toBeGreaterThan(0);
    });
  });

  describe('distributeSpendToSKUs', () => {
    it('should distribute spend based on base volume ratio for lumpsum', async () => {
      const planFu: Partial<PlanFu> = {
        id: mockFuId,
        planSkus: [
          {
            id: 'ps-1',
            skuId: 'sku-1',
            baseVolume: 1000,
            plannedVolume: 1200,
            sku: { id: 'sku-1', unitPrice: 10 } as any,
          } as PlanSku,
          {
            id: 'ps-2',
            skuId: 'sku-2',
            baseVolume: 2000,
            plannedVolume: 2400,
            sku: { id: 'sku-2', unitPrice: 10 } as any,
          } as PlanSku,
        ] as PlanSku[],
      };

      planFuRepo.findOne.mockResolvedValue(planFu as PlanFu);

      const distributions = await service.distributeSpendToSKUs(
        mockTenantId,
        mockFuId,
        'mech-1',
        1000,
        DistributionMethod.LUMPSUM,
      );

      expect(distributions).toHaveLength(2);
      expect(distributions[0].ratio).toBeCloseTo(1000 / 3000, 4);
      expect(distributions[1].ratio).toBeCloseTo(2000 / 3000, 4);
      expect(distributions[0].amount + distributions[1].amount).toBeCloseTo(1000, 2);
    });
  });

  describe('validateSpendCalculations', () => {
    it('should validate mechanic values against min/max constraints', async () => {
      const planFu: Partial<PlanFu> = {
        id: mockFuId,
        planMechanicValues: [
          {
            id: 'pmv-1',
            enteredValue: 3,
            mechanic: {
              id: 'mech-1',
              code: 'CPP_ON',
              minValue: 5,
              maxValue: 10,
            } as Mechanic,
          } as PlanMechanicValue,
        ] as PlanMechanicValue[],
      };

      planFuRepo.find.mockResolvedValue([planFu] as PlanFu[]);

      const result = await service.validateSpendCalculations(mockTenantId, mockPlanId);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('below minimum');
    });
  });
});

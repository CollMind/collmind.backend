import { MechanicInput } from '../../../common/numeric/mechanic-input';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SpendCalculationService } from './spend-calculation.service';
import { PlanSku, PlanFu } from '../../../database/entities/plan.entity';
import {
  Mechanic,
  MechanicCategory,
  MechanicType,
  SpendingType,
} from '../../../database/entities/mechanic.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import { LTAAgreementService } from '../lta/lta-agreement.service';
import { CalculationContext, SKUContext } from './dto/calculation-context.dto';
import { RawSkuSpendInputs, resolveSkuSpendInputs } from './sku-spend-inputs';

/**
 * `T-337` / `Z77 §2` — `SKUContext` MARKALI bir tiptir ve nesne
 * literaliyle inşa **edilemez**; testler de üretim yolunun geçtiği
 * kapıdan geçer. ⛔ Bu bir kolaylık sarmalayıcısı DEĞİL: bir fixture'ın
 * resolver'ı ATLAYABİLMESİ, resolver'ın kapı olmadığı anlamına gelirdi
 * (`§2.7 #8`: bir kontrolü sınayan test o kontrolü YENİDEN UYGULAMAMALI).
 */
function evaluableSkuContext(raw: RawSkuSpendInputs): SKUContext {
  const resolution = resolveSkuSpendInputs(raw);
  if (resolution.kind === 'UNTOUCHED') {
    throw new Error(
      `fixture is UNTOUCHED (baseVolume and plannedVolume both absent) — ` +
        `use resolveSkuSpendInputs directly if that is the intent (Q20)`,
    );
  }
  if (resolution.kind !== 'EVALUABLE') {
    throw new Error(
      `fixture is NOT_EVALUABLE (missing ${resolution.missing.join(', ')}) — ` +
        `use resolveSkuSpendInputs directly if that is the intent`,
    );
  }
  return resolution.ctx;
}
import { SpendBreakdown } from './dto/spend-breakdown.dto';

// F2/C2a: mechanicValues now carries the scale in the type. These builders keep
// the fixtures readable and make each test state which scale it means, instead
// of a bare number whose meaning lived in a comment.
const rateIn = (code: string, percent: number): MechanicInput => ({
  kind: 'rate',
  code,
  percent,
});
const totalIn = (code: string, tryTotal: number): MechanicInput => ({
  kind: 'totalAmount',
  code,
  tryTotal,
});
const unitIn = (code: string, tryPerUnit: number): MechanicInput => ({
  kind: 'unitAmount',
  code,
  tryPerUnit,
});

describe('SpendCalculationService', () => {
  let service: SpendCalculationService;
  let planSkuRepo: jest.Mocked<Repository<PlanSku>>;
  let planFuRepo: jest.Mocked<Repository<PlanFu>>;
  let mechanicRepo: jest.Mocked<Repository<Mechanic>>;
  let planMechanicValueRepo: jest.Mocked<Repository<PlanMechanicValue>>;
  let mechanicSpendBreakdownRepo: jest.Mocked<
    Repository<MechanicSpendBreakdown>
  >;
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
    mechanicSpendBreakdownRepo = module.get(
      getRepositoryToken(MechanicSpendBreakdown),
    );
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
        mechanicType: MechanicType.PERCENT,
        spendingType: SpendingType.ON_INVOICE,
        isActive: true,
      };

      const skuContext = evaluableSkuContext({
        skuId: mockSkuId,
        baseVolume: 1000,
        plannedVolume: 1200,
        listPrice: 10,
        cogsPerUnit: 6,
        cplId: 'cpl-1',
      });

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: { CPP_ON: rateIn('CPP_ON', 5) },
      };

      ltaAgreementService.getLTAForPlanContext.mockResolvedValue({
        agreement: {} as any,
        rate: {} as any,
        finalOnInvoicePct: 2, // 2%
        finalOffInvoicePct: 1, // 1%
      });

      mechanicRepo.findOne.mockResolvedValue(mechanic as Mechanic);

      const spend = await service.calculateMechanicSpend(
        mockTenantId,
        'CPP_ON',
        context,
        skuContext,
      );

      // Expected: (1200 * 10 - 1200 * 10 * 0.02) * 0.05 = (12000 - 240) * 0.05 = 11760 * 0.05 = 588
      expect(spend).toBeCloseTo(588, 2);
    });

    it('should calculate per-unit support spend correctly', async () => {
      const mechanic: Partial<Mechanic> = {
        id: 'mech-2',
        code: 'PRICE_SUPPORT',
        category: MechanicCategory.PER_UNIT_SUPPORT,
        mechanicType: MechanicType.AMOUNT_PER_UNIT,
        spendingType: SpendingType.OFF_INVOICE,
        isActive: true,
      };

      const skuContext = evaluableSkuContext({
        skuId: mockSkuId,
        baseVolume: 1000,
        plannedVolume: 1200,
        listPrice: 10,
        cogsPerUnit: 6,
      });

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: { PRICE_SUPPORT: unitIn('PRICE_SUPPORT', 0.5) },
      };

      mechanicRepo.findOne.mockResolvedValue(mechanic as Mechanic);

      const spend = await service.calculateMechanicSpend(
        mockTenantId,
        'PRICE_SUPPORT',
        context,
        skuContext,
      );

      // Expected: 0.5 * 1200 = 600
      expect(spend).toBe(600);
    });
  });

  describe('calculateAllSpendsForSKU', () => {
    it('should calculate complete spend breakdown for SKU', async () => {
      const skuContext = evaluableSkuContext({
        skuId: mockSkuId,
        baseVolume: 1000,
        plannedVolume: 1200,
        listPrice: 10,
        cogsPerUnit: 6,
        cplId: 'cpl-1',
        channelCode: 'NKA',
        categoryCode: 'Dairy',
      });

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: {
          CPP_ON: rateIn('CPP_ON', 5),
          PRICE_SUPPORT: unitIn('PRICE_SUPPORT', 0.5),
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
        mechanicType: MechanicType.PERCENT,
        spendingType: SpendingType.ON_INVOICE,
        isActive: true,
      };

      const offInvoiceMechanic: Partial<Mechanic> = {
        id: 'mech-2',
        code: 'PRICE_SUPPORT',
        category: MechanicCategory.PER_UNIT_SUPPORT,
        mechanicType: MechanicType.AMOUNT_PER_UNIT,
        spendingType: SpendingType.OFF_INVOICE,
        isActive: true,
      };

      mechanicRepo.find.mockResolvedValue([
        onInvoiceMechanic,
        offInvoiceMechanic,
      ] as Mechanic[]);
      mechanicRepo.findOne.mockImplementation((options: any) => {
        if (options.where.code === 'CPP_ON') {
          return Promise.resolve(onInvoiceMechanic as Mechanic);
        }
        return Promise.resolve(offInvoiceMechanic as Mechanic);
      });

      const breakdown = await service.calculateAllSpendsForSKU(
        mockTenantId,
        skuContext,
        context,
      );

      expect(breakdown.skuId).toBe(mockSkuId);
      expect(breakdown.base!.ltaOnInvoice).toBeGreaterThan(0);
      expect(breakdown.planned!.ltaOnInvoice).toBeGreaterThan(0);
      expect(breakdown.planned!.totalPromoOnInvoice).toBeGreaterThan(0);
      expect(breakdown.planned!.totalPromoOffInvoice).toBeGreaterThan(0);
      expect(breakdown.incremental!.total).toBeGreaterThan(0);
    });
  });

  /**
   * T-062: `computeLumpsumDistribution` is the single derivation point that
   * replaced the dead-since-inception `distributeSpendToSKUs` (measured via
   * `git log -S distributeSpendToSKUs` — never had a production caller in
   * this repo's history). See the fuller behavioural coverage in the
   * "LUMPSUM_SPEND distribution (T-062)" describe block below, which
   * exercises this through the canonical `calculateAllSpendsForFU` entry
   * point end-to-end.
   */
  describe('computeLumpsumDistribution', () => {
    it('should distribute spend based on base volume ratio', () => {
      const distributions = service.computeLumpsumDistribution(
        mockFuId,
        { 'mech-1': totalIn('mech-1', 1000) },
        [
          {
            code: 'mech-1',
            category: MechanicCategory.LUMPSUM_SPEND,
            mechanicType: MechanicType.AMOUNT,
          } as Mechanic,
        ],
        [
          { skuId: 'sku-1', baseVolume: 1000 },
          { skuId: 'sku-2', baseVolume: 2000 },
        ],
      );

      expect(distributions['sku-1']['mech-1']).toBeCloseTo(1000 / 3, 2);
      expect(distributions['sku-2']['mech-1']).toBeCloseTo(2000 / 3, 2);
      expect(
        distributions['sku-1']['mech-1'] + distributions['sku-2']['mech-1'],
      ).toBe(1000);
    });

    it('should return an empty map when no SKUs are given', () => {
      expect(
        service.computeLumpsumDistribution(
          mockFuId,
          { 'mech-1': totalIn('mech-1', 1000) },
          [
            {
              code: 'mech-1',
              category: MechanicCategory.LUMPSUM_SPEND,
              mechanicType: MechanicType.AMOUNT,
            } as Mechanic,
          ],
          [],
        ),
      ).toEqual({});
    });
  });

  /**
   * T-062: LUMPSUM_SPEND must be distributed to SKUs, base-volume
   * proportional, null-base SKU gets no share (ADR 0006 Karar 2, 0001 Set
   * C). `calculateAllSpendsForFU` is one of the two canonical per-FU entry
   * points (T-052) that both feed `plan.totalSpend`/budget reservation.
   */
  describe('LUMPSUM_SPEND distribution (T-062)', () => {
    const lumpsumMechanic: Partial<Mechanic> = {
      id: 'mech-ls',
      code: 'VIS_LS',
      category: MechanicCategory.LUMPSUM_SPEND,
      mechanicType: MechanicType.AMOUNT,
      spendingType: SpendingType.OFF_INVOICE,
      isActive: true,
    };

    it('should distribute lumpsum spend to SKUs proportional to base volume (non-zero FU total, budget-visible)', async () => {
      const planFu: Partial<PlanFu> = {
        id: mockFuId,
        tenantId: mockTenantId,
        planId: mockPlanId,
        plan: {
          cplId: 'cpl-1',
          channel: { code: 'NKA' },
          category: { code: 'Dairy' },
        } as any,
        planSkus: [
          {
            skuId: 'sku-a',
            baseVolume: 100,
            plannedVolume: 100,
            sku: { unitPrice: 10, cogs: 5 } as any,
          } as any,
          {
            skuId: 'sku-b',
            baseVolume: 200,
            plannedVolume: 200,
            sku: { unitPrice: 10, cogs: 5 } as any,
          } as any,
        ],
        planMechanicValues: [],
        tactics: { VIS_LS: 300 },
      };

      planFuRepo.findOne.mockResolvedValue(planFu as PlanFu);
      mechanicRepo.find.mockResolvedValue([lumpsumMechanic] as Mechanic[]);
      ltaAgreementService.getLTAForPlanContext.mockResolvedValue(null);

      const result = await service.calculateAllSpendsForFU(
        mockTenantId,
        mockFuId,
      );

      // FU total must see the full 300 — this is the T-062 bug: today it is 0.
      expect(result.aggregatedPlanned.totalOffInvoice).toBeCloseTo(300, 2);
      expect(result.aggregatedPlanned.totalSpend).toBeCloseTo(300, 2);

      // Base-volume proportional: sku-a (100/300) -> 100, sku-b (200/300) -> 200.
      const skuA = result.skuBreakdowns.find((b) => b.skuId === 'sku-a')!;
      const skuB = result.skuBreakdowns.find((b) => b.skuId === 'sku-b')!;
      expect(skuA.planned!.promoOffInvoice['VIS_LS']).toBeCloseTo(100, 2);
      expect(skuB.planned!.promoOffInvoice['VIS_LS']).toBeCloseTo(200, 2);

      // Rounding invariant: distributed shares must sum EXACTLY to the FU
      // lumpsum total (no penny loss/gain).
      const distributedSum =
        (skuA.planned!.promoOffInvoice['VIS_LS'] || 0) +
        (skuB.planned!.promoOffInvoice['VIS_LS'] || 0);
      expect(distributedSum).toBe(300);
    });

    it('should give null-base SKU zero lumpsum share (0001 Set C / ADR 0006 Karar 2) and preserve exact-sum rounding', async () => {
      const planFu: Partial<PlanFu> = {
        id: mockFuId,
        tenantId: mockTenantId,
        planId: mockPlanId,
        plan: {
          cplId: 'cpl-1',
          channel: { code: 'NKA' },
          category: { code: 'Dairy' },
        } as any,
        planSkus: [
          {
            // Set C: new-product SKU, no historical base volume.
            skuId: 'sku-new-product',
            baseVolume: null,
            plannedVolume: 500,
            sku: { unitPrice: 10, cogs: 5 } as any,
          } as any,
          {
            skuId: 'sku-1',
            baseVolume: 1,
            plannedVolume: 1,
            sku: { unitPrice: 10, cogs: 5 } as any,
          } as any,
          {
            skuId: 'sku-2',
            baseVolume: 2,
            plannedVolume: 2,
            sku: { unitPrice: 10, cogs: 5 } as any,
          } as any,
        ],
        planMechanicValues: [],
        tactics: { VIS_LS: 100 },
      };

      planFuRepo.findOne.mockResolvedValue(planFu as PlanFu);
      mechanicRepo.find.mockResolvedValue([lumpsumMechanic] as Mechanic[]);
      ltaAgreementService.getLTAForPlanContext.mockResolvedValue(null);

      const result = await service.calculateAllSpendsForFU(
        mockTenantId,
        mockFuId,
      );

      const newProduct = result.skuBreakdowns.find(
        (b) => b.skuId === 'sku-new-product',
      )!;
      const sku1 = result.skuBreakdowns.find((b) => b.skuId === 'sku-1')!;
      const sku2 = result.skuBreakdowns.find((b) => b.skuId === 'sku-2')!;

      expect(newProduct.planned!.promoOffInvoice['VIS_LS'] || 0).toBe(0);
      // sku-1:sku-2 base ratio 1:2 -> 33.33/66.67 (non-terminating decimal —
      // exercises the rounding-remainder path, not a coincidentally exact split).
      expect(sku1.planned!.promoOffInvoice['VIS_LS']).toBeCloseTo(33.33, 2);
      expect(sku2.planned!.promoOffInvoice['VIS_LS']).toBeCloseTo(66.67, 2);

      const distributedSum =
        (newProduct.planned!.promoOffInvoice['VIS_LS'] || 0) +
        (sku1.planned!.promoOffInvoice['VIS_LS'] || 0) +
        (sku2.planned!.promoOffInvoice['VIS_LS'] || 0);
      expect(distributedSum).toBe(100);
    });

    it('should reject (not silently distribute 0) when ALL SKUs in the FU have null/zero base volume and lumpsum > 0 is entered', async () => {
      const planFu: Partial<PlanFu> = {
        id: mockFuId,
        tenantId: mockTenantId,
        planId: mockPlanId,
        plan: {
          cplId: 'cpl-1',
          channel: { code: 'NKA' },
          category: { code: 'Dairy' },
        } as any,
        planSkus: [
          {
            skuId: 'sku-a',
            baseVolume: null,
            plannedVolume: 100,
            sku: { unitPrice: 10, cogs: 5 } as any,
          } as any,
          {
            skuId: 'sku-b',
            baseVolume: 0,
            plannedVolume: 200,
            sku: { unitPrice: 10, cogs: 5 } as any,
          } as any,
        ],
        planMechanicValues: [],
        tactics: { VIS_LS: 300 },
      };

      planFuRepo.findOne.mockResolvedValue(planFu as PlanFu);
      mechanicRepo.find.mockResolvedValue([lumpsumMechanic] as Mechanic[]);
      ltaAgreementService.getLTAForPlanContext.mockResolvedValue(null);

      await expect(
        service.calculateAllSpendsForFU(mockTenantId, mockFuId),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'LUMPSUM_DISTRIBUTION_NO_BASE_VOLUME',
        }),
      });
    });
  });

  /**
   * `T-337` / `Z77 §2` — **`BASE_VOL` YOKLUĞU: TABAN `null`, PLANLANAN SAĞLAM.**
   *
   * ⛔ Bu, `K1 §1b:2532`'nin canlı vakasının pinidir. `plan_skus.base_volume`
   * NULLABLE bir kolondur; `T-027` onu `?? 0` ile çöktürüyordu ⇒
   * `baseTotalSpend = 0` ⇒ `INCR_SPEND = planned − 0` **ŞİŞKİN** bir SAYI
   * olarak KPI motoruna gidiyordu (motor `null` görmediği için
   * null-propagation devreye GİRMİYORDU).
   *
   * ⚠️ AYIRT EDİCİ ŞEKİL (`T-332`): iki fixture **yalnız `baseVolume`'de**
   * farklı (`0` ↔ `null`) ve assertion **farkı okuyor**. `baseVolume: 0`
   * meşru bir taban (harcama gerçekten 0) — o vaka `0` üretmeye DEVAM
   * etmeli, yoksa düzeltme meşru bir sıfırı yok ederdi.
   */
  describe('BASE_VOL yokluğu — taban null, planlanan etkilenmez', () => {
    const buildContext = (): CalculationContext => ({
      planId: mockPlanId,
      fuId: mockFuId,
      skuContexts: [],
      mechanicValues: { CPP_ON: rateIn('CPP_ON', 10) },
    });

    const onInvoiceMechanic: Partial<Mechanic> = {
      id: 'mech-1',
      code: 'CPP_ON',
      category: MechanicCategory.ON_INVOICE_DISCOUNT,
      mechanicType: MechanicType.PERCENT,
      spendingType: SpendingType.ON_INVOICE,
      isActive: true,
    };

    beforeEach(() => {
      ltaAgreementService.getLTAForPlanContext.mockResolvedValue(null);
      mechanicRepo.find.mockResolvedValue([onInvoiceMechanic] as Mechanic[]);
      mechanicRepo.findOne.mockResolvedValue(onInvoiceMechanic as Mechanic);
    });

    it('baseVolume=null ⇒ base.* ve incremental.{on,off,total} NULL', async () => {
      const result = await service.calculateAllSpendsForSKU(
        mockTenantId,
        evaluableSkuContext({
          skuId: 'sku-nobase',
          baseVolume: null,
          plannedVolume: 1680,
          listPrice: 10,
          cogsPerUnit: 6,
          cplId: 'cpl-1',
        }),
        buildContext(),
      );

      // ⛔ NESNE düşer, alanları değil: taban tek girdiden türer
      // (`BASE_VOL × BPTT`), o yüzden ya bütünüyle vardır ya hiç yoktur.
      expect(result.base).toBeNull();
      expect(result.incremental!.total).toBeNull();
      expect(result.incremental!.onInvoice).toBeNull();
      expect(result.incremental!.offInvoice).toBeNull();

      // ⛔ PLANLANAN TARAF ETKİLENMEZ — ayrım alan başına, gövde başına değil.
      // PLANNED_GSV = 1680*10 = 16800, CPP_ON %10 ⇒ 1680.
      expect(result.planned!.totalSpend).toBeCloseTo(1680, 1);
      // ...ve ROI paydası da sağlam (tabana bağlı DEĞİL, ADR 0011 Q6).
      expect(result.incremental!.promoTotal).toBeCloseTo(1680, 1);
    });

    it('baseVolume=0 MEŞRU bir tabandır ⇒ 0 üretir, null DEĞİL', async () => {
      const result = await service.calculateAllSpendsForSKU(
        mockTenantId,
        evaluableSkuContext({
          skuId: 'sku-zerobase',
          baseVolume: 0,
          plannedVolume: 1680,
          listPrice: 10,
          cogsPerUnit: 6,
          cplId: 'cpl-1',
        }),
        buildContext(),
      );

      // ⛔ AYIRT EDİCİ ASSERTION: yukarıdaki vakayla AYNI DEĞİLDİR.
      expect(result.base).not.toBeNull();
      expect(result.base!.totalSpend).toBe(0);
      expect(result.incremental!.total).toBeCloseTo(1680, 1);
    });

    /**
     * ⛔ **İKİ EKSEN BAĞIMSIZ — ve bu ölçümle bulundu, tasarımla değil.**
     *
     * İlk uygulama `PLAN_VOL` yokluğunu *"breakdown yok"* diye ele aldı ve
     * **taban zincirini de** öldürdü. `lta-lifecycle-bond-and-base-chain
     * .e2e-spec.ts` (`T-293`) yakaladı: yalnız `baseVolume` girilmiş bir
     * SKU'da `BASE_LTA_ON` `null`'a düştü — oysa taban `BASE_VOL × BPTT`'dir
     * ve `PLAN_VOL`'e BAĞLI DEĞİLDİR (`§7.1`: tüketicileri saymamıştım).
     *
     * Bu pin o regresyonun geri gelmesini yakalar.
     */
    it('PLAN_VOL yokluğu TABAN zincirini ÖLDÜRMEZ (LTA taban kalemleri sağlam)', async () => {
      const resolution = resolveSkuSpendInputs({
        skuId: 'sku-baseonly',
        baseVolume: 1000,
        plannedVolume: null,
        listPrice: 10,
        cogsPerUnit: 6,
        cplId: 'cpl-1',
      });
      expect(resolution.kind).toBe('NOT_EVALUABLE');
      if (resolution.kind !== 'NOT_EVALUABLE') throw new Error('unreachable');
      // ⛔ ...ama `ctx` VAR: taban hâlâ hesaplanabilir.
      expect(resolution.ctx).not.toBeNull();

      ltaAgreementService.getLTAForPlanContext.mockResolvedValue({
        agreement: {} as never,
        rate: {} as never,
        finalOnInvoicePct: 7,
        finalOffInvoicePct: 2,
      } as never);

      const result = await service.calculateAllSpendsForSKU(
        mockTenantId,
        resolution.ctx!,
        buildContext(),
      );

      // TABAN KOŞTU: BASE_GSV = 1000*10 = 10000, %7 ⇒ 700
      expect(result.base).not.toBeNull();
      expect(result.base!.ltaOnInvoice).toBeCloseTo(700, 2);
      // BaseNIV = 10000 - 700 = 9300, %2 ⇒ 186
      expect(result.base!.ltaOffInvoice).toBeCloseTo(186, 2);
      expect(result.base!.totalSpend).toBeCloseTo(886, 2);

      // ⛔ PLANLANAN TARAF hesaplanmadı — ve `0` DEĞİL, `null`.
      expect(result.planned).toBeNull();
      expect(result.incremental).toBeNull();
    });

    it('BPTT yoksa HİÇBİR kova hesaplanamaz — resolver ctx bile üretmez', () => {
      const resolution = resolveSkuSpendInputs({
        skuId: 'sku-nobptt',
        baseVolume: 1000,
        plannedVolume: 1680,
        listPrice: null,
        cogsPerUnit: 6,
      });
      expect(resolution.kind).toBe('NOT_EVALUABLE');
      if (resolution.kind !== 'NOT_EVALUABLE') throw new Error('unreachable');
      // ⛔ AYIRT EDİCİ: PLAN_VOL vakasıyla AYNI DEĞİL — orada ctx vardı.
      expect(resolution.ctx).toBeNull();
      expect(resolution.baseEvaluable).toBe(false);
    });

    it('eksik girdili SKU FU toplamına GİRMEZ, adıyla raporlanır', async () => {
      planFuRepo.findOne.mockResolvedValue({
        id: mockFuId,
        tenantId: mockTenantId,
        planId: mockPlanId,
        plan: {
          cplId: 'cpl-1',
          channel: { code: 'NKA' },
          category: { code: 'Hair' },
        },
        planMechanicValues: [],
        tactics: { CPP_ON: 10 },
        planSkus: [
          {
            skuId: 'sku-ok',
            baseVolume: 1000,
            plannedVolume: 1680,
            sku: { unitPrice: 10, cogs: 6 },
          },
          {
            // ⛔ PLAN_VOL YOK — eskiden `Number(null) || 0` ile `0` olur,
            // `0` harcama üretir ve toplama SESSİZCE girerdi.
            skuId: 'sku-missing-planvol',
            baseVolume: 1000,
            plannedVolume: null,
            sku: { unitPrice: 10, cogs: 6 },
          },
        ],
      } as never);

      const fu = await service.calculateAllSpendsForFU(mockTenantId, mockFuId);

      expect(fu.notEvaluableSkus).toEqual([
        { skuId: 'sku-missing-planvol', missing: ['PLAN_VOL'] },
      ]);
      // Yalnız değerlendirilebilen SKU toplamda:
      expect(fu.skuBreakdowns).toHaveLength(1);
      expect(fu.aggregatedPlanned.totalSpend).toBeCloseTo(1680, 1);
    });
  });

  /**
   * T-017 / Set A → ⚠️ **[[T-334]] İLE DÖNÜŞTÜRÜLDÜ (2026-08-30)**.
   *
   * ESKİ SÖZLEŞME (iz olarak kalıyor): *"TO yalnız on-invoice ile azalır"*
   * (migration `1781`). `Z65 §1` bunu SAPMA ilan etti — o formül aslında
   * **`NIV`**'dir. Kanon (Excel `§1` · `migration 1818`):
   * ```
   * TO  = GSV − TotalSpend(on + off)
   * NIV = GSV − TotalSpendOn
   * ```
   * ⇒ aşağıdaki iki test **kırmızıya döndü ve GÜNCELLENDİ**; ikisi de artık
   * `TO ≠ NIV` farkını OKUYAN bir assertion taşıyor.
   *
   * SKU-A inputs:
   *   plannedVolume=1680, listPrice=10  → PLANNED_GSV=16800
   *   LTA_ON=0%, CPP_ON=10%            → PLANNED_ON_INVOICE_SPEND=1680
   *   LTA yok ⇒ off-invoice harcama da 0 ⇒ bu ilk vakada TO = NIV
   *   Expected PLANNED_TO = 16800 - 1680 = 15120
   *   COGS=0 → PLANNED_GP = 15120
   */
  describe('calculateCompleteSKUFinancialMetrics – TO/GP (Set A)', () => {
    it('should compute PLANNED_TO using only on-invoice spend (T-017)', async () => {
      const skuContext = evaluableSkuContext({
        skuId: 'sku-a',
        baseVolume: 1000,
        plannedVolume: 1680,
        listPrice: 10,
        cogsPerUnit: 0, // zero COGS to isolate TO calculation
        cplId: 'cpl-1',
        channelCode: 'NKA',
        categoryCode: 'Dairy',
      });

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: {
          CPP_ON: rateIn('CPP_ON', 10),
        },
      };

      // No LTA → LTA values = 0
      ltaAgreementService.getLTAForPlanContext.mockResolvedValue(null);

      const onInvoiceMechanic: Partial<Mechanic> = {
        id: 'mech-1',
        code: 'CPP_ON',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
        mechanicType: MechanicType.PERCENT,
        spendingType: SpendingType.ON_INVOICE,
        isActive: true,
      };

      mechanicRepo.find.mockResolvedValue([onInvoiceMechanic] as Mechanic[]);
      mechanicRepo.findOne.mockResolvedValue(onInvoiceMechanic as Mechanic);

      const result = await service.calculateCompleteSKUFinancialMetrics(
        mockTenantId,
        skuContext,
        context,
      );

      // PLANNED_GSV = 1680 * 10 = 16800
      // PLANNED_ON_INVOICE_SPEND = 16800 * 10% = 1680
      // LTA YOK ⇒ off-invoice harcama = 0 ⇒ TO = GSV − (on + 0) = 15120.
      // ⚠️ Bu vaka `TO`/`NIV` ayrımını AYIRT EDEMEZ (ikisi de 15120) —
      // ayrımı okuyan vaka bir altta (`LTA off %3`).
      expect(result.turnover.plannedTo).toBeCloseTo(15120, 1);
      expect(result.niv.plannedNiv).toBeCloseTo(15120, 1);

      // BASE_TO = BASE_GSV - BASE_TOTAL_SPEND = 1000*10 - 0 = 10000
      expect(result.turnover.baseTo).toBeCloseTo(10000, 1);

      // PLANNED_GP = PLANNED_TO - PLANNED_COGS = 15120 - 0 = 15120
      expect(result.profit.plannedGp).toBeCloseTo(15120, 1);
    });

    it('baseTo ltaOffInvoice ile AZALIR, baseNiv AZALMAZ (T-334: TO ≠ NIV)', async () => {
      const skuContext = evaluableSkuContext({
        skuId: 'sku-b',
        baseVolume: 1000,
        plannedVolume: 1000,
        listPrice: 10,
        cogsPerUnit: 4,
        cplId: 'cpl-1',
      });

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: {},
      };

      // LTA: 5% on-invoice, 3% off-invoice
      ltaAgreementService.getLTAForPlanContext.mockResolvedValue({
        agreement: {} as any,
        rate: {} as any,
        finalOnInvoicePct: 5,
        finalOffInvoicePct: 3,
      });

      mechanicRepo.find.mockResolvedValue([]);

      const result = await service.calculateCompleteSKUFinancialMetrics(
        mockTenantId,
        skuContext,
        context,
      );

      const baseGsv = 1000 * 10; // 10000
      const baseLtaOn = baseGsv * 0.05; // 500
      const baseNiv = baseGsv - baseLtaOn; // 9500
      const baseLtaOff = baseNiv * 0.03; // 285  (Excel: LTAOffPct × BaseNIV)

      // `T-334` — TO on+off ile azalır; NIV yalnız on ile.
      expect(result.niv.baseNiv).toBeCloseTo(baseNiv, 1);
      expect(result.turnover.baseTo).toBeCloseTo(baseNiv - baseLtaOff, 1);

      // FARKI OKUYAN assertion: iki kavram AYNI SAYI DEĞİL, ve aralarındaki
      // fark TAM OLARAK off-invoice LTA harcamasıdır.
      expect(result.turnover.baseTo).not.toBeCloseTo(result.niv.baseNiv, 1);
      expect(result.niv.baseNiv - result.turnover.baseTo).toBeCloseTo(
        baseLtaOff,
        1,
      );
    });
  });

  /**
   * B-1 (BLOCKER): tenant isolation — calculateAllSpendsForFU must NOT return
   * data belonging to a different tenant. Both findOne calls must include tenantId.
   */
  describe('calculateAllSpendsForFU – tenant isolation (B-1)', () => {
    it('should throw when PlanFU belongs to a different tenant', async () => {
      // planFuRepo.findOne returns null because tenantId mismatch filters it out
      planFuRepo.findOne.mockResolvedValue(null);

      await expect(
        service.calculateAllSpendsForFU('wrong-tenant', mockFuId),
      ).rejects.toThrow(/not found/i);

      // Verify tenantId was included in the where clause
      expect(planFuRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'wrong-tenant' }),
        }),
      );
    });

    it('should use correct tenantId in calculateAllSpendsForFU findOne query', async () => {
      const tenantA = 'tenant-A';
      const tenantB = 'tenant-B';

      // Returns null — simulating tenant-B's FU not visible to tenant-A
      planFuRepo.findOne.mockResolvedValue(null);

      await expect(
        service.calculateAllSpendsForFU(tenantA, mockFuId),
      ).rejects.toThrow();

      expect(planFuRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: tenantA }),
        }),
      );
      // Must NOT have been called with tenantB
      expect(planFuRepo.findOne).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: tenantB }),
        }),
      );
    });
  });

  /**
   * T-052: `calculateAllSpendsForFU` (used by
   * `ApprovalWorkflowService#submitForApproval` -> `calculateSpendBreakdown`)
   * must read `plan_fus.tactics` — the ONLY UI-reachable way to set mechanic
   * values (`PATCH .../fus/:fuId/tactics` -> `PlanService#updateFuTactic`) —
   * not just `plan_mechanic_values.enteredValue`. Before the fix, a FU whose
   * ONLY mechanic input was `tactics` computed zero spend through this path.
   */
  describe('calculateAllSpendsForFU – reads plan_fus.tactics (T-052)', () => {
    const buildOnInvoiceMechanic = (): Partial<Mechanic> => ({
      id: 'mech-tactic-1',
      code: 'MEC-DISCOUNT',
      category: MechanicCategory.ON_INVOICE_DISCOUNT,
      mechanicType: MechanicType.PERCENT,
      spendingType: SpendingType.ON_INVOICE,
      isActive: true,
    });

    const buildMockPlanFu = (
      overrides: Partial<PlanFu> = {},
    ): Partial<PlanFu> => ({
      id: mockFuId,
      tenantId: mockTenantId,
      planId: mockPlanId,
      plan: {
        cplId: 'cpl-1',
        channel: { code: 'NKA' },
        category: { code: 'Dairy' },
      } as any,
      planSkus: [
        {
          skuId: mockSkuId,
          baseVolume: 800,
          plannedVolume: 1000,
          sku: { unitPrice: 10, cogs: 5 } as any,
        } as any,
      ],
      planMechanicValues: [],
      tactics: {},
      ...overrides,
    });

    beforeEach(() => {
      ltaAgreementService.getLTAForPlanContext.mockResolvedValue(null);
      mechanicRepo.find.mockResolvedValue([
        buildOnInvoiceMechanic(),
      ] as Mechanic[]);
    });

    it('should compute non-zero spend for a FU whose ONLY mechanic input is plan_fus.tactics (no plan_mechanic_values rows)', async () => {
      planFuRepo.findOne.mockResolvedValue(
        buildMockPlanFu({ tactics: { 'MEC-DISCOUNT': 10 } }) as PlanFu,
      );

      const result = await service.calculateAllSpendsForFU(
        mockTenantId,
        mockFuId,
      );

      // (PLANNED_GSV=10000) * 10% = 1000, no LTA (null context) — must be
      // non-zero to prove `tactics` was actually read, not just present.
      expect(result.aggregatedPlanned.totalOnInvoice).toBeGreaterThan(0);
      expect(result.aggregatedPlanned.totalSpend).toBeGreaterThan(0);
    });

    it('should compute zero spend when plan_fus.tactics is empty and plan_mechanic_values is empty (both sources genuinely absent)', async () => {
      planFuRepo.findOne.mockResolvedValue(buildMockPlanFu() as PlanFu);

      const result = await service.calculateAllSpendsForFU(
        mockTenantId,
        mockFuId,
      );

      expect(result.aggregatedPlanned.totalSpend).toBe(0);
    });

    it('should still read plan_mechanic_values.enteredValue when tactics is empty (no regression on the pre-existing source)', async () => {
      planFuRepo.findOne.mockResolvedValue(
        buildMockPlanFu({
          tactics: {},
          planMechanicValues: [
            {
              enteredRatePct: 10,
              mechanic: buildOnInvoiceMechanic(),
            } as any,
          ],
        }) as PlanFu,
      );

      const result = await service.calculateAllSpendsForFU(
        mockTenantId,
        mockFuId,
      );

      expect(result.aggregatedPlanned.totalOnInvoice).toBeGreaterThan(0);
    });
  });

  /**
   * T-052: `buildMechanicValues` is the single shared derivation point both
   * canonical spend-derivation paths (`calculateAllSpendsForFU` here, and
   * `PlanService#recalculatePlanWithKpiEngineLocked`) call — asserted
   * directly so the merge/precedence rule is pinned regardless of which
   * caller exercises it.
   */
  describe('buildMechanicValues (T-052 shared derivation point)', () => {
    // F2/C2a: the derivation point now resolves scale from the mechanic row,
    // so the mechanics must be supplied. That is the single derivation point
    // C3's write-side validation will consume as well.
    const mechs = [
      { code: 'CPP_ON_PCT', mechanicType: 'PERCENT' },
      { code: 'MEC-DISCOUNT', mechanicType: 'PERCENT' },
      { code: 'VIS_LS', mechanicType: 'AMOUNT' },
    ] as unknown as Mechanic[];

    it('should merge plan_mechanic_values and tactics into one map', async () => {
      const result = await service.buildMechanicValues(
        {
          tactics: { VIS_LS: 2000 },
          planMechanicValues: [
            { mechanic: { code: 'CPP_ON_PCT' }, enteredRatePct: 10 },
          ],
        },
        mechs,
        mockTenantId,
      );

      expect(result).toEqual({
        CPP_ON_PCT: rateIn('CPP_ON_PCT', 10),
        VIS_LS: totalIn('VIS_LS', 2000),
      });
    });

    it('tactics should win over plan_mechanic_values on the same mechanic code (no summing / no double-count)', async () => {
      const result = await service.buildMechanicValues(
        {
          tactics: { 'MEC-DISCOUNT': 7 },
          planMechanicValues: [
            { mechanic: { code: 'MEC-DISCOUNT' }, enteredRatePct: 10 },
          ],
        },
        mechs,
        mockTenantId,
      );

      expect(result).toEqual({ 'MEC-DISCOUNT': rateIn('MEC-DISCOUNT', 7) });
    });

    it('should return an empty map when both sources are absent', async () => {
      await expect(
        service.buildMechanicValues({}, mechs, mockTenantId),
      ).resolves.toEqual({});
    });

    /**
     * T-083a: `describeUnresolvedMechanicCode` does a DB round trip
     * (`mechanicRepository.findOne` with `withDeleted: true`) and must run
     * ONLY on the error path — never on a happy-path call, or the BRD
     * <500ms recalc budget pays for a query on every single request. This
     * is the one place that claim can actually be falsified: an e2e assertion
     * can't observe "zero extra queries" without instrumenting the DB
     * connection, so this is a unit-level mock-call assertion instead.
     */
    it('does not touch the mechanic repository when every code resolves (hot-path cost claim, T-083a)', async () => {
      const result = await service.buildMechanicValues(
        {
          tactics: { VIS_LS: 2000 },
          planMechanicValues: [
            { mechanic: { code: 'CPP_ON_PCT' }, enteredRatePct: 10 },
          ],
        },
        mechs,
        mockTenantId,
      );

      expect(result).toEqual({
        CPP_ON_PCT: rateIn('CPP_ON_PCT', 10),
        VIS_LS: totalIn('VIS_LS', 2000),
      });
      expect(mechanicRepo.findOne).not.toHaveBeenCalled();
    });
  });

  /**
   * S-2: SpendingType.BOTH — mechanic with BOTH spendingType and no recognised
   * MechanicCategory should warn and produce zero spend (no double-counting).
   */
  describe('calculateAllSpendsForSKU – SpendingType.BOTH (S-2)', () => {
    it('should NOT double-count BOTH mechanic with unrecognised category', async () => {
      const skuContext = evaluableSkuContext({
        skuId: mockSkuId,
        baseVolume: 1000,
        plannedVolume: 1000,
        listPrice: 10,
        cogsPerUnit: 5,
        cplId: 'cpl-1',
      });

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: { BOTH_MECH: rateIn('BOTH_MECH', 5) },
      };

      ltaAgreementService.getLTAForPlanContext.mockResolvedValue(null);

      // BOTH mechanic with no recognised spend category
      const bothMechanic: Partial<Mechanic> = {
        id: 'mech-both',
        code: 'BOTH_MECH',
        category: undefined, // no recognised category
        spendingType: SpendingType.BOTH,
        isActive: true,
      };

      mechanicRepo.find.mockResolvedValue([bothMechanic] as Mechanic[]);

      const breakdown = await service.calculateAllSpendsForSKU(
        mockTenantId,
        skuContext,
        context,
      );

      // BOTH with no category must NOT add to on-invoice OR off-invoice promos
      expect(breakdown.planned!.totalPromoOnInvoice).toBe(0);
      expect(breakdown.planned!.totalPromoOffInvoice).toBe(0);
    });

    it('should route BOTH mechanic with ON_INVOICE_DISCOUNT category to on-invoice only', async () => {
      const skuContext = evaluableSkuContext({
        skuId: mockSkuId,
        baseVolume: 1000,
        plannedVolume: 1000,
        listPrice: 10,
        cogsPerUnit: 5,
        cplId: 'cpl-1',
      });

      const context: CalculationContext = {
        planId: mockPlanId,
        fuId: mockFuId,
        skuContexts: [],
        mechanicValues: { CPP_BOTH: rateIn('CPP_BOTH', 10) },
      };

      ltaAgreementService.getLTAForPlanContext.mockResolvedValue(null);

      const bothOnInvoiceMechanic: Partial<Mechanic> = {
        id: 'mech-both-on',
        code: 'CPP_BOTH',
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
        mechanicType: MechanicType.PERCENT,
        spendingType: SpendingType.BOTH,
        isActive: true,
      };

      mechanicRepo.find.mockResolvedValue([
        bothOnInvoiceMechanic,
      ] as Mechanic[]);
      mechanicRepo.findOne.mockResolvedValue(bothOnInvoiceMechanic as Mechanic);

      const breakdown = await service.calculateAllSpendsForSKU(
        mockTenantId,
        skuContext,
        context,
      );

      // Must appear only in on-invoice, NOT duplicated in off-invoice
      expect(breakdown.planned!.totalPromoOnInvoice).toBeGreaterThan(0);
      expect(breakdown.planned!.totalPromoOffInvoice).toBe(0);
    });
  });

  describe('validateSpendCalculations', () => {
    it('should validate mechanic values against min/max constraints', async () => {
      const planFu: Partial<PlanFu> = {
        id: mockFuId,
        planMechanicValues: [
          {
            id: 'pmv-1',
            enteredRatePct: 3,
            mechanic: {
              id: 'mech-1',
              code: 'CPP_ON',
              mechanicType: MechanicType.PERCENT,
              minValue: 5,
              maxValue: 10,
            } as Mechanic,
          } as PlanMechanicValue,
        ] as PlanMechanicValue[],
      };

      planFuRepo.find.mockResolvedValue([planFu] as PlanFu[]);

      const result = await service.validateSpendCalculations(
        mockTenantId,
        mockPlanId,
      );

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('below minimum');
    });
  });
});

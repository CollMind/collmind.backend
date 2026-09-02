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
  let planFuRepo: jest.Mocked<Repository<PlanFu>>;
  let mechanicRepo: jest.Mocked<Repository<Mechanic>>;
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
    planFuRepo = module.get(getRepositoryToken(PlanFu));
    mechanicRepo = module.get(getRepositoryToken(Mechanic));
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
   * this repo's history). `T-350` (`Z79 §7`) deleted the OTHER caller of
   * this method, `calculateAllSpendsForFU` (zero production callers), along
   * with the unit-level behavioural describe block that drove it through
   * that dead path. Live (unmocked) end-to-end coverage of proportional
   * base-volume distribution and null-base rejection now lives in
   * `test/recalc-perf-regression.e2e-spec.ts` and
   * `test/role-journey.e2e-spec.ts` (`LUMPSUM_DISTRIBUTION_NO_BASE_VOLUME`)
   * — both go through `PlanService#recalculatePlanWithKpiEngineLocked`, the
   * only live per-FU entry point.
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

    // `T-350` (`Z79 §7`): "eksik girdili SKU FU toplamına GİRMEZ, adıyla
    // raporlanır" testi buradaydı ve `calculateAllSpendsForFU` üzerinden
    // koşuyordu — metot silindi (zero production callers). `resolveSkuSpendInputs`
    // (`NOT_EVALUABLE`/`missing` alan adları) `sku-spend-inputs.spec.ts`'de
    // doğrudan, canlı-rota davranışı ise `q20-untouched-vs-partial-row-gate
    // .e2e-spec.ts` ve `submission-checks.spec.ts`'de zaten kanıtlı — ikinci
    // bir kopya yazılmadı (`§7` ailesi: aynı olgunun iki türetimi ayrışır).
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

  // `T-350` (`Z79 §7`): iki `describe` bloğu buradaydı —
  // "calculateAllSpendsForFU – tenant isolation (B-1)" ve
  // "calculateAllSpendsForFU – reads plan_fus.tactics (T-052)" — ikisi de
  // silinen `calculateAllSpendsForFU` üzerinden koşuyordu. Tenant izolasyonu
  // ve `tactics`/`plan_mechanic_values` birleşimi `buildMechanicValues`
  // testlerinde (aşağıda) ve canlı rotanın kendi tenant-scope guard'larında
  // zaten kanıtlı; ikinci bir kopya yazılmadı.

  /**
   * T-052: `buildMechanicValues` is the single shared derivation point the
   * one live per-FU spend path (`PlanService#recalculatePlanWithKpiEngineLocked`)
   * calls — asserted directly so the merge/precedence rule is pinned
   * regardless of caller. (`T-350`/`Z79 §7`: the other former caller,
   * `calculateAllSpendsForFU`, was deleted — zero production callers.)
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

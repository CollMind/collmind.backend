import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Kpi,
  FormulaType,
  CalculationLevel,
  DisplayFormat,
  AggregationMethod,
} from '../../../database/entities/kpi.entity';
import { KpiEngineService, CalculationResult } from './kpi-engine.service';
import { FormulaParserService } from './formula-parser.service';

/**
 * T-177 — `coverageRatio` + oran KPI'larının (`WEIGHTED_AVG`) üst seviyede
 * Σpay/Σpayda olarak yeniden hesaplanması.
 *
 * Kaynak: `.claude/backlog/tasks/T-177.md` — ürün sahibi kararı (2026-08-11):
 * "Değer + kapsama oranı göster, ve kapsama düşükse rengi geri çek."
 *
 * Fixture tasarımı bilinçli: SKU'lar FARKLI harcamalı (10000 / 90000 / 5000)
 * — eşit harcamada Σpay/Σpayda ile mean(oran) AYNI sonucu verir ve test
 * hiçbir şey ölçmez (CLAUDE.md §2.7 #6, T-101 dersi). Beklenen sayılar elle
 * hesaplanmış ondalık sabitler olarak yazılıyor — üretim formülünün ifadesi
 * (`pay/payda*100`) test içinde tekrar çalıştırılmıyor (§2.7 #8).
 */
describe('KpiEngineService — T-177 coverageRatio + ratio aggregation', () => {
  let service: KpiEngineService;
  let kpiRepo: { find: jest.Mock };

  let kpiIdCounter = 0;
  const makeKpi = (overrides: Partial<Kpi> & { kpiCode: string }): Kpi =>
    ({
      id: `kpi-${++kpiIdCounter}`,
      tenantId: 'tenant-1',
      kpiName: overrides.kpiCode,
      kpiGroup: 'Test',
      formulaType: FormulaType.EXPRESSION,
      formulaText: overrides.kpiCode,
      calculationOrder: 1,
      calculationLevel: CalculationLevel.SKU,
      displayFormat: DisplayFormat.PERCENTAGE,
      decimalPlaces: 2,
      showInGrid: true,
      isActive: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Kpi;

  // Real seed'in üçlüsünün küçültülmüş, kontrollü bir kopyası (kpi.seed.ts):
  // INCR_GP(SUM) / TOTAL_PLANNED_SPEND(SUM) -> GP_ROI_PCT(WEIGHTED_AVG).
  // calculationOrder INCR_GP(1) < TOTAL_PLANNED_SPEND(2) < GP_ROI_PCT(3) —
  // getActiveKpis calculationOrder ASC döner (mock burada elle sağlıyor),
  // yani GP_ROI_PCT işlenirken bağımlılıkları `results`'ta zaten hazır.
  const INCR_GP = makeKpi({
    kpiCode: 'INCR_GP',
    calculationOrder: 1,
    aggregationMethodFu: AggregationMethod.SUM,
    ragGreenThreshold: 1000,
    ragAmberThreshold: 500,
  });

  const TOTAL_PLANNED_SPEND = makeKpi({
    kpiCode: 'TOTAL_PLANNED_SPEND',
    calculationOrder: 2,
    aggregationMethodFu: AggregationMethod.SUM,
    // Gerçek KPI'da olduğu gibi eşik yok — harcamanın kendi rengi olmaz.
  });

  const GP_ROI_PCT = makeKpi({
    kpiCode: 'GP_ROI_PCT',
    calculationOrder: 3,
    aggregationMethodFu: AggregationMethod.WEIGHTED_AVG,
    formulaText: 'INCR_GP / TOTAL_PLANNED_SPEND * 100',
    ragGreenThreshold: 5,
    ragAmberThreshold: 1,
  });

  const skuResult = (
    value: number | null,
    ragStatus: 'RED' | 'AMBER' | 'GREEN' | null = null,
  ): CalculationResult => ({
    kpiCode: 'x',
    value,
    displayFormat: DisplayFormat.NUMBER,
    decimalPlaces: 2,
    ragStatus,
  });

  // --- Tam kapsama (3/3 SKU) — FARKLI harcamalı: 10000 / 90000 / 5000 ---
  //   SKU_A: INCR_GP=500,  SPEND=10000 -> per-SKU oran = 500/10000*100   =  5%
  //   SKU_B: INCR_GP=600,  SPEND=90000 -> per-SKU oran = 600/90000*100  =  0.6666666666666666%
  //   SKU_C: INCR_GP=1000, SPEND=5000  -> per-SKU oran = 1000/5000*100  = 20%
  const fullCoverageSkuResults: Array<Record<string, CalculationResult>> = [
    {
      INCR_GP: skuResult(500, 'AMBER'),
      TOTAL_PLANNED_SPEND: skuResult(10000, null),
      GP_ROI_PCT: skuResult(5, null),
    },
    {
      INCR_GP: skuResult(600, 'AMBER'),
      TOTAL_PLANNED_SPEND: skuResult(90000, null),
      GP_ROI_PCT: skuResult(0.6666666666666666, null),
    },
    {
      INCR_GP: skuResult(1000, 'GREEN'),
      TOTAL_PLANNED_SPEND: skuResult(5000, null),
      GP_ROI_PCT: skuResult(20, null),
    },
  ];

  // --- Kısmi kapsama (2/3 SKU) — SKU_C'nin COGS'u eksik (INCR_GP null) ---
  const partialCoverageSkuResults: Array<Record<string, CalculationResult>> = [
    {
      INCR_GP: skuResult(500, 'AMBER'),
      TOTAL_PLANNED_SPEND: skuResult(10000, null),
      GP_ROI_PCT: skuResult(5, null),
    },
    {
      INCR_GP: skuResult(600, 'AMBER'),
      TOTAL_PLANNED_SPEND: skuResult(90000, null),
      GP_ROI_PCT: skuResult(0.6666666666666666, null),
    },
    {
      INCR_GP: skuResult(null, null), // eksik COGS -> SKU-level null
      TOTAL_PLANNED_SPEND: skuResult(5000, null),
      GP_ROI_PCT: skuResult(null, null),
    },
  ];

  beforeEach(async () => {
    // getActiveKpis 60sn TTL'li bir setTimeout kuruyor; fake timers gerçek
    // bir OS handle'ı bırakmadan Jest'in temiz çıkmasını sağlar.
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KpiEngineService,
        FormulaParserService,
        { provide: getRepositoryToken(Kpi), useValue: { find: jest.fn() } },
      ],
    }).compile();

    service = module.get(KpiEngineService);
    kpiRepo = module.get(getRepositoryToken(Kpi));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('calculateFu — tam kapsama (3/3 SKU)', () => {
    beforeEach(() => {
      kpiRepo.find.mockResolvedValue([
        INCR_GP,
        TOTAL_PLANNED_SPEND,
        GP_ROI_PCT,
      ]);
    });

    it("INCR_GP (SUM): coverageRatio 1, ragStatus SKU'ların worst-case'i", async () => {
      const result = await service.calculateFu(
        'tenant-1',
        fullCoverageSkuResults,
        {},
      );

      // elle: 500 + 600 + 1000
      expect(result.INCR_GP.value).toBe(2100);
      expect(result.INCR_GP.coverageRatio).toBe(1);
      // skuRags = [AMBER, AMBER, GREEN] -> RED yok, AMBER var -> worst-case AMBER
      expect(result.INCR_GP.ragStatus).toBe('AMBER');

      // elle: 10000 + 90000 + 5000
      expect(result.TOTAL_PLANNED_SPEND.value).toBe(105000);
      expect(result.TOTAL_PLANNED_SPEND.coverageRatio).toBe(1);
    });

    it('GP_ROI_PCT (WEIGHTED_AVG): Σ INCR_GP/Σ SPEND kullanır, mean(oran) DEĞİL', async () => {
      const result = await service.calculateFu(
        'tenant-1',
        fullCoverageSkuResults,
        {},
      );

      // elle: Σ INCR_GP=2100, Σ SPEND=105000 -> 2100/105000*100 = 2 (tam)
      expect(result.GP_ROI_PCT.value).toBeCloseTo(2, 9);
      expect(result.GP_ROI_PCT.coverageRatio).toBe(1);
      // green=5, amber=1 -> 2 < green, >= amber -> AMBER
      expect(result.GP_ROI_PCT.ragStatus).toBe('AMBER');
    });

    it("KONTROL GRUBU: eski ağırlıksız mean(oran) AYNI fixture'de FARKLI bir sayı üretir", () => {
      // Eski (T-177 öncesi) davranışın elle yazılmış kopyası — production
      // kodu ÇAĞIRMIYOR (aggregate()'in WEIGHTED_AVG dalı artık throw ediyor).
      // Bu, fixture'ın iki yöntemi gerçekten ayırt ettiğinin kanıtı.
      const perSkuRatios = [5, 0.6666666666666666, 20];
      const naiveMean =
        perSkuRatios.reduce((a, b) => a + b, 0) / perSkuRatios.length;

      // elle: (5 + 0.6666666666666666 + 20) / 3 = 25.666666666666668 / 3
      expect(naiveMean).toBeCloseTo(8.555555556, 6);
      // yeni (ağırlıklı) sonuç 2 idi — bariz farklı, fixture ayırt ediyor
      expect(naiveMean).not.toBeCloseTo(2, 1);
    });
  });

  describe('calculateFu — kısmi kapsama (2/3 SKU, SKU_C eksik COGS)', () => {
    beforeEach(() => {
      kpiRepo.find.mockResolvedValue([
        INCR_GP,
        TOTAL_PLANNED_SPEND,
        GP_ROI_PCT,
      ]);
    });

    it('INCR_GP: değer hesaplanabilir alt kümeden gelir, coverageRatio<1, ragStatus null', async () => {
      const result = await service.calculateFu(
        'tenant-1',
        partialCoverageSkuResults,
        {},
      );

      // elle: 500 + 600 (SKU_C null -> susturulmadan dışlandı, kapsamada görünür)
      expect(result.INCR_GP.value).toBe(1100);
      // elle: 2/3
      expect(result.INCR_GP.coverageRatio).toBeCloseTo(0.6666666666666666, 10);
      // 1100 >= green(1000) olsa da kısmi kapsamada RAG ASLA atanmaz
      expect(result.INCR_GP.ragStatus).toBeNull();
    });

    it("GP_ROI_PCT: KESİŞİM kuralı — SKU_C'nin SPEND'i dolu olsa da INCR_GP'si null olduğu için paydan DA dışlanır (T-177 B1)", async () => {
      const result = await service.calculateFu(
        'tenant-1',
        partialCoverageSkuResults,
        {},
      );

      // T-177 B1 blocker düzeltmesi (recomputeRatioFromChildren): kesişim
      // kuralı — SKU_C'nin bağımlılıklarından biri (INCR_GP) null olduğu
      // için SKU_C hem paydan HEM PAYDADAN tamamen dışlanır; SPEND=5000
      // dolu olması onu paydada TUTMAZ. B1'den ÖNCEki (yanlış) davranış
      // paydayı SPEND'in KENDİ non-null kümesinden (3 SKU) alıyordu ve bu
      // testin eski pinlediği değer 1.047619048 = 1100/105000*100 idi.
      // elle (kesişim, yalnız SKU_A + SKU_B): Σ INCR_GP=500+600=1100,
      // Σ SPEND=10000+90000=100000 -> 1100/100000*100 = 1.1 (tam)
      expect(result.GP_ROI_PCT.value).toBeCloseTo(1.1, 9);
      // kesişim = 2/3 (SKU_A, SKU_B'nin ikisi de dolu). Bu fixture'da SPEND
      // hiç null olmadığı için intersection == min(INCR_GP.coverage,
      // SPEND.coverage) TESADÜFEN aynı çıkıyor — bu tesadüfü ayıran test
      // aşağıda: "kesişim PAYDAYI da daraltır".
      expect(result.GP_ROI_PCT.coverageRatio).toBeCloseTo(
        0.6666666666666666,
        10,
      );
      expect(result.GP_ROI_PCT.ragStatus).toBeNull();
    });

    it('KONTROL GRUBU (kısmi): eski mean(oran) burada da FARKLI bir sayı üretir', () => {
      const perSkuRatios = [5, 0.6666666666666666]; // SKU_C null -> eski kod da elerdi
      const naiveMean =
        perSkuRatios.reduce((a, b) => a + b, 0) / perSkuRatios.length;

      // elle: (5 + 0.6666666666666666) / 2 = 5.666666666666667 / 2
      expect(naiveMean).toBeCloseTo(2.833333333, 6);
      // yeni (kesişim) sonuç 1.1 idi — bariz farklı, fixture ayırt ediyor
      expect(naiveMean).not.toBeCloseTo(1.1, 1);
    });
  });

  describe('calculateFu — hiç hesaplanabilir çocuk yok', () => {
    it('boş skuResults dizisi: value null, coverageRatio NULL (0 DEĞİL — hiç çocuk yoktu)', async () => {
      kpiRepo.find.mockResolvedValue([INCR_GP]);

      const result = await service.calculateFu('tenant-1', [], {});

      expect(result.INCR_GP.value).toBeNull();
      // Kod: totalSkuCount === 0 ? null : ... — boş küme "0/0" değil "bilinmiyor"
      expect(result.INCR_GP.coverageRatio).toBeNull();
    });

    it('2 SKU, ikisi de null: value null, coverageRatio 0 (boş kümeden AYRI davranış)', async () => {
      kpiRepo.find.mockResolvedValue([INCR_GP]);

      const twoNullSkus: Array<Record<string, CalculationResult>> = [
        { INCR_GP: skuResult(null, null) },
        { INCR_GP: skuResult(null, null) },
      ];
      const result = await service.calculateFu('tenant-1', twoNullSkus, {});

      expect(result.INCR_GP.value).toBeNull();
      expect(result.INCR_GP.coverageRatio).toBe(0);
    });
  });

  describe('iki seviye: SKU→FU→Plan', () => {
    it('FU_X (kısmi) + FU_Y (tam) plan seviyesinde birleşiyor — kapsama ÇARPIMSAL değil (şartname)', async () => {
      kpiRepo.find.mockResolvedValue([
        INCR_GP,
        TOTAL_PLANNED_SPEND,
        GP_ROI_PCT,
      ]);

      const fuX = await service.calculateFu(
        'tenant-1',
        partialCoverageSkuResults,
        {},
      );
      const fuY = await service.calculateFu(
        'tenant-1',
        fullCoverageSkuResults,
        {},
      );

      const plan = await service.calculatePlan('tenant-1', [fuX, fuY]);

      // Her iki FU da bir INCR_GP değeri ÜRETTİ (1100 ve 2100) -> plan
      // coverageRatio = 2/2 = 1. Bu, FU_X'in kendi İÇİNDEKİ kısmi kapsamayı
      // (0.667) YANSITMAZ — ürün sahibinin şartı ("FU'nun kapsaması
      // SKU'larından, planın kapsaması FU'larından" — çarpımsal değil,
      // T-177 notu). Bilinen sınır, bilinçli — pinleniyor, "düzeltilmiyor".
      expect(plan.INCR_GP.value).toBe(3200); // 1100 + 2100
      expect(plan.INCR_GP.coverageRatio).toBe(1);
      // fuRags: FU_X.INCR_GP.ragStatus=null (filtrelenir), FU_Y.INCR_GP.ragStatus='AMBER'
      // -> worst-case AMBER
      expect(plan.INCR_GP.ragStatus).toBe('AMBER');

      expect(plan.TOTAL_PLANNED_SPEND.value).toBe(210000); // 105000 + 105000
      expect(plan.TOTAL_PLANNED_SPEND.coverageRatio).toBe(1);

      // elle: Σ INCR_GP=3200, Σ SPEND=210000 -> 3200/210000*100
      // = 32/2100 = 32/21/100; 32/21 = 1.523809523809523809... (tekrar "238095")
      // *100'e göre zaten normalize: 1.5238095238095237...
      // ⛔ BU DEĞER YANLIŞ ve bilerek pinleniyor — "doğru" diye okunmasın.
      //
      // 1.5238 = 3200/210000, ve payda FU_X'in ÜÇ SKU'sundan, pay İKİ
      // SKU'sundan geliyor: yani hâlâ iki bağımsız popülasyonun bölümü
      // (B1'in ta kendisi, bir seviye yukarıda). Dürüst kesişim değeri
      // 3200/205000*100 = 1.5610 (6 SKU'nun 5'i çözülüyor).
      //
      // Sebep: plan seviyesindeki kesişim FU'lar üzerinde alınıyor, ama B1
      // SKU'lar üzerindeydi — kpi-engine.service.ts'in calculatePlan
      // WEIGHTED_AVG dalındaki uzun nota bak. Kapanışı FU sonucunun kendi
      // kesişim toplamlarını taşımasını gerektiriyor → T-191.
      //
      // Bu satır T-191 inince KIRILACAK ve beklenen değer 1.5610 olacak.
      // Kırıldığında "pinlenmiş sınır" diye geri alınmamalı.
      expect(plan.GP_ROI_PCT.value).toBeCloseTo(1.523809524, 8);
      // ⚠️ Aynı sebeple kapsama da 1 görünüyor: FU_X bir değer ürettiği için
      // "çözüldü" sayılıyor, kendi iç kısmi kapsaması (0.667) taşınmıyor.
      expect(plan.GP_ROI_PCT.coverageRatio).toBe(1);
      // 1.52 -> < green(5), >= amber(1) -> AMBER
      expect(plan.GP_ROI_PCT.ragStatus).toBe('AMBER');
    });
  });

  describe('calculateFu — WEIGHTED_AVG: kesişim PAYDAYI da daraltır (ayırt edici fixture)', () => {
    // Yukarıdaki "kısmi kapsama" fixture'ında SPEND hiç null olmadığı için
    // kesişim kapsaması (validChildren/total) ile B1-öncesi "her bağımlılık
    // kendi kapsamasından, min al" yaklaşımı TESADÜFEN aynı sayıyı (2/3)
    // üretiyordu. Burada iki bağımlılık FARKLI SKU'larda null — biri
    // diğerini İÇERMİYOR (nested değil) — ki min(kapsama) ile
    // kesişim(kapsama) AYRIŞSIN:
    //   SKU_A: INCR_GP=null (SPEND=1000 dolu)  -> yalnız INCR_GP'de eksik
    //   SKU_B: SPEND=null   (INCR_GP=200 dolu) -> yalnız SPEND'de eksik
    //   SKU_C: ikisi de dolu (INCR_GP=300, SPEND=2000)
    // INCR_GP kapsaması (kendi başına) = 2/3 (SKU_B, SKU_C dolu)
    // SPEND kapsaması (kendi başına)   = 2/3 (SKU_A, SKU_C dolu)
    // min(2/3, 2/3) = 2/3  <- B1-öncesi yaklaşımın üreteceği sayı
    // kesişim (İKİSİ de dolu olan SKU'lar) = yalnız SKU_C -> 1/3
    const denominatorNarrowingSkuResults: Array<
      Record<string, CalculationResult>
    > = [
      {
        INCR_GP: skuResult(null, null),
        TOTAL_PLANNED_SPEND: skuResult(1000, null),
        GP_ROI_PCT: skuResult(null, null),
      },
      {
        INCR_GP: skuResult(200, null),
        TOTAL_PLANNED_SPEND: skuResult(null, null),
        GP_ROI_PCT: skuResult(null, null),
      },
      {
        INCR_GP: skuResult(300, 'GREEN'),
        TOTAL_PLANNED_SPEND: skuResult(2000, null),
        GP_ROI_PCT: skuResult(15, 'GREEN'),
      },
    ];

    beforeEach(() => {
      kpiRepo.find.mockResolvedValue([
        INCR_GP,
        TOTAL_PLANNED_SPEND,
        GP_ROI_PCT,
      ]);
    });

    it("GP_ROI_PCT: coverageRatio kesişimden (1/3) gelir, min(bağımlılık kapsamaları)'ndan (2/3) DEĞİL", async () => {
      const result = await service.calculateFu(
        'tenant-1',
        denominatorNarrowingSkuResults,
        {},
      );

      // elle: yalnız SKU_C her iki bağımlılığa da sahip -> Σ INCR_GP=300,
      // Σ SPEND=2000 -> 300/2000*100 = 15 (tam)
      expect(result.GP_ROI_PCT.value).toBeCloseTo(15, 9);
      // kesişim = 1/3. min(2/3, 2/3) = 2/3 OLSAYDI (B1-öncesi davranış) bu
      // 0.6666... olurdu — ayırt edici assertion budur.
      expect(result.GP_ROI_PCT.coverageRatio).toBeCloseTo(
        0.3333333333333333,
        10,
      );
      expect(result.GP_ROI_PCT.ragStatus).toBeNull(); // coverage < 1
    });
  });

  describe("calculateFu — WEIGHTED_AVG FU RAG (S4): kendi değerine göre, çocuk SKU'ların en kötüsüne göre DEĞİL", () => {
    // Yukarıdaki "tam kapsama" fixture'ında GP_ROI_PCT'in SKU-seviyesi
    // ragStatus'ları hep null (skuResult(value, null)) — yani S4 davranışı
    // (worst-of-children KULLANILMIYOR) o fixture'da TESADÜFEN pinleniyordu:
    // worst-of-children de boş/null bir listeyle karşılaşıp aynı sonuca
    // varırdı. Burada kasıtlı olarak bir SKU RED bırakılıyor ve FU'nun
    // KENDİ (kesişim) değeri GREEN çıkıyor — worst-of-children ile
    // kendi-değer arasındaki ayrımı görünür kılan asıl vaka bu.
    //   SKU_A: INCR_GP=10,    SPEND=100000 -> per-SKU oran=0.01%  -> RED
    //   SKU_B: INCR_GP=6000,  SPEND=10000  -> per-SKU oran=60%    -> GREEN
    //   SKU_C: INCR_GP=6000,  SPEND=10000  -> per-SKU oran=60%    -> GREEN
    // FU'nun KENDİ değeri: Σ INCR_GP=12010, Σ SPEND=120000
    // -> 12010/120000*100 = 10.008333...% -> green(5) eşiğinin üstünde
    // -> GREEN. worst-of-children olsaydı: skuRags=[RED,GREEN,GREEN] ->
    // RED baskın çıkardı.
    const oneSkuRedFuGreenSkuResults: Array<Record<string, CalculationResult>> =
      [
        {
          INCR_GP: skuResult(10, null),
          TOTAL_PLANNED_SPEND: skuResult(100000, null),
          GP_ROI_PCT: skuResult(0.01, 'RED'),
        },
        {
          INCR_GP: skuResult(6000, null),
          TOTAL_PLANNED_SPEND: skuResult(10000, null),
          GP_ROI_PCT: skuResult(60, 'GREEN'),
        },
        {
          INCR_GP: skuResult(6000, null),
          TOTAL_PLANNED_SPEND: skuResult(10000, null),
          GP_ROI_PCT: skuResult(60, 'GREEN'),
        },
      ];

    beforeEach(() => {
      kpiRepo.find.mockResolvedValue([
        INCR_GP,
        TOTAL_PLANNED_SPEND,
        GP_ROI_PCT,
      ]);
    });

    it("bir SKU RED, FU toplamı GREEN: FU RAG'i kendi (kesişim) değerine göre GREEN çıkar", async () => {
      const result = await service.calculateFu(
        'tenant-1',
        oneSkuRedFuGreenSkuResults,
        {},
      );

      // elle: Σ INCR_GP=10+6000+6000=12010, Σ SPEND=100000+10000+10000=120000
      // -> 12010/120000*100 = 10.008333333333334 (tam kapsama, 3/3)
      expect(result.GP_ROI_PCT.coverageRatio).toBe(1);
      expect(result.GP_ROI_PCT.value).toBeCloseTo(10.008333333, 8);
      // green(5) eşiğinin üstünde -> GREEN — SKU_A'nın RED'i sonuca
      // GİRMEDİ (worst-of-children olsaydı RED çıkardı).
      expect(result.GP_ROI_PCT.ragStatus).toBe('GREEN');
    });
  });

  describe('aggregate() — WEIGHTED_AVG güvenlik ağı', () => {
    it('aggregate() içine doğrudan WEIGHTED_AVG verilirse throw eder — bu yola üretimde düşülmemeli', () => {
      // Team Lead doğrulaması (T-177 notu): her iki çağrı noktası
      // (calculateFu:~127, calculatePlan:~297) aggregate()'ten ÖNCE
      // WEIGHTED_AVG'ı yakalıyor ve recomputeRatioFromChildren'a
      // yönlendiriyor — bu bir güvenlik ağı, canlı yolda tetiklenmez.
      expect(() =>
        (service as any).aggregate([1, 2, 3], AggregationMethod.WEIGHTED_AVG),
      ).toThrow(/received WEIGHTED_AVG directly/);
    });
  });
});

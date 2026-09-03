import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Kpi,
  FormulaType,
  CalculationLevel,
  AggregationMethod,
  DisplayFormat,
} from '../../../database/entities/kpi.entity';
import { KpiEngineService } from './kpi-engine.service';
import { FormulaParserService } from './formula-parser.service';
import { RagExclusionReason } from '../../../common/kpi/rag-quadrant';

/**
 * `BL-4b` (`Z90 §2` · `Z91 §3`) — `BASELINE_MISSING`'İ ATAYAN üretici.
 *
 * PİN 1/2/3 — brief `docs/process/BL4B_URETICI_BRIEF.md §5`. `calculateSku`
 * gerçek üretim yolu (`resolveCarrierRag` → `attributeBaselineMissing`,
 * `kpi-engine.service.ts`) üzerinden çağrılır — DB YOK, `kpiRepo.find` sabit
 * bir katalog döner (repo genelindeki desen, bkz. `kpi-engine.service.spec.ts`
 * T-177 fixture'ı).
 *
 * Katalog basitleştirilmiş (gerçek `kpi.seed.ts`'in küçültülmüş bir alt
 * kümesi): `INCR_TO`/`INCR_GP` doğrudan `PLAN_VOL - BASE_VOL`'a bağlanır —
 * ekonomik anlam BRD'nin GSV/COGS zincirinden gelir, ama null-yayılımı
 * (`BASE_VOL` null ⇒ ikisi de null) AYNI mekanizmadır (`formula-parser.
 * service.ts:165-166`), bu yüzden fixture üretim davranışını doğru temsil
 * eder.
 */
describe('KpiEngineService — BL-4b BASELINE_MISSING üreticisi', () => {
  let service: KpiEngineService;
  let kpiRepo: { find: jest.Mock };

  let idCounter = 0;
  const makeKpi = (overrides: Partial<Kpi> & { kpiCode: string }): Kpi =>
    ({
      id: `kpi-${++idCounter}`,
      tenantId: 'tenant-1',
      kpiName: overrides.kpiCode,
      kpiGroup: 'Test',
      formulaType: FormulaType.EXPRESSION,
      formulaText: overrides.kpiCode,
      calculationOrder: 1,
      calculationLevel: CalculationLevel.SKU,
      displayFormat: DisplayFormat.NUMBER,
      decimalPlaces: 2,
      showInGrid: true,
      isActive: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Kpi;

  const BASE_VOL = makeKpi({
    kpiCode: 'BASE_VOL',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'BASE_VOL',
    calculationOrder: 1,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const PLAN_VOL = makeKpi({
    kpiCode: 'PLAN_VOL',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'PLAN_VOL',
    calculationOrder: 2,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const INCR_VOL = makeKpi({
    kpiCode: 'INCR_VOL',
    formulaText: 'PLAN_VOL - BASE_VOL',
    dependsOnKpis: ['PLAN_VOL', 'BASE_VOL'],
    calculationOrder: 3,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  // `INCR_TO`/`INCR_GP` gerçek BRD zincirinde ayrı formüllerdir (GSV/COGS
  // üzerinden); burada null-yayılım davranışını izole etmek için AYNI
  // `BASE_VOL` bağımlılığını taşıyan basitleştirilmiş ifadeler kullanılıyor.
  const INCR_TO = makeKpi({
    kpiCode: 'INCR_TO',
    formulaText: '(PLAN_VOL - BASE_VOL) * 10',
    dependsOnKpis: ['PLAN_VOL', 'BASE_VOL'],
    calculationOrder: 4,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  // `COGS_INPUT` — kontrol testinin AYIRT EDİCİ girdisi: `INCR_GP`'yi
  // `BASE_VOL`'DAN BAĞIMSIZ bir sebeple null'a düşürür, ki
  // `attributeBaselineMissing`'in "her null-reason'ı BASELINE_MISSING'e mal
  // etme" sınırı gerçekten sınansın (yanlış-pozitif kontrolü).
  const COGS_INPUT = makeKpi({
    kpiCode: 'COGS_INPUT',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'COGS_INPUT',
    calculationOrder: 4.5,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const INCR_GP = makeKpi({
    kpiCode: 'INCR_GP',
    formulaText: '(PLAN_VOL - BASE_VOL) * 2 - COGS_INPUT',
    dependsOnKpis: ['PLAN_VOL', 'BASE_VOL', 'COGS_INPUT'],
    calculationOrder: 5,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const INCR_PROMO_SPEND = makeKpi({
    kpiCode: 'INCR_PROMO_SPEND',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'INCR_PROMO_SPEND',
    calculationOrder: 6,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const GP_ROI_PCT = makeKpi({
    kpiCode: 'GP_ROI_PCT',
    formulaText: 'INCR_GP / INCR_PROMO_SPEND * 100',
    dependsOnKpis: ['INCR_GP', 'INCR_PROMO_SPEND'],
    calculationOrder: 48,
    aggregationMethodFu: AggregationMethod.WEIGHTED_AVG,
  });

  const CATALOG = [
    BASE_VOL,
    PLAN_VOL,
    INCR_VOL,
    INCR_TO,
    COGS_INPUT,
    INCR_GP,
    INCR_PROMO_SPEND,
    GP_ROI_PCT,
  ];

  beforeEach(async () => {
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
    kpiRepo.find.mockResolvedValue(CATALOG);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // PİN 1 — baseline NULL ⇒ ragExclusionReason === 'BASELINE_MISSING'
  it('PİN 1 — baseline NULL ⇒ NOT_EVALUABLE eksenler + BASELINE_MISSING', async () => {
    const results = await service.calculateSku('tenant-1', {
      BASE_VOL: null,
      PLAN_VOL: 100,
      BPTT: null,
      COGS: null,
      COGS_INPUT: 10,
      INCR_PROMO_SPEND: 500,
    });

    expect(results['INCR_VOL'].value).toBeNull();
    expect(results['INCR_TO'].value).toBeNull();
    expect(results['INCR_GP'].value).toBeNull();
    expect(results['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(results['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.BASELINE_MISSING,
    );
  });

  // PİN 2 — baseline SIFIR (0) ⇒ uplift === plannedVolume, sebep NULL
  // (AYNI koşumdan — aynı `it` bloğu değil ama AYNI test dosyası/koşumu,
  // brief `§5` "AYNI KOŞUMDAN" şartı bu iki testin BİRLİKTE, tek `npm test`
  // çağrısında yürütülmesiyle karşılanıyor).
  it('PİN 2 — baseline SIFIR (0) ⇒ uplift === plannedVolume, sebep NULL', async () => {
    const plannedVolume = 100;
    const results = await service.calculateSku('tenant-1', {
      BASE_VOL: 0,
      PLAN_VOL: plannedVolume,
      BPTT: null,
      COGS: null,
      COGS_INPUT: 10,
      INCR_PROMO_SPEND: 500,
    });

    expect(results['INCR_VOL'].value).toBe(plannedVolume);
    expect(results['GP_ROI_PCT'].ragExclusionReason).toBeNull();
    // `0 ≠ NULL` — renk ÜRETİLİR (VERİ dalına hiç düşülmedi).
    expect(results['GP_ROI_PCT'].ragStatus).not.toBeNull();
  });

  // Kontrol (yanlış-pozitif taraması) — baseline DOLU ama `INCR_GP`
  // BAŞKA bir sebeple (`COGS_INPUT` eksik) null'a düşüyor ⇒ reason GENEL
  // `null` kalmalı, BASELINE_MISSING'e YANLIŞ ATIF yapılmamalı.
  // `attributeBaselineMissing` yalnız `baseVolValue === null`'a bakar —
  // bu test onun `INCR_GP === null` olan HER durumu BASELINE_MISSING
  // SANMADIĞINI doğrular.
  it('kontrol — baseline DOLU, COGS_INPUT eksik ⇒ reason null (BASELINE_MISSING DEĞİL)', async () => {
    const results = await service.calculateSku('tenant-1', {
      BASE_VOL: 50,
      PLAN_VOL: 100,
      BPTT: null,
      COGS: null,
      COGS_INPUT: null,
      INCR_PROMO_SPEND: 500,
    });

    expect(results['INCR_TO'].value).not.toBeNull(); // baseline var, iTO hesaplanabilir
    expect(results['INCR_GP'].value).toBeNull(); // COGS_INPUT eksik yüzünden
    expect(results['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(results['GP_ROI_PCT'].ragExclusionReason).toBeNull();
  });
});

/**
 * `BL-4b` ikinci tur — `code-reviewer` ölçümüyle (2026-09-03, `ts-node`,
 * gerçek KPI kataloğuyla) açığa çıkan boşluk: SKU seviyesindeki
 * `BASELINE_MISSING` üretimi (yukarıdaki describe) FU/plan seviyesine hiç
 * TAŞINMIYORDU — eski kapsama kapısı (`kpi-engine.service.ts` eski
 * `resolveCarrierRag`) `c = 0`'ı (TAM YOKLUK) `0 < c < 1` (KISMİ kapsama,
 * `K-2.4.22`'nin koruduğu vaka) ile AYNI dala düşürüyor, ikisinde de
 * `reason: null` üretiyordu.
 *
 * Ürün sahibi hükmü (bu turun brief'i): iki dünya AYRI olgudur —
 * ```
 * c = 0        (BASE_VOL'un KENDİSİ hiçbir SKU'da yok)  ⇒ BASELINE_MISSING (Z90 §2)
 * 0 < c < 1    (bazı SKU'larda var, bazılarında yok)      ⇒ reason null (K-2.4.22, DEĞİŞMEDİ)
 * ```
 *
 * PİN A–D burada, gerçek üretim yolu (`calculateSku` → `calculateFu` →
 * `calculatePlan`, DB YOK) üzerinden, **AYNI KOŞUMDA** (tek `npm test`
 * çağrısı, `describe` içindeki dört `it`) ayrıştırılır. Katalog yukarıdaki
 * describe'la PAYLAŞILIR (`CATALOG`, `service`, `kpiRepo`) — ayrı bir
 * fixture icat edilmedi (`§7`: aynı yeteneğin ikinci bir kopyası açılmasın).
 */
describe('KpiEngineService — BL-4b FU/PLAN düzeyi: c=0 (TAM YOKLUK) vs 0<c<1 (KISMİ)', () => {
  let service: KpiEngineService;
  let kpiRepo: { find: jest.Mock };

  let idCounter = 0;
  const makeKpi = (overrides: Partial<Kpi> & { kpiCode: string }): Kpi =>
    ({
      id: `kpi-fu-${++idCounter}`,
      tenantId: 'tenant-1',
      kpiName: overrides.kpiCode,
      kpiGroup: 'Test',
      formulaType: FormulaType.EXPRESSION,
      formulaText: overrides.kpiCode,
      calculationOrder: 1,
      calculationLevel: CalculationLevel.SKU,
      displayFormat: DisplayFormat.NUMBER,
      decimalPlaces: 2,
      showInGrid: true,
      isActive: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as Kpi;

  const BASE_VOL = makeKpi({
    kpiCode: 'BASE_VOL',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'BASE_VOL',
    calculationOrder: 1,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const PLAN_VOL = makeKpi({
    kpiCode: 'PLAN_VOL',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'PLAN_VOL',
    calculationOrder: 2,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const INCR_TO = makeKpi({
    kpiCode: 'INCR_TO',
    formulaText: '(PLAN_VOL - BASE_VOL) * 10',
    dependsOnKpis: ['PLAN_VOL', 'BASE_VOL'],
    calculationOrder: 4,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const COGS_INPUT = makeKpi({
    kpiCode: 'COGS_INPUT',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'COGS_INPUT',
    calculationOrder: 4.5,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const INCR_GP = makeKpi({
    kpiCode: 'INCR_GP',
    formulaText: '(PLAN_VOL - BASE_VOL) * 2 - COGS_INPUT',
    dependsOnKpis: ['PLAN_VOL', 'BASE_VOL', 'COGS_INPUT'],
    calculationOrder: 5,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const INCR_PROMO_SPEND = makeKpi({
    kpiCode: 'INCR_PROMO_SPEND',
    formulaType: FormulaType.USER_INPUT,
    formulaText: 'INCR_PROMO_SPEND',
    calculationOrder: 6,
    aggregationMethodFu: AggregationMethod.SUM,
  });
  const GP_ROI_PCT = makeKpi({
    kpiCode: 'GP_ROI_PCT',
    formulaText: 'INCR_GP / INCR_PROMO_SPEND * 100',
    dependsOnKpis: ['INCR_GP', 'INCR_PROMO_SPEND'],
    calculationOrder: 48,
    aggregationMethodFu: AggregationMethod.WEIGHTED_AVG,
  });

  const CATALOG = [
    BASE_VOL,
    PLAN_VOL,
    INCR_TO,
    COGS_INPUT,
    INCR_GP,
    INCR_PROMO_SPEND,
    GP_ROI_PCT,
  ];

  beforeEach(async () => {
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
    kpiRepo.find.mockResolvedValue(CATALOG);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Ortak SKU inşası — her PİN kendi BASE_VOL/COGS_INPUT kombinasyonunu
  // verir. `promoSpend` VARSAYILAN `500` (PİN A-D'nin promosyon-değerlendirmesi
  // dünyası) — `Z94 §1` (PİN F/G) `0` geçerek LTA_ONLY dünyasını sınar.
  const sku = (
    baseVol: number | null,
    cogsInput: number | null,
    promoSpend: number | null = 500,
  ): ReturnType<KpiEngineService['calculateSku']> =>
    service.calculateSku('tenant-1', {
      BASE_VOL: baseVol,
      PLAN_VOL: 100,
      BPTT: null,
      COGS: null,
      COGS_INPUT: cogsInput,
      INCR_PROMO_SPEND: promoSpend,
    });

  // ⚠️ PLAN seviyesi İKİ FU ile beslenir (tek FU'luk bir dizi DEĞİL): tek
  // FU'lu bir `calculatePlan([fu])` çağrısı FU'nun KENDİ İÇİNDEKİ kısmi
  // kapsamayı (SKU→FU) plan seviyesinde SESSİZCE TAM kapsamaya çevirir
  // (`fr['X']?.value` filtrelemesi FU'nun `value`'sunu görür,
  // `coverageRatio`'sunu değil — tek eleman varsa "1 dolu / 1 toplam" =
  // 1). Bu YANLIŞ bir PİN üretirdi (ilk taslakta yakalandı, kendi
  // ölçümümle): `PİN B`'nin FU'daki `0<c<1`'i plan'da `c=1`'e döner ve
  // `GP_ROI_PCT` `GREEN` çıkardı — kısmi kapsama plan katmanında
  // kaybolmuş olurdu. Kapsamayı plan seviyesinde de GERÇEKTEN kısmi
  // tutmak için PLAN her PİN'de İKİ AYRI FU alır.
  const twoSkuFu = (
    baseVolA: number | null,
    baseVolB: number | null,
    promoSpend: number | null = 500,
  ) =>
    Promise.all([
      sku(baseVolA, 10, promoSpend),
      sku(baseVolB, 10, promoSpend),
    ]).then(([s1, s2]) => service.calculateFu('tenant-1', [s1, s2], {}));

  // PİN A — TÜM SKU'larda BASE_VOL null (c = 0, aggregate([]) = null)
  // ⇒ FU VE plan seviyesinde reason = BASELINE_MISSING.
  it('PİN A — tüm SKU baseline NULL (c=0) ⇒ FU+PLAN reason=BASELINE_MISSING', async () => {
    const fu = await twoSkuFu(null, null);
    expect(fu['BASE_VOL'].coverageRatio).toBe(0);
    expect(fu['BASE_VOL'].value).toBeNull();
    expect(fu['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(fu['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.BASELINE_MISSING,
    );

    // İki FU'nun ikisi de baseline'sız — plan seviyesinde de c=0.
    const fu2 = await twoSkuFu(null, null);
    const plan = await service.calculatePlan('tenant-1', [fu, fu2]);
    expect(plan['BASE_VOL'].coverageRatio).toBe(0);
    expect(plan['BASE_VOL'].value).toBeNull();
    expect(plan['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(plan['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.BASELINE_MISSING,
    );
  });

  // PİN B — KARIŞIK: FU seviyesinde 1 SKU dolu/1 null (0<c<1); PLAN
  // seviyesinde de 1 FU baseline'sız/1 FU baseline'lı (0<c<1) — reason
  // null (K-2.4.22 kapsama kuralı — DEĞİŞMEDİ, TAM YOKLUK DEĞİL).
  it('PİN B — karışık (0<c<1) ⇒ FU+PLAN reason null (BASELINE_MISSING DEĞİL)', async () => {
    const fu = await twoSkuFu(null, 50);
    expect(fu['BASE_VOL'].coverageRatio).toBe(0.5);
    expect(fu['BASE_VOL'].value).toBe(50); // yalnız dolu SKU — sessizce 0 DEĞİL
    expect(fu['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(fu['GP_ROI_PCT'].ragExclusionReason).toBeNull(); // BASELINE_MISSING DEĞİL

    // Plan: `fu`'nun (yukarıdaki, KENDİ İÇİNDE karışık) BASE_VOL.value'su
    // `50` — yani plan seviyesinde "dolu" sayılır (`fr['BASE_VOL']?.value`
    // filtresi FU'nun coverageRatio'suna değil `value`'suna bakar, ve `fu`
    // aggregate SUM'dan gelen SIFIR-OLMAYAN bir değer taşıyor). Plan'da
    // gerçek `0<c<1`'i üretmek için 1 FU TAMAMEN baseline'sız (`fuAllNull`,
    // value=null), 1 FU TAMAMEN baseline'lı (`fuAllFull`) kullanılır —
    // FU'nun KENDİ İÇİNDEKİ ayrım burada PLAN'ın kapsama biriminden
    // (FU sayısı) FARKLI bir düzey, bkz. `twoSkuFu` üstündeki not.
    const fuAllNull = await twoSkuFu(null, null);
    const fuAllFull = await twoSkuFu(50, 30);
    const plan = await service.calculatePlan('tenant-1', [
      fuAllNull,
      fuAllFull,
    ]);
    expect(plan['BASE_VOL'].coverageRatio).toBe(0.5);
    expect(plan['BASE_VOL'].value).toBe(80); // yalnız `fuAllFull` — sessizce 0 DEĞİL
    expect(plan['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(plan['GP_ROI_PCT'].ragExclusionReason).toBeNull();
  });

  // PİN C — TÜM SKU'larda / TÜM FU'larda BASE_VOL dolu (c = 1) ⇒ kadran
  // normal çalışır, reason null (BASELINE_MISSING'e YANLIŞ ATIF olmaz).
  it('PİN C — tüm baseline dolu (c=1) ⇒ kadran üretilir, reason null', async () => {
    const fu = await twoSkuFu(50, 30);
    expect(fu['BASE_VOL'].coverageRatio).toBe(1);
    expect(fu['BASE_VOL'].value).toBe(80);
    expect(fu['GP_ROI_PCT'].ragExclusionReason).toBeNull();
    expect(fu['GP_ROI_PCT'].ragStatus).not.toBeNull(); // kadran rengi üretildi

    const fu2 = await twoSkuFu(40, 60);
    const plan = await service.calculatePlan('tenant-1', [fu, fu2]);
    expect(plan['BASE_VOL'].coverageRatio).toBe(1);
    expect(plan['GP_ROI_PCT'].ragExclusionReason).toBeNull();
    expect(plan['GP_ROI_PCT'].ragStatus).not.toBeNull();
  });

  // PİN D — BASE_VOL TÜM SKU'larda/FU'larda dolu (c=1 for BASE_VOL) ama
  // BAŞKA bir eksen (INCR_GP, COGS_INPUT eksikliği yüzünden) TÜM
  // SKU'larda/FU'larda null (gp ekseninin coverageRatio'su 0). Yeni `c=0`
  // kontrolü YALNIZ `BASE_VOL`'un KENDİ coverageRatio'suna bakar — bu
  // vakada `1` — yani tetiklenmemeli. reason null kalmalı (YANLIŞ ATIF
  // yok), hem FU hem PLAN seviyesinde.
  it('PİN D — BASE_VOL dolu ama başka eksen c=0 ⇒ FU+PLAN reason null (YANLIŞ ATIF YOK)', async () => {
    const s1 = await sku(50, null); // COGS_INPUT eksik ⇒ INCR_GP null
    const s2 = await sku(30, null);

    const fu = await service.calculateFu('tenant-1', [s1, s2], {});
    expect(fu['BASE_VOL'].coverageRatio).toBe(1); // baseline'ın kendisi TAM
    expect(fu['INCR_GP'].coverageRatio).toBe(0); // başka eksen c=0
    expect(fu['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(fu['GP_ROI_PCT'].ragExclusionReason).toBeNull(); // BASELINE_MISSING DEĞİL

    const s3 = await sku(40, null);
    const s4 = await sku(60, null);
    const fu2 = await service.calculateFu('tenant-1', [s3, s4], {});
    const plan = await service.calculatePlan('tenant-1', [fu, fu2]);
    expect(plan['BASE_VOL'].coverageRatio).toBe(1);
    expect(plan['INCR_GP'].coverageRatio).toBe(0);
    expect(plan['GP_ROI_PCT'].ragExclusionReason).toBeNull();
  });

  // ── `Z94 §1` — SEVİYELER ARASI ÖNCELİK SİMETRİSİ ────────────────────────
  // Team Lead ölçümü (2026-09-03): `c=0` dalı `promo`'nun DEĞERİNE hiç
  // bakmadan `BASELINE_MISSING` üretiyordu; SKU seviyesinde ise
  // `resolveRagQuadrant` LTA kontrolünü ÖNCE yapıyordu (`S1`). Baseline'sız
  // bir LTA-only planda SKU "değerlendirme dışı" derken PLAN "baseline gir"
  // diyordu — aynı olguya iki cevap. PİN F/G bu asimetriyi SKU+FU+PLAN
  // ÜÇÜNDE BİRDEN, AYNI KOŞUMDA kapatır.

  // PİN F — TÜM SKU baseline NULL ∧ incrPromoSpend=0 (LTA) ⇒ SKU·FU·PLAN
  // ÜÇÜ DE LTA_ONLY. Düzeltmeden ÖNCE: SKU LTA_ONLY verirken FU/PLAN
  // BASELINE_MISSING veriyordu (asimetrinin ta kendisi, aşağıdaki
  // reprodüksiyon turunda ayrıca doğrulandı).
  it('PİN F — tüm SKU baseline NULL ∧ incrPromoSpend=0 (LTA) ⇒ SKU+FU+PLAN ÜÇÜ DE LTA_ONLY', async () => {
    const s = await sku(null, 10, 0);
    expect(s['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(s['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.LTA_ONLY,
    );

    const fu = await twoSkuFu(null, null, 0);
    expect(fu['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(fu['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.LTA_ONLY,
    );

    const fu2 = await twoSkuFu(null, null, 0);
    const plan = await service.calculatePlan('tenant-1', [fu, fu2]);
    expect(plan['GP_ROI_PCT'].ragStatus).toBeNull();
    expect(plan['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.LTA_ONLY,
    );
  });

  // PİN G — TÜM SKU baseline NULL ∧ incrPromoSpend>0 (promosyon
  // değerlendirmesi GEÇERLİ) ⇒ SKU·FU·PLAN ÜÇÜ DE BASELINE_MISSING.
  // PİN F'nin AYNI KOŞUMDAN AYRIŞAN kontrolü — tek fark `promoSpend`.
  it('PİN G — tüm SKU baseline NULL ∧ incrPromoSpend>0 ⇒ SKU+FU+PLAN ÜÇÜ DE BASELINE_MISSING', async () => {
    const s = await sku(null, 10, 500);
    expect(s['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.BASELINE_MISSING,
    );

    const fu = await twoSkuFu(null, null, 500);
    expect(fu['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.BASELINE_MISSING,
    );

    const fu2 = await twoSkuFu(null, null, 500);
    const plan = await service.calculatePlan('tenant-1', [fu, fu2]);
    expect(plan['GP_ROI_PCT'].ragExclusionReason).toBe(
      RagExclusionReason.BASELINE_MISSING,
    );
  });

  // Kontrol — `promo` KISMİ kapsamalı (bir SKU promo=0, diğeri promo=null,
  // yani promo.coverageRatio=0.5) ve toplam TESADÜFEN `0`'a düşüyor
  // (yalnız dolu SKU'nun değeri toplanır, `0`). `promoCoverageFull` bu
  // durumda YANLIŞ (`0.5 !== 1`) — LTA dalı ATLANMALI, `BASELINE_MISSING`'e
  // de YANLIŞ ATIF olmamalı (BASE_VOL burada dolu): kapsama kapısı devreye
  // girip sebepsiz `RAG_NOT_APPLICABLE` dönmeli (`Z94 §1`'in `0<c<1`
  // şartı).
  it('kontrol — promo KISMİ kapsamalı ∧ toplam=0 ⇒ LTA_ONLY SANILMAZ, sebepsiz RAG_NOT_APPLICABLE', async () => {
    const s1 = await service.calculateSku('tenant-1', {
      BASE_VOL: 50,
      PLAN_VOL: 100,
      BPTT: null,
      COGS: null,
      COGS_INPUT: 10,
      INCR_PROMO_SPEND: 0,
    });
    const s2 = await service.calculateSku('tenant-1', {
      BASE_VOL: 30,
      PLAN_VOL: 100,
      BPTT: null,
      COGS: null,
      COGS_INPUT: 10,
      INCR_PROMO_SPEND: null, // eksik girdi ⇒ promo.coverageRatio < 1
    });

    const fu = await service.calculateFu('tenant-1', [s1, s2], {});
    expect(fu['INCR_PROMO_SPEND'].coverageRatio).toBe(0.5); // KISMİ, TAM DEĞİL
    expect(fu['INCR_PROMO_SPEND'].value).toBe(0); // yalnız s1 toplanır — tesadüfen 0
    expect(fu['GP_ROI_PCT'].ragStatus).toBeNull();
    // ⛔ AYIRT EDİCİ: ne LTA_ONLY (promo kapsaması tam değil) ne
    // BASELINE_MISSING (BASE_VOL burada dolu) — sebepsiz kalmalı.
    expect(fu['GP_ROI_PCT'].ragExclusionReason).toBeNull();
  });
});

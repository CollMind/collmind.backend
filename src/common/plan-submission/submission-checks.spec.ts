import {
  collectPlanSpendRowWarnings,
  collectPlanStructureWarnings,
  collectPlanSubmissionValidationErrors,
  collectPlanSubmissionWarnings,
  collectSpendInputWarnings,
  planSpendBreakdownError,
  reservationInputIncompleteError,
  resolvePlanSpendBreakdown,
} from './submission-checks';
import { resolveSkuSpendInputs } from '../../modules/shared/spend-calculation/sku-spend-inputs';

/**
 * ⛔ **BU DOSYA BİR ŞARTNAMEDİR, BİR TAŞINMA ARTIĞI DEĞİL.**
 *
 * `T-344` `POST /plans/:id/submit-for-approval`'ı **öldürdü**. O rotanın
 * `approval-workflow.service.spec.ts`'teki testleri kodla birlikte
 * silinemezdi: `DISIPLIN` — *"testler bir ŞARTNAMEDİR, kod silinse bile"*.
 * Buradaki her `it` o suite'ten **davranışıyla** taşındı ve şekli
 * iyileştirildi: mock'lu bir orkestrasyon testinden **saf bir sözleşme
 * testine**.
 *
 * ⭐ Şekil değişikliği bir kozmetik değil. Eski testler on beş satırlık bir
 * mock kurulumundan geçiyordu ve `§2.7 #4`'ün riskini taşıyordu (kurulum
 * ölçülen durumu değiştirir). Burada girdi doğrudan, çıktı doğrudan.
 */
describe('submission-checks — submit ön-doğrulama + uyarı sözleşmesi (Z73 §1)', () => {
  describe('collectPlanSubmissionValidationErrors — BLOKLAYAN katman', () => {
    it('FU yoksa bloklar', () => {
      expect(collectPlanSubmissionValidationErrors({ planFus: [] })).toEqual([
        'Plan must have at least one FU',
      ]);
      expect(collectPlanSubmissionValidationErrors({ planFus: null })).toEqual([
        'Plan must have at least one FU',
      ]);
    });

    it('⛔ SINIR — taktiksiz FU BLOKLAMAZ (`ADR 0005 K2` gerekçe-2)', () => {
      // *"Kullanıcının bugün submit edebildiği plan yarın da edebilmeli."*
      // `/submit` bu planı BUGÜN kabul ediyor; ölen rotanın bu kalemi
      // bloklayan olarak taşınsaydı sıradan bir taslak plan gönderilemez
      // olurdu (ölçüldü: iki e2e paketinde sekiz test düştü).
      expect(
        collectPlanSubmissionValidationErrors({
          planFus: [
            {
              fuId: 'fu-1',
              fu: { code: 'FU-ALPHA' },
              tactics: {},
              planMechanicValues: [],
            },
          ],
        }),
      ).toEqual([]);
    });
  });

  describe('collectPlanStructureWarnings — BLOKLAMAYAN yapısal katman', () => {
    it('S-3: `planMechanicValues` VAR ama `tactics` JSONB YOK ⇒ uyarı YOK', () => {
      // T-052: SpendCalc iki kaynağı da okur; kontrol de öyle olmalı.
      expect(
        collectPlanStructureWarnings({
          planFus: [
            {
              fuId: 'fu-1',
              fu: { code: 'FU-1' },
              tactics: null,
              planMechanicValues: [{ enteredRatePct: 10 }],
            },
          ],
        }),
      ).toEqual([]);
    });

    it('S-3: `tactics` JSONB VAR ama `planMechanicValues` YOK ⇒ uyarı YOK', () => {
      expect(
        collectPlanStructureWarnings({
          planFus: [
            {
              fuId: 'fu-1',
              fu: { code: 'FU-1' },
              tactics: { TPR: { discountPct: 10 } },
              planMechanicValues: [],
            },
          ],
        }),
      ).toEqual([]);
    });

    it('S-3: İKİSİ DE yoksa UYARIR — ve FU kodu mesajda görünür', () => {
      const warnings = collectPlanStructureWarnings({
        planFus: [
          {
            fuId: 'fu-1',
            fu: { code: 'FU-ALPHA' },
            tactics: {},
            planMechanicValues: [],
          },
        ],
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('FU-ALPHA');
      expect(warnings[0]).toContain('no mechanic values or tactics');
    });
  });

  describe('collectPlanSubmissionWarnings — BLOKLAMAYAN katman (Z70 §1 · Z71 §1)', () => {
    const green = (roi: number | string | null) => ({
      ragStatus: 'GREEN',
      overallRoi: roi,
    });

    it('`RED` ⇒ "ciro kaybı" — kadran dilinde, eski genel cümle DEĞİL', () => {
      const warnings = collectPlanSubmissionWarnings(
        { ragStatus: 'RED' },
        null,
      );
      expect(warnings.some((w) => w.includes('Ciro kaybı'))).toBe(true);
      // ⛔ AYIRT EDİCİ: `RED` uyarısı `AMBER` cümlesini TAŞIMAZ.
      expect(warnings.some((w) => w.includes('Kârsız büyüme'))).toBe(false);
    });

    it('⭐ `AMBER` ⇒ "kârsız büyüme" — kadranın DOĞURDUĞU uyarı', () => {
      const warnings = collectPlanSubmissionWarnings(
        { ragStatus: 'AMBER' },
        null,
      );
      expect(warnings.some((w) => w.includes('Kârsız büyüme'))).toBe(true);
      expect(warnings.some((w) => w.includes('Ciro kaybı'))).toBe(false);
    });

    it("⛔ `B1` — eşik `pg`'den DİZGE gelse de uyarı ÜRETİLİR, ÇÖKMEZ", () => {
      // Üretimin GERÇEK şekli: `"20.0000"` (canlı DB'de ölçüldü, `Kpi`
      // entity'sinde transformer YOK). Normalizasyon `evaluateTargetRoi`'de
      // olmasaydı burada `threshold.toFixed is not a function` görürdük.
      const warnings = collectPlanSubmissionWarnings(green(10.5), '20.0000');
      expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(true);
      expect(warnings.some((w) => w.includes('%20.0'))).toBe(true);
    });

    it("⛔ `B1` — ÇÖZÜLEMEYEN dizge eşik ⇒ uyarı YOK (`0`'a çökmez)", () => {
      const warnings = collectPlanSubmissionWarnings(green(1), 'yirmi');
      expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(false);
    });

    it('⭐ `GREEN` ∧ ROI < hedef ⇒ "hedefin altında" — SESSİZLEŞMEYEN dilim', () => {
      // `10 ≤ ROI < 20`: eski model `AMBER` derdi, kadran `GREEN` diyor.
      // Bu uyarı olmasaydı ekranda YALNIZCA "İYİ" kalırdı.
      const warnings = collectPlanSubmissionWarnings(green(10.5), 20);
      expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(true);
      // ⛔ Ve kadran uyarılarından HİÇBİRİ eşlik etmez — iki eksen AYRI.
      expect(warnings.some((w) => w.includes('Ciro kaybı'))).toBe(false);
      expect(warnings.some((w) => w.includes('Kârsız büyüme'))).toBe(false);
    });

    it('`GREEN` ∧ ROI ≥ hedef ⇒ HİÇBİR uyarı yok (yanlış alarm üretilmez)', () => {
      expect(collectPlanSubmissionWarnings(green(25), 20)).toEqual([]);
    });

    it('⛔ hedef KONFİGÜRE DEĞİLSE below-target uyarısı ÜRETİLMEZ (`§2.5`)', () => {
      const warnings = collectPlanSubmissionWarnings(green(1), null);
      expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(false);
    });

    it('⛔ ROI `null` ⇒ below-target uyarısı ÜRETİLMEZ — `NOT_EVALUABLE`', () => {
      // `B3`'ün öldürdüğü kusurun sunucu tarafındaki AYNASI: hesaplanamayan
      // bir ROI'yi `0` sayıp "hedefin altında" demek, uydurulmuş bir yargıdır.
      const warnings = collectPlanSubmissionWarnings(green(null), 20);
      expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(false);
    });

    it('⛔ `RED`/`AMBER` planlar below-target uyarısı ALMAZ — çifte sayım yok', () => {
      for (const ragStatus of ['RED', 'AMBER']) {
        const warnings = collectPlanSubmissionWarnings(
          { ragStatus, overallRoi: 1 },
          20,
        );
        expect(warnings.some((w) => w.includes('Hedefin altında'))).toBe(false);
      }
    });

    it('⭐ `S1` — renk yok + `LTA_ONLY` ⇒ "değerlendirme dışı", KUSUR DEĞİL', () => {
      const warnings = collectPlanSubmissionWarnings(
        { ragStatus: null, ragExclusionReason: 'LTA_ONLY' },
        null,
      );
      expect(warnings.some((w) => w.includes('Değerlendirme dışı'))).toBe(true);
      // ⛔ AYIRT EDİCİ: meşru yokluk "hesaplanamadı" diye raporlanmaz.
      expect(warnings.some((w) => w.includes('hesaplanamadı'))).toBe(false);
    });

    it('renk yok + sebep yok ⇒ "RAG hesaplanamadı" — ve bu AYRI bir cümle', () => {
      const warnings = collectPlanSubmissionWarnings(
        { ragStatus: null, ragExclusionReason: null },
        null,
      );
      expect(warnings.some((w) => w.includes('hesaplanamadı'))).toBe(true);
      expect(warnings.some((w) => w.includes('Değerlendirme dışı'))).toBe(
        false,
      );
    });

    it('tanınmayan bir dışlama sebebi MEŞRU YOKLUK sayılmaz', () => {
      const warnings = collectPlanSubmissionWarnings(
        { ragStatus: null, ragExclusionReason: 'SOMETHING_NEW' },
        null,
      );
      expect(warnings.some((w) => w.includes('hesaplanamadı'))).toBe(true);
    });
  });

  describe('resolvePlanSpendBreakdown — ADR 0005 K3 tek karar noktası', () => {
    it('totalSpend 0 ⇒ NO_SPEND (rezervasyon yok, hata da yok)', () => {
      expect(resolvePlanSpendBreakdown(0, 0, 0)).toEqual({ kind: 'NO_SPEND' });
    });

    it('totalSpend > 0 ∧ on/off 0/0 ⇒ STALE — GÜRÜLTÜLÜ RED', () => {
      const r = resolvePlanSpendBreakdown(1000, 0, 0);
      expect(r.kind).toBe('STALE');
      expect(planSpendBreakdownError('p1', r)?.code).toBe(
        'PLAN_SPEND_BREAKDOWN_STALE',
      );
    });

    it('⛔ on/off `null` ⇒ SESSİZCE `0` REZERVE EDİLMEZ, STALE olur', () => {
      const r = resolvePlanSpendBreakdown(1000, null, null);
      expect(r.kind).toBe('STALE');
    });

    it('on + off ≠ total ⇒ INCONSISTENT', () => {
      const r = resolvePlanSpendBreakdown(1000, 600, 300);
      expect(r.kind).toBe('INCONSISTENT');
      expect(planSpendBreakdownError('p1', r)?.code).toBe(
        'PLAN_SPEND_BREAKDOWN_INCONSISTENT',
      );
    });

    it('dizge kolonlar (pg `numeric`) okunur ve USABLE döner', () => {
      expect(
        resolvePlanSpendBreakdown('1000.0000', '600.0000', '400.0000'),
      ).toEqual({ kind: 'USABLE', onInvoice: 600, offInvoice: 400 });
    });

    it('⛔ okunamayan totalSpend SESSİZCE "harcama yok" sayılmaz', () => {
      // Eskiden `Number(x) > 0` ⇒ `NaN > 0 === false` ⇒ rezervasyon
      // sessizce ATLANIRDI (`§2.5`). Artık ayrı ve gürültülü bir dal.
      const r = resolvePlanSpendBreakdown('abc', 100, 100);
      expect(r.kind).toBe('TOTAL_UNREADABLE');
      expect(planSpendBreakdownError('p1', r)?.code).toBe(
        'PLAN_TOTAL_SPEND_UNREADABLE',
      );
    });

    it('USABLE dalında hata gövdesi ÜRETİLMEZ', () => {
      expect(
        planSpendBreakdownError(
          'p1',
          resolvePlanSpendBreakdown(1000, 600, 400),
        ),
      ).toBeNull();
      expect(
        planSpendBreakdownError('p1', resolvePlanSpendBreakdown(0, 0, 0)),
      ).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `T-337` / `Z77 §1` + `§1a`
// ─────────────────────────────────────────────────────────────────────────
describe('girdi-eksikliği: SUBMIT DURMAZ, REZERVASYON REDDEDER', () => {
  it('uyarı ALAN ADINI ve SKU SAYISINI taşır (Z77 §1)', () => {
    const warnings = collectSpendInputWarnings({ PLAN_VOL: 3 });
    expect(warnings).toHaveLength(1);
    // ⛔ Hükmün metni: "PLAN_VOL eksik: 3 SKU'da spend hesaplanamadı"
    expect(warnings[0]).toContain('PLAN_VOL');
    expect(warnings[0]).toContain('3');
    expect(warnings[0]).toContain("SKU'da spend hesaplanamadı");
  });

  it('uyarı BLOKLAMAZ — cümlesi bunu AÇIKÇA söyler', () => {
    expect(collectSpendInputWarnings({ BPTT: 1 })[0]).toContain(
      'Plan gönderilebilir',
    );
  });

  it('eksik yoksa uyarı da yok (boş ≠ sessiz)', () => {
    expect(collectSpendInputWarnings({})).toEqual([]);
  });

  it('birden çok alan DETERMİNİSTİK sırada raporlanır', () => {
    const w = collectSpendInputWarnings({ PLAN_VOL: 2, BPTT: 1 });
    // alfabetik: BPTT önce
    expect(w[0]).toContain('BPTT');
    expect(w[1]).toContain('PLAN_VOL');
  });

  it('rezervasyon kapısı eksiklik VARKEN reddeder, YOKKEN geçirir', () => {
    expect(reservationInputIncompleteError('plan-1', {})).toBeNull();
    const err = reservationInputIncompleteError('plan-1', { PLAN_VOL: 3 });
    expect(err).not.toBeNull();
    expect(err!.statusCode).toBe(400);
    expect(err!.code).toBe('RESERVATION_INPUT_INCOMPLETE');
    expect(err!.message).toContain('PLAN_VOL');
    expect(err!.message).toContain('3');
    expect(err!.message).toContain('plan-1');
  });

  // ⛔ `Z77 §1a` — İKİ RED SINIFI **AYRI ADLANIR**.
  //
  // `T-321`'in eşik reddi: `BUDGET_BLOCK_THRESHOLD_EXCEEDED` · `409` ·
  //   *"zarf %100'ü aştı"* — TUTAR DOĞRU, ZARF DOLU.
  // Bu red:      `RESERVATION_INPUT_INCOMPLETE`   · `400` ·
  //   *"tutar hesaplanamıyor"* — ZARF HAKKINDA HİÇBİR ŞEY SÖYLEMİYOR.
  //
  // İkisi aynı yüzeyden dönerse ilk okuyucu karıştırır; bu blok ayrımın
  // KOD, DURUM ve METİN eksenlerinde birden yaşadığını pinler.
  it('girdi reddi, T-321 eşik reddiyle KARIŞTIRILAMAZ', () => {
    const err = reservationInputIncompleteError('plan-1', { BPTT: 1 })!;

    expect(err.code).toBe('RESERVATION_INPUT_INCOMPLETE');
    expect(err.code).not.toBe('BUDGET_BLOCK_THRESHOLD_EXCEEDED');
    // eşik reddi 409 Conflict'tir; bu 400 Bad Request.
    expect(err.statusCode).toBe(400);
    // ⛔ Metin bir BÜTÇE/eşik iddiası taşımaz — kullanıcıyı "zarf doldu"
    // sanısına götürecek hiçbir kelime yok.
    expect(err.message).not.toMatch(/eşik|threshold|%100|doldu|aşıldı/i);
    // ...ama ne yapması gerektiğini söyler.
    expect(err.message).toContain('recalculate');
  });

  it('girdi kapısı, BAYAT-KOLON kapısından (ADR 0005 K3) da AYRIDIR', () => {
    // Aynı plan hem bayat 0/0 kolonlar hem eksik girdi taşıyabilir; iki
    // kapı iki farklı kod döner ve biri diğerinin yerine geçmez.
    const stale = planSpendBreakdownError('plan-1', {
      kind: 'STALE',
      totalSpend: 500,
    })!;
    const inputs = reservationInputIncompleteError('plan-1', { PLAN_VOL: 1 })!;
    expect(stale.code).toBe('PLAN_SPEND_BREAKDOWN_STALE');
    expect(inputs.code).toBe('RESERVATION_INPUT_INCOMPLETE');
    expect(stale.code).not.toBe(inputs.code);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `Q20` (ürün sahibi, 2026-08-31) — plan-düzeyi "boş plan" uyarısı
// ─────────────────────────────────────────────────────────────────────────
describe('collectPlanSpendRowWarnings — plan boş (Q20), BLOKLAMAZ', () => {
  const untouched = (skuId: string) =>
    resolveSkuSpendInputs({
      skuId,
      baseVolume: null,
      plannedVolume: null,
      listPrice: 10,
      cogsPerUnit: 6,
    });
  const evaluable = (skuId: string) =>
    resolveSkuSpendInputs({
      skuId,
      baseVolume: 800,
      plannedVolume: 1000,
      listPrice: 10,
      cogsPerUnit: 6,
    });
  const notEvaluable = (skuId: string) =>
    resolveSkuSpendInputs({
      skuId,
      baseVolume: 800,
      plannedVolume: null,
      listPrice: 10,
      cogsPerUnit: 6,
    });

  it('hepsi UNTOUCHED (0 dolu satır) ⇒ "Plan boş" uyarısı üretir', () => {
    const warnings = collectPlanSpendRowWarnings([
      untouched('a'),
      untouched('b'),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Plan boş');
    // ⛔ BLOKLAMAZ cümlesi açıkça söylenir.
    expect(warnings[0]).toContain('gönderilebilir');
  });

  it('1 dolu + N UNTOUCHED ⇒ uyarı YOK (plan boş DEĞİL)', () => {
    const warnings = collectPlanSpendRowWarnings([
      evaluable('a'),
      untouched('b'),
      untouched('c'),
    ]);
    expect(warnings).toEqual([]);
  });

  it('NOT_EVALUABLE (dokunulmuş-ama-eksik) satır "dolu" SAYILIR ⇒ uyarı YOK', () => {
    // ⛔ AYIRT EDİCİ: `countPlannedSkus` UNTOUCHED'ı hariç tutar, ama
    // NOT_EVALUABLE'ı HARİÇ TUTMAZ — dokunulmuş bir satır "boş plan"
    // anlatısına girmez, kendi ayrı uyarısını (`collectSpendInputWarnings`)
    // taşır.
    const warnings = collectPlanSpendRowWarnings([notEvaluable('a')]);
    expect(warnings).toEqual([]);
  });

  // ── `R1` (Team Lead, 2026-08-31) — ⛔ ERKEN DÖNÜŞ BİR DELİKTİ ──────────
  // `addFu` -> `skuRepo.findBy({fuId, tenantId, isActive:true})`: bir
  // FU'nun aktif SKU'su yoksa `planSkus = []` ⇒ `resolutions = []`. Eski
  // kod bunu SESSİZ geçiyordu (`length === 0` erken dönüşü) — Q20'nin
  // "dolu-satır-sayısı 0 → uyarı" hükmünü BU DALDA ihlal ediyordu.
  it("boş dizi (FU var, aktif SKU'su yok) ⇒ uyarı ÜRETİLİR, BLOKLAMAZ (R1)", () => {
    const warnings = collectPlanSpendRowWarnings([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Plan boş');
    expect(warnings[0]).toContain('gönderilebilir');
  });

  // `Z70`: iki farklı olgu iki farklı cümle olmalı — "satır hiç yok" ile
  // "satır var ama dokunulmadı" AYNI metni PAYLAŞMAZ (kullanıcının
  // düzeltme eylemi farklı: SKU eklemek ↔ grid'i doldurmak).
  it('R1: "satır YOK" ile "satır var, boş" AYRI cümledir (Z70)', () => {
    const noRows = collectPlanSpendRowWarnings([])[0];
    const emptyRows = collectPlanSpendRowWarnings([untouched('a')])[0];
    expect(noRows).not.toBe(emptyRows);
    expect(noRows).toContain('hiç SKU satırı yok');
    expect(emptyRows).toContain('hacim girilmedi');
  });
});

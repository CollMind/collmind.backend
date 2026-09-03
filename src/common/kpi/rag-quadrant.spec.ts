import {
  RAG_CARRIER_KPI_CODE,
  attributeBaselineMissing,
  RAG_EXCLUSION_SCOPE_KPI_CODE,
  RagExclusionReason,
  parseRagExclusionReason,
  resolveRagQuadrant,
} from './rag-quadrant';
import { ROI_DENOMINATOR_KPI_CODE } from './roi-denominator';

/**
 * `T-342`/`T-343` review `S3` — **SINIR VAKALARI.**
 *
 * ⛔ Neden bu dosya var: kadranın dört-hücreli e2e fixture'ının **hiçbir
 * hücresi sınırda değil** (`iTO` ∈ {+87.475, +2.269, −21.083, −11.700},
 * `iGP` ∈ {+27.475, −9.730, −15.083, +300}). Yani `<=` ile `<` arasındaki
 * fark o dört vakanın hiçbirinde ölçülmüyor — `§2.7 #6`: kapsam var,
 * **ayırt etme gücü yok**. Sıfır çizgisi kadranın TANIMI olduğu için
 * (`Z70 §2`) tam o çizgi üzerinde ne olduğu yazılı olmalıdır.
 */
describe('RAG kadranı — sınır ve yokluk vakaları', () => {
  const PROMO = 100; // dışlama kapısını KAPALI tutan, sıfırdan farklı değer

  describe('sıfır çizgileri — `<=` mi `<` mi', () => {
    it('`iTO === 0` ⇒ RED (sıfır ciro artışı bir KAZANÇ DEĞİLDİR)', () => {
      expect(resolveRagQuadrant(0, 5000, PROMO)).toEqual({
        ragStatus: 'RED',
        ragExclusionReason: null,
      });
    });

    it('`iTO === 0` ∧ `iGP === 0` ⇒ RED (iTO ekseni BASKIN)', () => {
      expect(resolveRagQuadrant(0, 0, PROMO).ragStatus).toBe('RED');
    });

    it('`iTO > 0` ∧ `iGP === 0` ⇒ AMBER (sıfır kâr KÂR DEĞİLDİR)', () => {
      expect(resolveRagQuadrant(1, 0, PROMO)).toEqual({
        ragStatus: 'AMBER',
        ragExclusionReason: null,
      });
    });

    it('sıfırın hemen üstü/altı AYRIŞIYOR — çizginin iki yakası', () => {
      // ⛔ Bu çift, `<=` ile `<` karışırsa kırılan tek yer: her iki satır
      // da tek başına yeşil kalabilir, ÇİFT olarak ayırt eder.
      expect(resolveRagQuadrant(1e-9, 1e-9, PROMO).ragStatus).toBe('GREEN');
      expect(resolveRagQuadrant(-1e-9, 1e-9, PROMO).ragStatus).toBe('RED');
      expect(resolveRagQuadrant(1e-9, -1e-9, PROMO).ragStatus).toBe('AMBER');
    });
  });

  describe('`S1` dışlama kapısı — `0` ile `null` AYNI ŞEY DEĞİLDİR', () => {
    it('`incrPromoSpend === 0` ⇒ renk YOK + `LTA_ONLY`, eksenler DOLU olsa bile', () => {
      // ⛔ Ölçülmüş vaka: `HÜCRE 4` (`iTO=-11.700 · iGP=+300`). Kapı
      // olmasaydı kadran `RED` derdi — bir promosyon olmayan plana bir
      // promosyon yargısı.
      expect(resolveRagQuadrant(-11700, 300, 0)).toEqual({
        ragStatus: null,
        ragExclusionReason: RagExclusionReason.LTA_ONLY,
      });
    });

    it('kapı `GREEN` olacak bir hücreyi de tutar — dışlama RENKTEN ÖNCE gelir', () => {
      expect(resolveRagQuadrant(5000, 5000, 0).ragExclusionReason).toBe(
        RagExclusionReason.LTA_ONLY,
      );
    });

    it('`incrPromoSpend === null` ⇒ dışlama DEĞİL, veri yokluğu (sebep `null`)', () => {
      // ⛔ `§2.5`: `null` sessizce `0` sayılmaz. Sayılsaydı eksik veri
      // "meşru yokluk" diye raporlanır, kullanıcı `LTA_ONLY` görürdü.
      expect(resolveRagQuadrant(5000, 5000, null)).toEqual({
        ragStatus: 'GREEN',
        ragExclusionReason: null,
      });
    });

    it('`incrPromoSpend === undefined` de dışlama DEĞİLDİR', () => {
      expect(
        resolveRagQuadrant(5000, 5000, undefined).ragExclusionReason,
      ).toBeNull();
    });

    it('negatif promo harcaması dışlama tetiklemez (yalnız TAM `0`)', () => {
      expect(resolveRagQuadrant(5000, 5000, -1).ragStatus).toBe('GREEN');
    });
  });

  describe('eksen yokluğu — renk UYDURULMAZ', () => {
    it.each([
      ['iTO null', null, 5000],
      ['iGP null', 5000, null],
      ['ikisi de null', null, null],
      ['iTO undefined', undefined, 5000],
      ['iGP undefined', 5000, undefined],
    ])('%s ⇒ renk YOK ve sebep de YOK', (_ad, to, gp) => {
      expect(resolveRagQuadrant(to, gp, PROMO)).toEqual({
        ragStatus: null,
        ragExclusionReason: null,
      });
    });

    it('⛔ eksen `null` iken sebep `LTA_ONLY` OLMAZ — iki yokluk KARIŞMAZ', () => {
      // "değerlendirilemedi" (veri) ile "değerlendirme dışı" (kapsam)
      // aynı `null` rengi taşır; onları ayıran TEK ŞEY bu alandır.
      expect(
        resolveRagQuadrant(null, null, PROMO).ragExclusionReason,
      ).toBeNull();
    });
  });

  describe('`parseRagExclusionReason` — tanınmayan değer SESSİZCE sebep olmaz', () => {
    it('bilinen üye geçer', () => {
      expect(parseRagExclusionReason('LTA_ONLY')).toBe(
        RagExclusionReason.LTA_ONLY,
      );
    });

    it.each([
      ['bilinmeyen dize', 'SOMETHING_ELSE'],
      ['boş dize', ''],
      ['null', null],
      ['undefined', undefined],
      ['sayı', 1],
      ['nesne', { LTA_ONLY: true }],
      ['küçük harf', 'lta_only'],
    ])('%s ⇒ null', (_ad, raw) => {
      expect(parseRagExclusionReason(raw)).toBeNull();
    });
  });

  describe('kanonik sabitler — iki dosyada iki liste OLMASIN (`F8`)', () => {
    it('dışlama kapsam kalemi ROI paydasının TEK NOKTASINDAN türetilir', () => {
      expect(RAG_EXCLUSION_SCOPE_KPI_CODE).toBe(ROI_DENOMINATOR_KPI_CODE);
    });

    it('taşıyıcı KPI kodu `GP_ROI_PCT`', () => {
      // Kod tabanında `plan_skus/plan_fus/plans.rag_status`'un üçü de bu
      // KPI'nın sonucundan yazılır (`plan.service.ts`).
      expect(RAG_CARRIER_KPI_CODE).toBe('GP_ROI_PCT');
    });
  });
});

/**
 * `code-reviewer` bulgusu (2026-09-03) — `attributeBaselineMissing`'in
 * `LTA_ONLY` karşısındaki ÖNCELİĞİ bir **gizli tie-break**ti: kodda vardı,
 * hiçbir yerde yazılı değildi, hiçbir test onu pinlemiyordu. `§2.5` bunu
 * kelime kelime sayıyor (*"iki seçenek arasında gizli tie-break"*).
 */
describe('attributeBaselineMissing — sebep ÖNCELİĞİ (gizli tie-break pinlendi)', () => {
  it('LTA_ONLY, BASELINE_MISSING tarafından EZİLMEZ (kapsam yargısı veri yargısını yutar)', () => {
    const ltaOutcome = resolveRagQuadrant(null, null, 0);
    expect(ltaOutcome.ragExclusionReason).toBe(RagExclusionReason.LTA_ONLY);

    // baseline de YOK — yine de LTA_ONLY kalır.
    expect(attributeBaselineMissing(ltaOutcome, null).ragExclusionReason).toBe(
      RagExclusionReason.LTA_ONLY,
    );
  });

  it('LTA_ONLY yokken VERİ dalı BASELINE_MISSING alır', () => {
    const dataOutcome = resolveRagQuadrant(null, null, 500);
    expect(dataOutcome.ragExclusionReason).toBeNull();
    expect(attributeBaselineMissing(dataOutcome, null).ragExclusionReason).toBe(
      RagExclusionReason.BASELINE_MISSING,
    );
  });

  it('RENK üretilmişse üstüne YAZILMAZ (baseline null olsa bile)', () => {
    const green = resolveRagQuadrant(100, 50, 500);
    expect(green.ragStatus).toBe('GREEN');
    expect(attributeBaselineMissing(green, null)).toEqual(green);
  });

  it('baseVolValue UNDEFINED (KPI katalogda yok) ⇒ ATIF YAPILMAZ — uydurma sebep yok', () => {
    const dataOutcome = resolveRagQuadrant(null, null, 500);
    expect(
      attributeBaselineMissing(dataOutcome, undefined).ragExclusionReason,
    ).toBeNull();
  });
});

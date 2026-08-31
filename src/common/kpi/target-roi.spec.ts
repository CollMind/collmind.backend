import {
  TARGET_ROI_KPI_CODE,
  belowTargetRoiMessage,
  evaluateTargetRoi,
  isBelowTargetRoi,
} from './target-roi';

/**
 * `T-343` / `Z71 §1` — TARGET-ROI EKSENİ.
 *
 * ⛔ Bu eksen kadran inişinin **sessizleştireceği iki dilimi** taşır
 * (ölçülmüş geçiş matrisi, `green=20 · amber=10`):
 * ```
 * 0 < ROI < 10     ÖNCE RED    → SONRA GREEN
 * 10 ≤ ROI < 20    ÖNCE AMBER  → SONRA GREEN
 * ```
 * O yüzden buradaki sınırlar (`<` vs `<=`) ve **eşiksiz** davranış
 * spekülatif değil, ürünün alarm yüzeyidir.
 */
describe('Target-ROI ekseni', () => {
  it("taşıyıcıyla aynı KPI'yı okur (hedef o KPI'nın alanında yaşar)", () => {
    expect(TARGET_ROI_KPI_CODE).toBe('GP_ROI_PCT');
  });

  describe('sınır — `roi === threshold` HEDEFİN ALTINDA DEĞİLDİR', () => {
    it('roi < threshold ⇒ BELOW_TARGET', () => {
      expect(evaluateTargetRoi(19.9, 20)).toEqual({
        kind: 'BELOW_TARGET',
        roi: 19.9,
        threshold: 20,
      });
    });

    it('roi === threshold ⇒ AT_OR_ABOVE_TARGET (`<`, `<=` DEĞİL)', () => {
      expect(evaluateTargetRoi(20, 20).kind).toBe('AT_OR_ABOVE_TARGET');
    });

    it('roi > threshold ⇒ AT_OR_ABOVE_TARGET', () => {
      expect(evaluateTargetRoi(20.1, 20).kind).toBe('AT_OR_ABOVE_TARGET');
    });

    it("negatif ROI de bu eksende BELOW_TARGET'tır — ama kapıyı RAG açar", () => {
      // `isBelowTargetRoi` yalnız `GREEN`'de true döner; negatif ROI'li bir
      // plan zaten `AMBER`/`RED` olur ve KADRAN konuşur. İki eksenin AYNI
      // planı iki kez saymaması bu ayrımla sağlanıyor.
      expect(evaluateTargetRoi(-60, 20).kind).toBe('BELOW_TARGET');
      expect(isBelowTargetRoi('AMBER', evaluateTargetRoi(-60, 20))).toBe(false);
    });
  });

  /**
   * ⛔ **`T-343` review `B1` — BU BLOK BİR ÇALIŞMA-ZAMANI ÇÖKMESİNİ PİNLİYOR.**
   *
   * Ölçüldü (canlı DB): `main.kpis.target_roi_threshold` `pg_typeof=numeric`,
   * `pg` sürücüsü `typeof "string"` döndürüyor, değer `"20.0000"` — çünkü
   * `Kpi` entity'sinde **transformer YOK** (bilinçli bir DUR kararı).
   *
   * İlk yazımda bu dosyanın **hiçbir testi dizge vermiyordu** ve
   * `approval-workflow` mock'u eşiği **sayı** olarak veriyordu ⇒ mock DOĞRU,
   * üretim YANLIŞ, test **ayırt edemiyor** (`§2.7`: *"bir mock, taklit
   * ettiği şeyin TİPİNE bağlanmalı"*). Reprodüksiyon:
   * ```
   * Number.isNaN("20.0000")  → false        ⇒ §2.5 kapısı HİÇ ÇALIŞMIYOR
   * 10.5 < "20.0000"         → true         ⇒ karşılaştırma TESADÜFEN doğru
   * threshold.toFixed(1)     → ⛔ TypeError: not a function
   * ```
   */
  describe('⛔ `B1` — `decimal` DİZGE OLARAK GELİR (üretimin GERÇEK şekli)', () => {
    it('dizge eşik ÇÖKMEDEN değerlendirilir ve SAYIYA normalize edilir', () => {
      const r = evaluateTargetRoi(10.5, '20.0000');
      expect(r).toEqual({
        kind: 'BELOW_TARGET',
        roi: 10.5,
        threshold: 20,
      });
      // ⛔ AYIRT EDİCİ: dönen `threshold` bir SAYI olmalı — dizge geçse
      // `toFixed` çağıran her tüketici çöker.
      expect(typeof (r as { threshold: number }).threshold).toBe('number');
    });

    it('dizge eşikle ÜRETİLEN MESAJ patlamaz (çökmenin ta kendisi)', () => {
      const r = evaluateTargetRoi('10.5000', '20.0000');
      expect(r.kind).toBe('BELOW_TARGET');
      const below = r as {
        kind: 'BELOW_TARGET';
        roi: number;
        threshold: number;
      };
      expect(() =>
        belowTargetRoiMessage(below.roi, below.threshold),
      ).not.toThrow();
      expect(belowTargetRoiMessage(below.roi, below.threshold)).toContain(
        '20.0',
      );
    });

    it('dizge ROI de normalize edilir (aynı sınıf, öbür taraf)', () => {
      expect(evaluateTargetRoi('25.0000', '20.0000').kind).toBe(
        'AT_OR_ABOVE_TARGET',
      );
    });

    it('⛔ SAYISAL karşılaştırma — DİZGE karşılaştırması olsaydı bu satır kırılırdı', () => {
      // `'9' < '20.0000'` dizge olarak **false**'tur ('9' > '2').
      // Normalizasyon olmadan JS zorlaması burada doğru cevabı verir, ama
      // fixture bunu AÇIKÇA ölçüyor ki bir gün `<` dizgeye kayarsa görülsün.
      expect(evaluateTargetRoi('9', '20.0000').kind).toBe('BELOW_TARGET');
    });

    it.each([
      ['boş dize', ''],
      ['yalnız boşluk', '   '],
      ['sayı olmayan', 'yirmi'],
      ['NaN dizgesi', 'NaN'],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['Infinity dizgesi', 'Infinity'],
    ])(
      "⛔ ÇÖZÜLEMEYEN eşik (%s) ⇒ NOT_EVALUABLE — `0`'a ÇÖKMEZ (`§2.5`)",
      (_ad, thr) => {
        expect(evaluateTargetRoi(15, thr as never)).toEqual({
          kind: 'NOT_EVALUABLE',
          reason: 'THRESHOLD_NOT_CONFIGURED',
        });
      },
    );

    it('boşluklu dizge kırpılır (`" 20.0000 "`)', () => {
      expect(evaluateTargetRoi(10, ' 20.0000 ').kind).toBe('BELOW_TARGET');
    });
  });

  describe('⛔ VARSAYILAN EŞİK YOK (`§2.5`)', () => {
    it.each([
      ['threshold null', 15, null],
      ['threshold undefined', 15, undefined],
      ['threshold NaN', 15, Number.NaN],
    ])('%s ⇒ NOT_EVALUABLE / THRESHOLD_NOT_CONFIGURED', (_ad, roi, thr) => {
      expect(evaluateTargetRoi(roi, thr)).toEqual({
        kind: 'NOT_EVALUABLE',
        reason: 'THRESHOLD_NOT_CONFIGURED',
      });
    });

    it('eşik yokken bir plan below-target SAYILMAZ (uydurulmuş hedefe yargı yok)', () => {
      expect(isBelowTargetRoi('GREEN', evaluateTargetRoi(1, null))).toBe(false);
    });

    it.each([
      ['roi null', null, 20],
      ['roi undefined', undefined, 20],
      ['roi NaN', Number.NaN, 20],
    ])('%s ⇒ NOT_EVALUABLE / ROI_NULL', (_ad, roi, thr) => {
      expect(evaluateTargetRoi(roi, thr)).toEqual({
        kind: 'NOT_EVALUABLE',
        reason: 'ROI_NULL',
      });
    });
  });

  describe('`isBelowTargetRoi` — YALNIZ `GREEN`', () => {
    const below = evaluateTargetRoi(10.5, 20);

    it('GREEN ∧ below ⇒ true (kadranın konuşmadığı dilim)', () => {
      expect(isBelowTargetRoi('GREEN', below)).toBe(true);
    });

    it.each([['RED'], ['AMBER']])(
      '%s ⇒ false — o planı KADRAN zaten konuşuyor, iki kez sayılmaz',
      (rag) => {
        expect(isBelowTargetRoi(rag, below)).toBe(false);
      },
    );

    it.each([
      ['null (değerlendirilemedi ya da değerlendirme dışı)', null],
      ['undefined', undefined],
    ])('%s ⇒ false — renk yokken hiçbir yargı verilmez', (_ad, rag) => {
      expect(isBelowTargetRoi(rag, below)).toBe(false);
    });
  });

  it("mesaj hem ROI'yi hem HEDEFİ taşır — kullanıcı farkı görebilsin", () => {
    const msg = belowTargetRoiMessage(10.5, 20);
    expect(msg).toContain('10.5');
    expect(msg).toContain('20.0');
  });
});

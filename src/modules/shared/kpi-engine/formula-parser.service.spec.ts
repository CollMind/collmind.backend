import { FormulaParserService } from './formula-parser.service';
import { KPI_DEFAULTS } from '../../../database/seeds/kpi.seed';

/**
 * T-163 / ADR 0011 (+ [[T-334]] / `Z66 §1` — payda BÖLÜNDÜ) —
 * `GP_ROI_PCT` paydası hesaplama testi.
 *
 * ⚠️ **GÜNCELLENDİ 2026-08-30:** payda artık **`INCR_PROMO_SPEND`**
 * (*yalnız promo · LTA hariç · incremental*). `ADR 0011` geri alınmadı —
 * `TOTAL_PLANNED_SPEND` **bütçenin** kalemi olarak yerinde kaldı; ROI
 * onu okumayı bıraktı (`0011` `F12` · migration `1818000000000`).
 * Fixture artık **ÜÇ rakip paydayı** ayrı ayrı ayırt eder.
 *
 * ⛔ Testin şekli — CLAUDE.md §2.7 #6 / T-101 dersi: `INCR_SPEND` fixture'da
 * `TOTAL_PLANNED_SPEND` ile AYNI değeri taşırsa, iki rakip formül
 * (`INCR_GP / TOTAL_PLANNED_SPEND * 100` vs eski `INCR_GP / INCR_SPEND * 100`)
 * aynı sonucu verir ve test hiçbir şeyi ayırt edemez. Bu yüzden
 * `BASE_TOTAL_SPEND` kasıtlı olarak sıfırdan farklı seçilir:
 *
 *   INCR_SPEND = TOTAL_PLANNED_SPEND - BASE_TOTAL_SPEND
 *
 * Beklenen değerler formülden TÜRETİLMEDİ, elle hesaplanıp yazıldı (§2.7 #8 —
 * aksi halde test kendi hedefini yeniden uygulardı).
 *
 * Formül metni gerçek seed kaynağından (`KPI_DEFAULTS`) okunuyor — testin
 * kendi kopyasını hardcode etmesi yerine üretimde kullanılan tanıma
 * bağlanıyor: seed'deki `formulaText` değişirse bu test de onu görür.
 */
describe('FormulaParserService — GP_ROI_PCT payda ayrımı (ADR 0011 + Z66 §1)', () => {
  const parser = new FormulaParserService();

  const gpRoiPctSeed = KPI_DEFAULTS.find((k) => k.kpiCode === 'GP_ROI_PCT');

  // Fixture — kasıtlı olarak ayrışan değerler:
  const BASE_TOTAL_SPEND = 1000;
  const TOTAL_PLANNED_SPEND = 5000;
  const INCR_SPEND = TOTAL_PLANNED_SPEND - BASE_TOTAL_SPEND; // 4000 — ≠ TOTAL_PLANNED_SPEND
  // `Z66 §1` paydası — LTA HARİÇ olduğu için diğer ikisinden de FARKLI.
  const INCR_PROMO_SPEND = 3200;
  const INCR_GP = 800;

  // Elle hesaplanmış beklenen değerler (formülden türetilmedi):
  const EXPECTED_Z66 = 25; // 800 / 3200 * 100 — YÜRÜRLÜKTEKİ
  const EXPECTED_ADR_0011 = 16; // 800 / 5000 * 100 — BÜTÇE kalemi
  const EXPECTED_OLD_MIGRATION_1780 = 20; // 800 / 4000 * 100 — en eski payda

  it("seed formulaText'i tanımlıdır (ön koşul)", () => {
    expect(gpRoiPctSeed?.formulaText).toBeDefined();
  });

  it('bağımlılık çıkarımı INCR_PROMO_SPEND alır — diğer iki paydayı ALMAZ', () => {
    const dependencies = parser.extractDependencies(gpRoiPctSeed!.formulaText!);
    expect(dependencies.sort()).toEqual(['INCR_GP', 'INCR_PROMO_SPEND']);
    expect(dependencies).not.toContain('INCR_SPEND');
    expect(dependencies).not.toContain('TOTAL_PLANNED_SPEND');
  });

  it("sonucu INCR_PROMO_SPEND paydasına göre üretir — diğer İKİ payda context'te FARKLI değerlerle mevcut olsa bile", () => {
    const formula = parser.parseFormula(
      gpRoiPctSeed!.formulaText!,
      'expression',
    );

    const result = formula.execute({
      INCR_GP,
      INCR_PROMO_SPEND,
      // Kasıtlı tuzak: context'te ÜÇ payda adayı da var ve ÜÇÜ DE FARKLI
      // değer taşıyor. Formül yalnız `INCR_PROMO_SPEND`'i kullanmalı.
      TOTAL_PLANNED_SPEND,
      BASE_TOTAL_SPEND,
      INCR_SPEND,
    });

    expect(result).toBe(EXPECTED_Z66);
    // Ayırt edicilik kanıtı: ÜÇ değer de birbirinden farklı.
    expect(EXPECTED_Z66).not.toBe(EXPECTED_ADR_0011);
    expect(EXPECTED_Z66).not.toBe(EXPECTED_OLD_MIGRATION_1780);
    expect(EXPECTED_ADR_0011).not.toBe(EXPECTED_OLD_MIGRATION_1780);
    expect(result).not.toBe(EXPECTED_ADR_0011);
    expect(result).not.toBe(EXPECTED_OLD_MIGRATION_1780);
  });

  it("kontrol grubu: İKİ tarihsel payda AYNI context'te gerçekten farklı sonuç verir", () => {
    // Bu test üretim formülünü değil, tarihsel formülleri çalıştırır —
    // yalnızca fixture'ın gerçekten ayırt ettiğini göstermek için (§2.7 #6).
    const ctx = {
      INCR_GP,
      INCR_PROMO_SPEND,
      TOTAL_PLANNED_SPEND,
      INCR_SPEND,
    };
    expect(
      parser
        .parseFormula('INCR_GP / INCR_SPEND * 100', 'expression')
        .execute(ctx),
    ).toBe(EXPECTED_OLD_MIGRATION_1780);
    expect(
      parser
        .parseFormula('INCR_GP / TOTAL_PLANNED_SPEND * 100', 'expression')
        .execute(ctx),
    ).toBe(EXPECTED_ADR_0011);
  });

  describe('⛔ [[T-334]] — YERİNE KOYMA PARANTEZLİDİR (review B1/B1b)', () => {
    // Üç kusur AYNI kökten geliyordu: değer çıplak yerine konunca komşu
    // operatörle YENİ BİR TOKEN oluşturabiliyordu. Her biri ayrı ayrı
    // ÖLÇÜLDÜ (2026-08-30) ve düzeltmeden ÖNCE kırmızıydı.

    it('B1b · İKİ NEGATİF operand — ve BOŞLUKTAN BAĞIMSIZ', () => {
      // ÖNCE: `-1200--1500` → JS postfix `--` → SyntaxError → sessizce null.
      // İlk düzeltme yalnız BOŞLUKLU yazımı kurtarıyordu; boşluksuz yazım
      // (bir admin `PLANNED_GP-BASE_GP` yazabilir — `formulaText` serbest
      // metindir, `kpi.controller.ts` `@Post()`/`@Patch(':id')`) hâlâ
      // `null` veriyordu. Ölçüldü: boşuksuz null · boşluklu 300.
      const spaced = parser.parseFormula('PLANNED_GP - BASE_GP', 'expression');
      const tight = parser.parseFormula('PLANNED_GP-BASE_GP', 'expression');
      const ctx = { PLANNED_GP: -1200, BASE_GP: -1500 };
      expect(spaced.execute(ctx)).toBe(300);
      expect(tight.execute(ctx)).toBe(300); // ⛔ BOŞLUKSUZ — kusurun açık kalan yolu
      // Pozitif kontrol: aynı formül pozitif operandlarda zaten çalışıyordu.
      expect(spaced.execute({ PLANNED_GP: 1200, BASE_GP: 500 })).toBe(700);
    });

    it('B1 · `//` + newline SESSİZ YANLIŞ SAYI üretmez — beyaz listenin gördüğü dizge DEĞERLENDİRİLİR', () => {
      // Bir ara sürümde beyaz liste boşluksuz dizgeyi denetliyor ama
      // BOŞLUKLU dizge değerlendiriliyordu. `1 // 2\n+ 5` beyaz listeden
      // `1//2+5` olarak geçiyor, değerlendirmede `//` bir YORUM oluyor ve
      // ifadenin yarısı düşüyordu ⇒ `null` yerine **6** (kısmi sayı,
      // `§2.5`'in merkezi). Ölçüldü: ayrışma İKİ YÖNDE de gerçekti.
      const evalOf = (e: string) =>
        (parser as unknown as { safeEval(x: string): number | null }).safeEval(
          e,
        );
      expect(evalOf('1 // 2\n+ 5')).toBeNull(); // ⛔ 6 DEĞİL
      // Diğer yön: boşluklu sayı literali eskiden 1000'di ve öyle KALMALI —
      // yani düzeltme "her şeyi null yap" ile geçmiyor (§2.7: sinyal sabitse
      // sinyal değildir).
      expect(evalOf('1 000')).toBe(1000);
    });

    it('B1 · güvenlik kapısı KAPALI kalır (harf · dizge · property)', () => {
      const f = parser.parseFormula('PLANNED_GP - BASE_GP', 'expression');
      expect(
        f.execute({ PLANNED_GP: 1, BASE_GP: 'process.exit(1)' }),
      ).toBeNull();
      expect(f.execute({ PLANNED_GP: 1, BASE_GP: 'Infinity' })).toBeNull();
    });

    it('B1 · YAN ETKİ YOK — sıfıra bölme, ondalık, canlı formüller', () => {
      // Parantezli yerine koyma `/(0)` üretiyor ⇒ metin tabanlı
      // sıfıra-bölme deseni ARTIK EŞLEŞMİYOR. Sonuç DEĞİŞMİYOR (`Infinity`
      // → `!isFinite` → `null`), ama bu bir ÖLÇÜMDÜR, varsayım değil.
      const div = parser.parseFormula(
        'INCR_GP / INCR_PROMO_SPEND * 100',
        'expression',
      );
      expect(div.execute({ INCR_GP: 10, INCR_PROMO_SPEND: 0 })).toBeNull();
      expect(div.execute({ INCR_GP: -10, INCR_PROMO_SPEND: 0 })).toBeNull();
      expect(div.execute({ INCR_GP: 0, INCR_PROMO_SPEND: 0 })).toBeNull();
      expect(div.execute({ INCR_GP: 800, INCR_PROMO_SPEND: 3200 })).toBe(25);
      // Ve LİTERAL sıfır bölen hâlâ desenle yakalanıyor (ölçüldü — desen
      // ölü DEĞİL): `AA / 0`.
      expect(
        (parser as unknown as { safeEval(x: string): number | null }).safeEval(
          '(5)/0',
        ),
      ).toBeNull();
      expect(
        parser
          .parseFormula(
            '(PLANNED_GSV - PLANNED_LTA_ON) * CPP_ON_PCT / 100',
            'expression',
          )
          .execute({
            PLANNED_GSV: 120000,
            PLANNED_LTA_ON: 8400,
            CPP_ON_PCT: 10,
          }),
      ).toBe(11160);
    });

    it('B1 · `conditional` yolu da parantezli — orada sessiz sonuç YANLIŞ DAL olurdu', () => {
      // `evaluateCondition` `left===null || right===null → false` döndürür
      // ⇒ ayrıştırma hatası sessiz `false` ⇒ YANLIŞ DAL. Bugün canlı
      // `conditional` KPI yok; yol yine de kapatıldı.
      // ⛔ Koşulun İÇİNDE ARİTMETİK olmalı — `A > B` şeklinde bir koşul bu
      // kusuru AYIRT EDEMEZ (`>` iki değeri zaten ayırır, `--` bitişikliği
      // hiç doğmaz). Ayırt eden şekil: çıkarma + iki negatif operand.
      const c = parser.parseFormula(
        'IF(PLANNED_GP - BASE_GP > 0, 1, 2)',
        'conditional',
      );
      expect(c.execute({ PLANNED_GP: -1200, BASE_GP: -1500 })).toBe(1); // 300 > 0
      expect(c.execute({ PLANNED_GP: -1500, BASE_GP: -1200 })).toBe(2); // -300 > 0 değil
      // Ve boşluksuz yazımda da aynı dal seçilir.
      expect(
        parser
          .parseFormula('IF(PLANNED_GP-BASE_GP > 0, 1, 2)', 'conditional')
          .execute({ PLANNED_GP: -1200, BASE_GP: -1500 }),
      ).toBe(1);
    });

    it('T-341 · ÜSTEL ara değer artık SESSİZ `null` DEĞİL — eşiğin İKİ YANI da pinli', () => {
      // ⛔ RANDEVU-PİNİ KIRILDI (T-334 → T-341). Bu testin eski hâli
      // BUGÜNKÜ KUSURU pinliyordu (`0.0000001` → `null`) ki düzeltildiği gün
      // bilerek kırılsın. Kırıldı: `Expected null / Received 1e-7`.
      //
      // ÖLÇÜM: `String(1e-7) === '1e-7'`, beyaz liste `/^[0-9+\-*\/().]+$/`
      // `e` harfini kabul etmiyordu ⇒ hesaplanabilir bir ara değer KPI'ı
      // sessizce düşürüyordu (`§2.5`). Düzeltme beyaz listeyi GENİŞLETMEDİ;
      // yerine koyma SABİT GÖSTERİM üretiyor (`toFixedNotation`).
      expect(String(1e-7)).toBe('1e-7'); // kusurun ön koşulu — hâlâ doğru
      const f = parser.parseFormula('PLANNED_GP - BASE_GP', 'expression');

      // KÜÇÜK taraf — eşiğin İKİ YANI (T-341 AC)
      expect(f.execute({ PLANNED_GP: 0.000001, BASE_GP: 0 })).toBe(1e-6); // hep çalışıyordu
      expect(f.execute({ PLANNED_GP: 0.0000001, BASE_GP: 0 })).toBe(1e-7); // ⛔ eskiden null
      expect(f.execute({ PLANNED_GP: 5e-324, BASE_GP: 0 })).toBe(5e-324); // en küçük subnormal

      // BÜYÜK taraf — eşiğin İKİ YANI
      expect(f.execute({ PLANNED_GP: 1e20, BASE_GP: 0 })).toBe(1e20); // hep çalışıyordu
      expect(f.execute({ PLANNED_GP: 1e21, BASE_GP: 0 })).toBe(1e21); // ⛔ eskiden null
      expect(f.execute({ PLANNED_GP: 1e21, BASE_GP: 1e21 })).toBe(0);

      // NEGATİF üstel — T-334'ün parantez dersiyle BİRLİKTE çalışmalı
      expect(f.execute({ PLANNED_GP: -1e-7, BASE_GP: -2e-7 })).toBe(1e-7);
      expect(f.execute({ PLANNED_GP: 0, BASE_GP: 1e21 })).toBe(-1e21);
    });

    it('T-341 · `toFixedNotation` KAYIPSIZ ve beyaz listeyi GENİŞLETMEZ', () => {
      // ⛔ Bu testin şekli: iki rakip adayı AYIRT ETMELİ (`§2.7 #6`).
      //   (a) beyaz listeye `e` eklemek → `1e-400` GEÇER ve sessizce `0`
      //   (b) `toFixed`               → `(5e-324).toFixed(20)` = sessiz `0`
      //                                 ve `(1e21).toFixed(2)` = `'1e+21'`
      // Yürürlükteki şekil ikisini de yapmaz. Aşağısı bunu ÖLÇER.
      const conv = (
        parser as unknown as { toFixedNotation(v: number): string }
      ).toFixedNotation.bind(parser);

      // Kayıpsızlık — `toFixed`'in battığı iki nokta dahil
      for (const v of [
        1e-7,
        5e-324,
        1e21,
        1e22,
        1.7976931348623157e308,
        -1e-7,
        -1e21,
        0,
        0.1,
        123.456,
        1 / 3,
        Number.EPSILON,
      ]) {
        const text = conv(v);
        expect(Number(text)).toBe(v); // round-trip
        expect(text).toMatch(/^-?[0-9]+(\.[0-9]+)?$/); // charset: [-.0-9] SADECE
        expect(text).not.toMatch(/[eE]/);
      }

      // ⛔ Beyaz liste DEĞİŞMEDİ: üstel gösterimli bir formül METNİ hâlâ
      // reddedilir (dürüst `null`), çünkü aday (a) uygulanmadı. `1e-400`'ün
      // sessizce `0` olduğu yol bu sayede AÇILMADI.
      const evalOf = (e: string) =>
        (parser as unknown as { safeEval(x: string): number | null }).safeEval(
          e,
        );
      expect(evalOf('1e-400')).toBeNull();
      expect(evalOf('1e400')).toBeNull();
      expect(evalOf('(5)*(1e-400)')).toBeNull();
    });

    it('T-099 · SONLULUK girdide denetleniyor — girdi/çıktı asimetrisi kapandı', () => {
      // `Number.isNaN(Infinity) === false`: eski `isNaN(value)` kapısı
      // `Infinity`'yi GEÇİRİYORDU; `null` dönmesini sağlayan şey beyaz
      // listeydi — doğru sonuç TESADÜFEN, ikinci bir kapıdan geliyordu.
      // Davranış (dönüş `null`) DEĞİŞMEDİ; gerekçe artık girdide.
      const f = parser.parseFormula('PLANNED_GP - BASE_GP', 'expression');
      expect(f.execute({ PLANNED_GP: 1, BASE_GP: 'Infinity' })).toBeNull();
      expect(f.execute({ PLANNED_GP: 1, BASE_GP: '-Infinity' })).toBeNull();
      expect(f.execute({ PLANNED_GP: 1, BASE_GP: 'NaN' })).toBeNull();
      expect(f.execute({ PLANNED_GP: 1, BASE_GP: '1e400' })).toBeNull();
      // ⛔ Ve T-097'nin `to` tuzağı: `null`/`undefined` DAHA ÖNCEKİ dalda
      // (eksik veri = BRD'nin kural-`null`'ı) eleniyor, `Number.isFinite`'e
      // hiç ulaşmıyor — davranış aynı kaldı.
      expect(f.execute({ PLANNED_GP: 1, BASE_GP: null })).toBeNull();
      expect(f.execute({ PLANNED_GP: 1, BASE_GP: undefined })).toBeNull();
      // Pozitif kontrol — sinyal SABİT DEĞİL (`§2.7`).
      expect(f.execute({ PLANNED_GP: 1, BASE_GP: 0.5 })).toBe(0.5);
    });

    it('⛔ `evaluateCondition` SESSİZ `false` üretmiyor — YANLIŞ DAL kapandı', () => {
      // T-334 bunu ADLANDIRDI, bu tur KAPATTI. Ölçülmüş üç vaka — üçünde de
      // eski kod `2`yi (else dalını) KESİN bir sonuç gibi döndürüyordu.
      const run = (formula: string, ctx: Record<string, unknown>) =>
        parser.parseFormula(formula, 'conditional').execute(ctx);

      // (1) beyaz listenin reddettiği koşul (`ABS` FUNCTION_NAMES'te —
      //     bağımlılık sayılmıyor, yerine de konmuyor, harf kalıyor)
      expect(run('IF(ABS(A_VAL) > 0, 1, 2)', { A_VAL: 5 })).toBeNull();
      // (2) karşılaştırmasız (truthy) dal — eskiden `!!null === false`
      expect(run('IF(ABS(A_VAL), 1, 2)', { A_VAL: 5 })).toBeNull();
      // (3) ⛔ EN AĞIRI — sıfıra bölme BRD'nin KURAL-`null`'ıdır ve kesin
      //     bir DAL KARARINA dönüşüyordu.
      expect(run('IF(A_VAL / 0 > 0, 1, 2)', { A_VAL: 5 })).toBeNull();

      // Pozitif kontrol: sağlıklı koşullar İKİ DALI DA seçebiliyor —
      // "her şeyi null yap" ile geçilemez (`§2.7`: sinyal sabitse sinyal değil).
      expect(run('IF(A_VAL > B_VAL, 1, 2)', { A_VAL: 5, B_VAL: 1 })).toBe(1);
      expect(run('IF(A_VAL > B_VAL, 1, 2)', { A_VAL: 1, B_VAL: 5 })).toBe(2);
    });

    it('⛔ ÇÖZÜLMEMİŞ `IF` bir DİZGE olarak dışarı sızmıyor', () => {
      // `maxIterations = 10`. Bütçe biterse eskiden ham metin dönüyordu ve
      // `CalculationResult.value` (`number | null`) alanına bir DİZGE
      // sızıyordu — `null`'dan DAHA SESSİZ bir yanlış (sayı alanında metin).
      const nest = (depth: number) => {
        let f = '1';
        for (let i = 0; i < depth; i++) f = `IF(A_VAL > 0, ${f}, 0)`;
        return parser.parseFormula(f, 'conditional').execute({ A_VAL: 5 });
      };
      expect(nest(12)).toBeNull(); // bütçe aşıldı ⇒ dizge DEĞİL, null
      // Pozitif kontrol: bütçe içinde kalan iç içe IF hâlâ çözülüyor.
      expect(nest(3)).toBe(1);
    });

    it("T-102 tohumu · HATA-`null` ile KURAL-`null` LOG'da ayrışıyor", () => {
      // ⛔ ÖLÇÜLDÜ: `Number.isFinite` ↔ `isNaN` değişimi DÖNÜŞ DEĞERİNDE
      // gözlenemez — `Infinity` her iki hâlde de `null` verir, çünkü beyaz
      // liste ikinci bir kapı olarak devrededir (mutasyon `M2` sağ kaldı).
      // Gözlenebilen tek fark TEŞHİStir, ve fark önemlidir: eski kod bir
      // VERİ sorununu `"Unsafe expression blocked"` diye, yani bir GÜVENLİK
      // olayı gibi raporluyordu. [[T-102]]'nin ayrımı bugün yalnız burada
      // yaşıyor; `execute()`'un dönüşünde HÂLÂ yaşamıyor.
      const warn = jest
        .spyOn(
          (parser as unknown as { logger: { warn: (m: string) => void } })
            .logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      try {
        const f = parser.parseFormula('PLANNED_GP - BASE_GP', 'expression');

        // HATA-null: sonlu olmayan bağımlılık ⇒ teşhis GÜVENLİK değil VERİ
        warn.mockClear();
        expect(f.execute({ PLANNED_GP: 1, BASE_GP: 'Infinity' })).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('not a finite number');
        expect(warn.mock.calls[0][0]).not.toContain('Unsafe expression');

        // KURAL-null: eksik veri (BRD) ⇒ HİÇ uyarı yok, bu bir hata değil
        warn.mockClear();
        expect(f.execute({ PLANNED_GP: 1, BASE_GP: null })).toBeNull();
        expect(warn).not.toHaveBeenCalled();

        // KURAL-null: sıfıra bölme (BRD) ⇒ HİÇ uyarı yok
        warn.mockClear();
        expect(
          parser
            .parseFormula('INCR_GP / INCR_PROMO_SPEND * 100', 'expression')
            .execute({ INCR_GP: 10, INCR_PROMO_SPEND: 0 }),
        ).toBeNull();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });
});

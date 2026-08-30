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

    it('⚠️ BİLİNEN AÇIK — ÜSTEL gösterim beyaz listeden düşüyor (SESSİZ `null`)', () => {
      // ÖLÇÜLDÜ: `String(1e-7) === '1e-7'`; beyaz liste `e` harfini
      // kabul etmiyor ⇒ `null`. Yani yeterince KÜÇÜK (ya da yeterince
      // BÜYÜK, `1e21`) bir ara değer KPI'ı sessizce düşürür.
      // ⛔ Bu `T-334` kapsamında DEĞİL, ve DÜZELTİLMEDİ — bir sonraki
      // turun task'ı olarak bildirildi. Bu test o davranışı BUGÜNKÜ hâliyle
      // PINLER ki düzeltildiği gün bilerek kırılsın.
      expect(String(1e-7)).toBe('1e-7');
      const f = parser.parseFormula('PLANNED_GP - BASE_GP', 'expression');
      expect(f.execute({ PLANNED_GP: 0.0000001, BASE_GP: 0 })).toBeNull();
      // Ayırt edici: aynı büyüklük üstel OLMAYAN yazımla ÇALIŞIYOR.
      expect(f.execute({ PLANNED_GP: 0.000001, BASE_GP: 0 })).toBe(0.000001);
    });
  });
});

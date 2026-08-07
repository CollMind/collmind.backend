import {
  SalesActualsValidationService,
  parseAmount,
  amountFailure,
} from './sales-actuals-validation.service';
import {
  SalesActualsMasterDataIndex,
  normalizeCategoryName,
} from './sales-actuals-lookup.service';

function buildIndex(): SalesActualsMasterDataIndex {
  const channelNka = {
    id: 'chan-nka',
    code: 'NKA',
    name: 'National Key Accounts',
  } as any;
  const channelDist = {
    id: 'chan-dist',
    code: 'DISTRIBUTOR',
    name: 'Distributor',
  } as any;
  const cpl = {
    id: 'cpl-1',
    code: 'BS0501.50006',
    channelId: 'chan-nka',
  } as any;
  const catSekil = {
    id: 'cat-sekil',
    code: 'CAT-SEKILLENDIRICI',
    name: 'Şekillendirici',
  } as any;
  const catDup1 = { id: 'cat-dup-1', code: 'CAT-DUP-1', name: 'Set' } as any;
  const catDup2 = { id: 'cat-dup-2', code: 'CAT-DUP-2', name: 'set' } as any; // aynı normalize isim

  return {
    cplByCode: new Map([[cpl.code, cpl]]),
    channelByCode: new Map([
      [channelNka.code, channelNka],
      [channelDist.code, channelDist],
    ]),
    channelById: new Map([
      [channelNka.id, channelNka],
      [channelDist.id, channelDist],
    ]),
    categoryByCode: new Map([
      [catSekil.code, catSekil],
      [catDup1.code, catDup1],
      [catDup2.code, catDup2],
    ]),
    categoryByNormalizedName: new Map([
      ['şekillendirici', [catSekil]],
      ['set', [catDup1, catDup2]],
    ]),
  };
}

describe('SalesActualsValidationService', () => {
  const service = new SalesActualsValidationService();
  const index = buildIndex();

  it('geçerli satırı kabul eder ve doğru scope/tutarları döner', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '400000',
        net_amount: '390000',
        discount_amount: '10000',
      },
      2,
      '2026-01',
      index,
    );

    expect(outcome.isValid).toBe(true);
    expect(outcome.errors).toHaveLength(0);
    expect(outcome.warnings).toHaveLength(0);
    expect(outcome.row).toMatchObject({
      cplId: 'cpl-1',
      categoryId: 'cat-sekil',
      channelId: 'chan-nka',
      grossAmount: 400000,
      netAmount: 390000,
      discountAmount: 10000,
    });
  });

  it("Türkçe İ/ı tuzağı: tr-TR locale normalize İ->i eşlemesini en-US'ten FARKLI yapar", () => {
    // en-US: 'İ'.toLowerCase() -> 'i̇' (nokta korunur, kod noktası FARKLI 'i'den)
    // tr-TR: 'İ'.toLocaleLowerCase('tr-TR') -> 'i' (nokta düşer, tam eşleşir)
    const withDefaultLocale = 'İSTANBUL'.toLowerCase();
    const withTrLocale = normalizeCategoryName('İSTANBUL');
    expect(withTrLocale).toBe('istanbul');
    expect(withDefaultLocale).not.toBe('istanbul');
  });

  it('bilinmeyen cpl_code -> UNKNOWN_CPL, satır reddi', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'UNKNOWN',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '100',
      },
      3,
      '2026-01',
      index,
    );
    expect(outcome.isValid).toBe(false);
    expect(outcome.errors.map((e) => e.code)).toContain('UNKNOWN_CPL');
  });

  it('bilinmeyen kategori -> UNKNOWN_CATEGORY, satır reddi', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Var Olmayan Kategori',
        channel_code: 'NKA',
        gross_amount: '100',
      },
      4,
      '2026-01',
      index,
    );
    expect(outcome.isValid).toBe(false);
    expect(outcome.errors.map((e) => e.code)).toContain('UNKNOWN_CATEGORY');
  });

  it('normalize isim çakışması -> AMBIGUOUS_CATEGORY, sessiz seçim yok', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Set',
        channel_code: 'NKA',
        gross_amount: '100',
      },
      5,
      '2026-01',
      index,
    );
    expect(outcome.isValid).toBe(false);
    expect(outcome.errors.map((e) => e.code)).toContain('AMBIGUOUS_CATEGORY');
  });

  it('category_code verilirse ismin önüne geçer (öncelikli)', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Set', // çakışan isim
        category_code: 'CAT-DUP-2',
        channel_code: 'NKA',
        gross_amount: '100',
      },
      6,
      '2026-01',
      index,
    );
    expect(outcome.isValid).toBe(true);
    expect(outcome.row?.categoryId).toBe('cat-dup-2');
  });

  it('channel_code CPL kanalıyla uyuşmuyorsa -> CHANNEL_MISMATCH', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'BS0501.50006', // NKA CPL'i
        category: 'Şekillendirici',
        channel_code: 'DISTRIBUTOR',
        gross_amount: '100',
      },
      7,
      '2026-01',
      index,
    );
    expect(outcome.isValid).toBe(false);
    expect(outcome.errors.map((e) => e.code)).toContain('CHANNEL_MISMATCH');
  });

  it('gross_amount boş/negatif -> INVALID_GROSS_AMOUNT', () => {
    const outcomeEmpty = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '',
      },
      8,
      '2026-01',
      index,
    );
    expect(outcomeEmpty.errors.map((e) => e.code)).toContain(
      'INVALID_GROSS_AMOUNT',
    );

    const outcomeNegative = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '-5',
      },
      9,
      '2026-01',
      index,
    );
    expect(outcomeNegative.errors.map((e) => e.code)).toContain(
      'INVALID_GROSS_AMOUNT',
    );
  });

  it('net_amount > gross_amount -> NET_EXCEEDS_GROSS (TTM bunu kontrol etmiyordu, port düzeltmesi)', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '100',
        net_amount: '150',
      },
      10,
      '2026-01',
      index,
    );
    expect(outcome.isValid).toBe(false);
    expect(outcome.errors.map((e) => e.code)).toContain('NET_EXCEEDS_GROSS');
  });

  it('net+discount != gross -> yalnızca WARNING, satır kabul edilir (BRD tanımsız -> varsayım yok)', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: '400000',
        net_amount: '360000',
        discount_amount: '15000', // 360000+15000=375000 != 400000
      },
      11,
      '2026-01',
      index,
    );
    expect(outcome.isValid).toBe(true);
    expect(outcome.warnings.map((w) => w.code)).toContain(
      'AMOUNT_RECONCILIATION',
    );
  });

  it('resolvedScope: kimlik alanları çözülürse tutar hatalı olsa bile scope bilgisi taşınır', () => {
    const outcome = service.validateRow(
      {
        cpl_code: 'BS0501.50006',
        category: 'Şekillendirici',
        channel_code: 'NKA',
        gross_amount: 'invalid-number',
      },
      12,
      '2026-01',
      index,
    );
    expect(outcome.isValid).toBe(false);
    expect(outcome.resolvedScope).toMatchObject({
      cplId: 'cpl-1',
      categoryId: 'cat-sekil',
    });
  });
});

describe('parseAmount', () => {
  it('düz sayıyı parse eder', () => {
    expect(parseAmount('400000')).toBe(400000);
  });

  it('Türkçe biçimli sayıyı parse eder (binlik nokta, ondalık virgül)', () => {
    expect(parseAmount('1.234.567,89')).toBeCloseTo(1234567.89);
  });

  // T-105: the defect this file carried. `1.234.567,89` above was the ONE example
  // that happened to work — two separators took the correct branch — so the format
  // family looked covered while its most common member was broken.
  it('tek binlik ayraçlı Türkçe biçimi doğru okur (T-105: 1000 kat hataydı)', () => {
    expect(parseAmount('1.234,56')).toBeCloseTo(1234.56);
    expect(parseAmount('1.000,00')).toBe(1000);
    expect(parseAmount('999.999,99')).toBeCloseTo(999999.99);
  });

  it('ondalık virgülü binlik ayraç sanmıyor (T-105: 100 kat hataydı)', () => {
    expect(parseAmount('1234,56')).toBeCloseTo(1234.56);
  });

  // T-099 closes here: the grammar has no exponent and no `Infinity` literal, so
  // this is refused by construction rather than by a special case.
  it('Infinity ve üstel gösterimi reddeder (T-099)', () => {
    expect(parseAmount('Infinity')).toBeNull();
    expect(parseAmount('1e999')).toBeNull();
    expect(parseAmount('1e5')).toBeNull();
  });

  it('belirsiz biçimi reddeder ve sebebini söyler', () => {
    expect(parseAmount('1.234')).toBeNull();
    expect(amountFailure('1.234')).toContain('Belirsiz');
    // Ve ayırt ediyor: geçersiz ile belirsiz aynı mesajı almıyor.
    expect(amountFailure('abc')).not.toContain('Belirsiz');
  });

  it('geçersiz değerde null döner', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

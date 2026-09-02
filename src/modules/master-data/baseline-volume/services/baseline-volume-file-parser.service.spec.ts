import { execFileSync } from 'child_process';
import * as path from 'path';
import {
  BaselineVolumeFileParserService,
  ParsedBaselineVolumeRow,
} from './baseline-volume-file-parser.service';
import { FieldParseError } from '../../../../common/row-parsing/field-parse-error';

type GetPeriodValueFn = (
  v: unknown,
  f: string,
  e: FieldParseError[],
) => string | undefined;

/**
 * `BL-2` (`docs/process/BL2_GIRIS_BRIEF.md §2a`) — PİN 1: kaynak hücre →
 * period etiketi, ÜÇ TZ'DE AYNI. Ve Q20/`§3` satır-düzeyi ayırt edicilik:
 * eksik alanlı satır YOK, tam satır VAR — AYNI koşumda.
 *
 * ⛔ İKİNCİ SÜRÜM (Team Lead mutasyonla ölçtü, ürün sahibi onaylı yeniden
 * tasarım şekli `(b)`) — İLK SÜRÜM KÖRDÜ:
 *
 *   const originalTz = process.env.TZ;
 *   beforeEach(() => { process.env.TZ = tz; ... })   // ⛔ ETKİSİZ
 *
 * Ölçüldü: bu Jest worker'ında çalışan bir süreç içinde `process.env.TZ`'yi
 * ilk local-clock `Date` hesabından SONRA değiştirmek `Date`'in çözdüğü
 * ofseti değiştirmiyor (V8 bunu süreç başında önbelleğe alıyor gibi
 * davranıyor) — üç "farklı" TZ testi aslında AYNI TZ'yi üç kez ölçüyordu.
 * Mutasyon kanıtı: `getPeriodValue`'nun Excel-serial dalı `Date`+yerel
 * getter'a çevrildiğinde `TZ=UTC` ve `TZ=Europe/Istanbul` altında testler
 * YEŞİL KALDI — kırmızı yalnız `TZ=America/New_York`'ta çıktı, host
 * makinenin gerçek TZ'si neyse onu ölçtüğümüz için.
 *
 * BU DOSYADAKİ AYNI KUSUR, AYNI AİLENİN İKİ KOMŞU DOSYASINDA ZATEN
 * ADLANDIRILMIŞTI (`excel-serial-date.spec.ts`, `period-month.spec.ts`) —
 * ikisi de `getPeriodValue`'nun çağırdığı yardımcıların testleri. Yeniden
 * tasarım onların desenini BİREBİR alıyor: her `TZ` GERÇEKTEN FARKLI bir
 * `node` alt-sürecinde, `TZ` o sürecin ortamında BAŞTAN İTİBAREN sabit
 * (asla süreç-içi mutasyon yok) — `execFileSync` + `ts-node/register/
 * transpile-only`, gerçek modülü mutlak yoldan `require()` ediyor.
 *
 * Harness'in kendisi de (sibling dosyaların ikisi de yaptığı gibi) önce
 * KENDİ duyarlılığı için sınanıyor ("harness sanity" bloğu) — `TZ`'ye
 * gerçekten duyarlı olduğu KANITLANMADAN üstüne inşa edilmiyor (§2.7).
 */
const MODULE_PATH = path.resolve(
  __dirname,
  './baseline-volume-file-parser.service.ts',
);

interface PeriodBattery {
  main: string | undefined; // serial 46037 -> 2026-01
  monthBoundary: string | undefined; // serial 46082 -> 2026-03 (ay GEÇİŞİ — ayın İLK günü)
  monthEnd: string | undefined; // serial 46053 -> 2026-01 (ay SONU — ayın SON günü)
  dstSpring: string | undefined; // serial 46110 -> 2026-03
  dstFall: string | undefined; // serial 46320 -> 2026-10
  fractionalDay: string | undefined; // serial 46037.75 -> 2026-01 (saat taşıyan serial)
  leapBugDay: string | undefined; // serial 60 -> undefined (1900 artık-yıl, YOK sayılan gün — REDDEDİLİR)
  textLabel: string | undefined; // metin 'YYYY-MM' -> aynen
  isoDateText: string | undefined; // '2026-02-15' -> 2026-02
  turkishDateText: string | undefined; // '15.02.2026' -> 2026-02
}

/**
 * `excel-serial-date.spec.ts`'in `computeBatteryUnderZone`'unun BİREBİR aynı
 * mekanizması: `TZ` yalnız çocuk sürecin ortamında, süreç hiçbir `Date`'e
 * dokunmadan ÖNCE sabitleniyor.
 */
function computePeriodBatteryUnderZone(tz: string): PeriodBattery {
  const script = `
    const { BaselineVolumeFileParserService } = require(${JSON.stringify(MODULE_PATH)});
    const service = new BaselineVolumeFileParserService();
    const call = (value) => {
      const errors = [];
      return service.getPeriodValue(value, 'period', errors);
    };
    const battery = {
      main: call(46037),
      monthBoundary: call(46082),
      monthEnd: call(46053),
      dstSpring: call(46110),
      dstFall: call(46320),
      fractionalDay: call(46037.75),
      leapBugDay: call(60),
      textLabel: call('2026-02'),
      isoDateText: call('2026-02-15'),
      turkishDateText: call('15.02.2026'),
    };
    process.stdout.write(JSON.stringify(battery));
  `;
  const stdout = execFileSync(
    'node',
    ['-r', 'ts-node/register/transpile-only', '-e', script],
    { env: { ...process.env, TZ: tz }, encoding: 'utf-8' },
  );
  return JSON.parse(stdout) as PeriodBattery;
}

/** Harness'in kendisinin `TZ`'ye duyarlı olduğunun DOĞRUDAN kanıtı —
 *  `excel-serial-date.spec.ts`'in aynı "harness sanity" adımı. */
function timezoneOffsetUnderZone(tz: string): number {
  const script = `process.stdout.write(String(new Date(2026, 0, 15).getTimezoneOffset()));`;
  const stdout = execFileSync('node', ['-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf-8',
  });
  return Number(stdout);
}

const ZONES = ['UTC', 'Europe/Istanbul', 'America/New_York'] as const;

describe('BaselineVolumeFileParserService — PİN 1: period label, üç TZ (child-process harness)', () => {
  describe('harness sanity — kanıtlanmadan güvenilmiyor (§2.7)', () => {
    it('taze bir alt-süreç TZ değişimini GERÇEKTEN yansıtır (süreç-içi mutasyonun aksine)', () => {
      expect(timezoneOffsetUnderZone('UTC')).toBe(0);
      expect(timezoneOffsetUnderZone('Europe/Istanbul')).toBe(-180);
      expect(timezoneOffsetUnderZone('America/New_York')).toBe(300);
    });
  });

  describe('metin YYYY-MM: üç TZ aynı sonucu verir', () => {
    it.each(ZONES)('TZ=%s', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.textLabel).toBe('2026-02');
    });
  });

  describe('Excel serial-date (2026-01-15 ≈ 46037): üç TZ AYNI etiketi verir', () => {
    it.each(ZONES)('TZ=%s', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.main).toBe('2026-01');
    });
  });

  describe('ay sınırı — ayın İLK günü (Excel serial → 2026-03-01): üç TZ aynı etiketi verir', () => {
    it.each(ZONES)('TZ=%s', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.monthBoundary).toBe('2026-03');
    });
  });

  describe('ay sınırı — ayın SON günü (Excel serial → 2026-01-31, ay-sonu): üç TZ aynı etiketi verir', () => {
    it.each(ZONES)('TZ=%s', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.monthEnd).toBe('2026-01');
    });
  });

  describe('DST sınırları (bahar/güz) — üç TZ aynı etiketi verir', () => {
    it.each(ZONES)('TZ=%s — bahar (46110 -> 2026-03)', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.dstSpring).toBe('2026-03');
    });
    it.each(ZONES)('TZ=%s — güz (46320 -> 2026-10)', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.dstFall).toBe('2026-10');
    });
  });

  describe("saat taşıyan serial (46037.75 — günün 3/4'ü): üç TZ aynı etiketi verir", () => {
    it.each(ZONES)('TZ=%s', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.fractionalDay).toBe('2026-01');
    });
  });

  describe("1900 artık-yıl hatası (serial 60, Excel'in var olmayan 29 Şubat 1900'ü): üç TZ REDDEDER — TZ-bağımsız İNŞA gereği", () => {
    it.each(ZONES)('TZ=%s', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.leapBugDay).toBeUndefined();
    });
  });

  describe('tam tarih metni (ISO 2026-02-15): üç TZ aynı etiketi verir', () => {
    it.each(ZONES)('TZ=%s', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.isoDateText).toBe('2026-02');
    });
  });

  describe('tam tarih metni (Türk 15.02.2026): üç TZ aynı etiketi verir', () => {
    it.each(ZONES)('TZ=%s', (tz) => {
      const battery = computePeriodBatteryUnderZone(tz);
      expect(battery.turkishDateText).toBe('2026-02');
    });
  });
});

/**
 * Reddedilen dallar `Date` HİÇ kurmuyor (bkz. `getPeriodValue` — hem metin
 * grameri hem `excelSerialToIsoDate`'in refuse dalları erken `return`
 * ediyor, `EXCEL_EPOCH_UTC_MS` toplamına hiç ulaşmıyor) — bu yüzden İNŞA
 * GEREĞİ TZ-bağımsızlar (`excel-serial-date.spec.ts`'in aynı gerekçesi).
 * Alt-süreç GEREKMİYOR, doğrudan gerçek modüle karşı sınanıyor.
 */
describe('BaselineVolumeFileParserService — reddedilen dallar (TZ-bağımsız İNŞA gereği, alt-süreç GEREKMİYOR)', () => {
  let service: BaselineVolumeFileParserService;

  beforeEach(() => {
    service = new BaselineVolumeFileParserService();
  });

  const getPeriodValue = (value: unknown): string | undefined => {
    const errors: FieldParseError[] = [];
    return (
      service as unknown as { getPeriodValue: GetPeriodValueFn }
    ).getPeriodValue(value, 'period', errors);
  };

  it('geçersiz metin biçimi (US sıra, "3/4/26") REDDEDİLİR — tahmin edilmez', () => {
    const errors: FieldParseError[] = [];
    const result = (
      service as unknown as { getPeriodValue: GetPeriodValueFn }
    ).getPeriodValue('3/4/26', 'period', errors);
    expect(result).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0].error_type).toBe('INVALID_PERIOD');
  });

  it('boş hücre: sessizce undefined, HATA ÜRETMEZ (§2.5 — yok ile bozuk aynı şey değildir)', () => {
    const errors: FieldParseError[] = [];
    const result = (
      service as unknown as { getPeriodValue: GetPeriodValueFn }
    ).getPeriodValue(null, 'period', errors);
    expect(result).toBeUndefined();
    expect(errors).toHaveLength(0);
  });

  it('sanity: getPeriodValue in-process de aynı sonucu verir (46037 -> 2026-01)', () => {
    expect(getPeriodValue(46037)).toBe('2026-01');
  });
});

describe('BaselineVolumeFileParserService — Q20/§3: eksik satır tabloya HİÇ girmez, tam satır girer (AYNI koşum)', () => {
  let service: BaselineVolumeFileParserService;

  beforeEach(() => {
    service = new BaselineVolumeFileParserService();
  });

  it('bir tam ve bir eksik-alanlı satır AYNI dosyada ayrışır', () => {
    const rows = (
      service as unknown as {
        mapToBaselineVolumeRows(
          data: Record<string, unknown>[],
        ): ParsedBaselineVolumeRow[];
      }
    ).mapToBaselineVolumeRows([
      {
        sku_code: 'SKU-001',
        cpl_code: 'CPL-001',
        period: '2026-02',
        base_volume: '1000',
      },
      {
        sku_code: 'SKU-002',
        cpl_code: null, // eksik
        period: '2026-02',
        base_volume: '500',
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].skuCode).toBe('SKU-001');
    expect(rows[0].cplCode).toBe('CPL-001');
    expect(rows[0].baseVolume).toBe(1000);

    expect(rows[1].skuCode).toBe('SKU-002');
    expect(rows[1].cplCode).toBeUndefined();
  });
});

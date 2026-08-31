import {
  countPlannedSkus,
  resolveSkuSpendInputs,
  summarizeNotEvaluableSkus,
  SpendInputResolution,
} from './sku-spend-inputs';

/**
 * `T-337` / `Z77 §1-§2` — `A`/`B` AYRIMI **ALAN BAŞINA SABİT**.
 *
 * ⛔ Bu dosya bir *"resolver çalışıyor mu"* testi değil, **hükmün pini**:
 * her alanın eksikliği HANGİ sonucu doğurur, ve iki sonuç **ayırt
 * edilebiliyor mu** (`T-332`: fixture farkı gerekli ama YETERSİZ — farkı
 * OKUYAN assertion şart).
 */
describe('resolveSkuSpendInputs — alan başına sabit A/B ayrımı', () => {
  const complete = {
    skuId: 'sku-1',
    baseVolume: 1000,
    plannedVolume: 1200,
    listPrice: 10,
    cogsPerUnit: 6,
  };

  it('tüm girdiler varken EVALUABLE, ve taban da değerlendirilebilir', () => {
    const r = resolveSkuSpendInputs(complete);
    expect(r.kind).toBe('EVALUABLE');
    if (r.kind !== 'EVALUABLE') throw new Error('unreachable');
    expect(r.baseEvaluable).toBe(true);
    expect(r.ctx.baseVolume).toBe(1000);
    expect(r.ctx.plannedVolume).toBe(1200);
    expect(r.ctx.listPrice).toBe(10);
    expect(r.ctx.cogsPerUnit).toBe(6);
  });

  // ── `B` — NOT_EVALUABLE üreten alanlar ────────────────────────────────
  it('PLAN_VOL yoksa NOT_EVALUABLE (0 harcama DEĞİL) — ama TABAN sağlam', () => {
    const r = resolveSkuSpendInputs({ ...complete, plannedVolume: null });
    expect(r.kind).toBe('NOT_EVALUABLE');
    if (r.kind !== 'NOT_EVALUABLE') throw new Error('unreachable');
    expect(r.missing).toEqual(['PLAN_VOL']);
    // ⛔ `NOT_EVALUABLE` = *"PLANLANAN harcama hesaplanamaz"*, *"hiçbir şey
    // hesaplanamaz"* DEĞİL. Taban `BASE_VOL × BPTT`'dir ve `PLAN_VOL`'e
    // bağlı değildir — `ctx` bu yüzden VAR.
    expect(r.ctx).not.toBeNull();
    expect(r.baseEvaluable).toBe(true);
    expect(r.ctx!.plannedVolume).toBeNull();
    expect(r.ctx!.baseVolume).toBe(1000);
  });

  it('BPTT yoksa NOT_EVALUABLE — ve ctx BİLE üretilmez', () => {
    const r = resolveSkuSpendInputs({ ...complete, listPrice: null });
    expect(r.kind).toBe('NOT_EVALUABLE');
    if (r.kind !== 'NOT_EVALUABLE') throw new Error('unreachable');
    expect(r.missing).toEqual(['BPTT']);
    // ⛔ AYIRT EDİCİ: `PLAN_VOL` vakasıyla AYNI SONUCU VERMİYOR.
    // `BPTT` her iki kovanın da çarpanı ⇒ hiçbir şey hesaplanamaz.
    expect(r.ctx).toBeNull();
    expect(r.baseEvaluable).toBe(false);
  });

  it('ikisi birden yoksa İKİSİ DE adıyla raporlanır, sıra sabit', () => {
    const r = resolveSkuSpendInputs({
      ...complete,
      plannedVolume: null,
      listPrice: undefined,
    });
    if (r.kind !== 'NOT_EVALUABLE') throw new Error('unreachable');
    // ⛔ SIRA PİNLİ: mesaj metni deterministik olmalı.
    expect(r.missing).toEqual(['PLAN_VOL', 'BPTT']);
  });

  // ── `BASE_VOL` — ÜÇÜNCÜ SINIF, ikisinden de AYRI ──────────────────────
  it('BASE_VOL yoksa plan HÂLÂ değerlendirilebilir, yalnız TABAN düşer', () => {
    const r = resolveSkuSpendInputs({ ...complete, baseVolume: null });
    expect(r.kind).toBe('EVALUABLE');
    if (r.kind !== 'EVALUABLE') throw new Error('unreachable');
    // ⛔ AYIRT EDİCİ ASSERTION: `PLAN_VOL` yokluğuyla AYNI SONUCU vermiyor.
    expect(r.baseEvaluable).toBe(false);
    expect(r.ctx.baseVolume).toBeNull();
    // ...ve planlanan taraf sağlam:
    expect(r.ctx.plannedVolume).toBe(1200);
  });

  // ── `A` — çözülmüş `0`, ve `null` ile KARIŞTIRILMAZ ───────────────────
  it('girilen 0 ile girilmemiş null AYIRT EDİLİR (T-027 mirasının pini)', () => {
    const zero = resolveSkuSpendInputs({ ...complete, baseVolume: 0 });
    const absent = resolveSkuSpendInputs({ ...complete, baseVolume: null });
    if (zero.kind !== 'EVALUABLE' || absent.kind !== 'EVALUABLE') {
      throw new Error('unreachable');
    }
    expect(zero.ctx.baseVolume).toBe(0);
    expect(zero.baseEvaluable).toBe(true);
    expect(absent.ctx.baseVolume).toBeNull();
    expect(absent.baseEvaluable).toBe(false);
    // ⛔ `?? 0` bu iki durumu AYNI değere çöktürüyordu — bu satır o
    // çöküşün geri gelmesini yakalar.
    expect(zero.ctx.baseVolume).not.toBe(absent.ctx.baseVolume);
  });

  it('plannedVolume 0 GİRİLMİŞSE değerlendirilebilir (0 ≠ eksik)', () => {
    const r = resolveSkuSpendInputs({ ...complete, plannedVolume: 0 });
    expect(r.kind).toBe('EVALUABLE');
  });

  // ── `COGS` — spend için İLGİSİZ ───────────────────────────────────────
  it('COGS yokluğu spend değerlendirmesini ENGELLEMEZ (K1 §4a)', () => {
    const r = resolveSkuSpendInputs({ ...complete, cogsPerUnit: null });
    expect(r.kind).toBe('EVALUABLE');
    if (r.kind !== 'EVALUABLE') throw new Error('unreachable');
    // ⛔ ama `0`'a da düşmez — KPI tarafı `null` görmek zorunda.
    expect(r.ctx.cogsPerUnit).toBeNull();
  });

  // ── decimal kolon okuma sözleşmesi ────────────────────────────────────
  it('pg dizgesi okunur, okunamayan girdi 0 DEĞİL null sayılır', () => {
    const asString = resolveSkuSpendInputs({
      ...complete,
      plannedVolume: '1200.50',
    });
    if (asString.kind !== 'EVALUABLE') throw new Error('unreachable');
    expect(asString.ctx.plannedVolume).toBe(1200.5);

    const garbage = resolveSkuSpendInputs({ ...complete, listPrice: 'abc' });
    expect(garbage.kind).toBe('NOT_EVALUABLE');
    const empty = resolveSkuSpendInputs({ ...complete, listPrice: '' });
    expect(empty.kind).toBe('NOT_EVALUABLE');
  });
});

describe('summarizeNotEvaluableSkus — alan başına SKU sayısı', () => {
  it('yalnız NOT_EVALUABLE olanları, alan başına sayar', () => {
    const resolutions: SpendInputResolution[] = [
      resolveSkuSpendInputs({
        skuId: 'a',
        baseVolume: 1,
        plannedVolume: null,
        listPrice: 10,
        cogsPerUnit: 1,
      }),
      resolveSkuSpendInputs({
        skuId: 'b',
        baseVolume: 1,
        plannedVolume: null,
        listPrice: null,
        cogsPerUnit: 1,
      }),
      resolveSkuSpendInputs({
        skuId: 'c',
        baseVolume: null,
        plannedVolume: 5,
        listPrice: 10,
        cogsPerUnit: null,
      }),
    ];
    // `c` EVALUABLE (yalnız tabanı düşük) ⇒ sayıma GİRMEZ.
    expect(summarizeNotEvaluableSkus(resolutions)).toEqual({
      PLAN_VOL: 2,
      BPTT: 1,
    });
  });

  it('hepsi tamsa boş nesne — ve boş nesne "hepsi hesaplandı" demektir', () => {
    expect(
      summarizeNotEvaluableSkus([
        resolveSkuSpendInputs({
          skuId: 'a',
          baseVolume: 1,
          plannedVolume: 2,
          listPrice: 3,
          cogsPerUnit: 4,
        }),
      ]),
    ).toEqual({});
  });
});

/**
 * `Q20` (ürün sahibi, 2026-08-31) — DOKUNULMAMIŞ satır ÜÇÜNCÜ SINIFTIR,
 * `NOT_EVALUABLE` DEĞİLDİR. `addSku` her satırı `baseVolume=NULL,
 * plannedVolume=NULL` ile doğurur (`plan.repository.ts:546`) — bu hükmün
 * ölçtüğü "varsayılan doğum hâli".
 */
describe('resolveSkuSpendInputs — UNTOUCHED (Q20 üçüncü sınıf)', () => {
  it('baseVolume VE plannedVolume ikisi de null ⇒ UNTOUCHED, NOT_EVALUABLE DEĞİL', () => {
    const r = resolveSkuSpendInputs({
      skuId: 'sku-untouched',
      baseVolume: null,
      plannedVolume: null,
      listPrice: 10,
      cogsPerUnit: 6,
    });
    expect(r.kind).toBe('UNTOUCHED');
    if (r.kind !== 'UNTOUCHED') throw new Error('unreachable');
    expect(r.baseEvaluable).toBe(false);
    // ⛔ `missing`/`ctx` alanları TİP SEVİYESİNDE yok — bu satır derlenmesi
    // için `r`'nin `UNTOUCHED` dalına daralmış olması şart; derlenmesinin
    // kendisi bir pin'dir (dosyanın felsefesi: "unutulan çağıran derleme
    // hatası olur").
  });

  it('UNTOUCHED, listPrice/cogsPerUnit DOLU olsa bile tetiklenir (satırın KENDİ alanı belirler)', () => {
    // ⛔ AYIRT EDİCİ: listPrice/cogsPerUnit SKU ana-verisidir, satırın
    // alanı değildir — evreni GENİŞLETMEZ.
    const r = resolveSkuSpendInputs({
      skuId: 'sku-untouched-2',
      baseVolume: null,
      plannedVolume: null,
      listPrice: 999,
      cogsPerUnit: 1,
    });
    expect(r.kind).toBe('UNTOUCHED');
  });

  it('yalnız plannedVolume null (baseVolume DOLU) ⇒ UNTOUCHED DEĞİL, NOT_EVALUABLE (Z77 hâlâ yaşıyor)', () => {
    const r = resolveSkuSpendInputs({
      skuId: 'sku-partial',
      baseVolume: 800,
      plannedVolume: null,
      listPrice: 10,
      cogsPerUnit: 6,
    });
    expect(r.kind).toBe('NOT_EVALUABLE');
  });

  it('yalnız baseVolume null (plannedVolume DOLU) ⇒ UNTOUCHED DEĞİL, EVALUABLE (baseEvaluable=false)', () => {
    const r = resolveSkuSpendInputs({
      skuId: 'sku-partial-2',
      baseVolume: null,
      plannedVolume: 1200,
      listPrice: 10,
      cogsPerUnit: 6,
    });
    expect(r.kind).toBe('EVALUABLE');
  });

  it('UNTOUCHED, summarizeNotEvaluableSkus sayımına GİRMEZ (bugünkü davranış PİNLENDİ)', () => {
    const resolutions = [
      resolveSkuSpendInputs({
        skuId: 'a',
        baseVolume: null,
        plannedVolume: null,
        listPrice: 10,
        cogsPerUnit: 6,
      }),
      resolveSkuSpendInputs({
        skuId: 'b',
        baseVolume: 800,
        plannedVolume: null, // NOT_EVALUABLE — bu SAYILMALI
        listPrice: 10,
        cogsPerUnit: 6,
      }),
    ];
    expect(summarizeNotEvaluableSkus(resolutions)).toEqual({ PLAN_VOL: 1 });
  });
});

describe('countPlannedSkus — Q20 plan-düzeyi "dolu satır" tek sayacı', () => {
  it('hepsi UNTOUCHED ⇒ 0', () => {
    const resolutions = [
      resolveSkuSpendInputs({
        skuId: 'a',
        baseVolume: null,
        plannedVolume: null,
        listPrice: 10,
        cogsPerUnit: 6,
      }),
      resolveSkuSpendInputs({
        skuId: 'b',
        baseVolume: null,
        plannedVolume: null,
        listPrice: 10,
        cogsPerUnit: 6,
      }),
    ];
    expect(countPlannedSkus(resolutions)).toBe(0);
  });

  it('1 dolu + N boş ⇒ 1 (UNTOUCHED satırlar SAYILMAZ, dolu satır SAYILIR)', () => {
    const resolutions = [
      resolveSkuSpendInputs({
        skuId: 'a',
        baseVolume: 800,
        plannedVolume: 1000,
        listPrice: 10,
        cogsPerUnit: 6,
      }),
      resolveSkuSpendInputs({
        skuId: 'b',
        baseVolume: null,
        plannedVolume: null,
        listPrice: 10,
        cogsPerUnit: 6,
      }),
      resolveSkuSpendInputs({
        skuId: 'c',
        baseVolume: null,
        plannedVolume: null,
        listPrice: 10,
        cogsPerUnit: 6,
      }),
    ];
    expect(countPlannedSkus(resolutions)).toBe(1);
  });

  it('NOT_EVALUABLE (kısmi, dokunulmuş) satır SAYILIR — UNTOUCHED değil', () => {
    const resolutions = [
      resolveSkuSpendInputs({
        skuId: 'a',
        baseVolume: 800,
        plannedVolume: null, // dokunulmuş ama eksik ⇒ NOT_EVALUABLE
        listPrice: 10,
        cogsPerUnit: 6,
      }),
    ];
    expect(countPlannedSkus(resolutions)).toBe(1);
  });
});

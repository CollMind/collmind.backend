import {
  collectPlanStructureWarnings,
  collectPlanSubmissionValidationErrors,
  collectPlanSubmissionWarnings,
  planSpendBreakdownError,
  resolvePlanSpendBreakdown,
} from './submission-checks';

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

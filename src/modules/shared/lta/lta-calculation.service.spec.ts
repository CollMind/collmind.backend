/**
 * SÖZLEŞME: LTA harcama hesabı EKSİK GİRDİYİ SESSİZCE `0` SAYMAZ ([[T-291]]).
 *
 * ── KUSUR (düzeltmeden ÖNCE, koddan ve DB'den ölçüldü) ──────────────────
 * ```ts
 * const baseVolume = planSku.baseVolume || 0;   // eksik HACİM  → sessizce 0
 * const listPrice  = sku.unitPrice     || 0;    // eksik FİYAT  → sessizce 0
 * const baseGsv    = baseVolume * listPrice;    // ⇒ 0
 * ```
 * Dört düşüş vardı (`:45 :46 :120 :121`). İkisi de **ULAŞILABİLİR** bir yol:
 * `main.plan_skus.base_volume`/`planned_volume` ve `main.skus.unit_price`
 * üçü de `is_nullable=YES` (ölçüldü 2026-08-30, şema-nitelendirilmiş).
 *
 * ⚠️ **Yön TEHLİKELİ:** eksik fiyat → LTA harcaması olduğundan **KÜÇÜK** →
 * ROI olduğundan **İYİ** görünür. `DISIPLIN`: *"beklenen yöne yanılan bir
 * hata, ters yöne yanılandan tehlikelidir."*
 *
 * ── REPRODÜKSİYON ──────────────────────────────────────────────────────
 * Bu dosya düzeltmeden ÖNCEki koda karşı koşturuldu (dosya kopyalanıp dört
 * `|| 0` geri konarak): *"NULL unitPrice → hata"* testleri **KIRMIZI**ydı ve
 * kırmızının SEBEBİ tam olarak kusurdu — fonksiyon hata fırlatmak yerine
 * `baseGsv: 0` DÖNÜYORDU. Kanıt: aynı testler `baseGsv`'nin `0` geldiğini de
 * ayrıca assert ediyor (aşağıdaki `SESSİZ SIFIR ŞEKLİ` bloğu).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LTACalculationService } from './lta-calculation.service';
import { LTAAgreementService } from './lta-agreement.service';
import { PlanSku } from '../../../database/entities/plan.entity';
import { Sku } from '../../../database/entities/sku.entity';
import { PlanContextDto } from '../../master-data/mechanic/dto/plan-context.dto';

const TENANT = 'tenant-1';
const PLAN = 'plan-1';
const SKU = 'sku-1';

// ⚠️ Ayırt edici değerler: hacim ≠ fiyat ≠ oran, ve hiçbiri diğerinin katı
// değil — bir alan yanlış alana bağlansaydı sayı TUTMAZDI.
const BASE_VOLUME = 1000;
const PLANNED_VOLUME = 1500;
const UNIT_PRICE = 12.5;
const ON_PCT = 7;
const OFF_PCT = 2;

interface PlanSkuStub {
  id: string;
  baseVolume: number | null | undefined;
  plannedVolume: number | null | undefined;
  sku: { unitPrice: number | null | undefined };
}

function buildPlanSku(overrides: Partial<PlanSkuStub> = {}): PlanSkuStub {
  return {
    id: 'plan-sku-1',
    baseVolume: BASE_VOLUME,
    plannedVolume: PLANNED_VOLUME,
    sku: { unitPrice: UNIT_PRICE },
    ...overrides,
  };
}

describe('LTACalculationService — eksik girdi SESSİZCE 0 sayılmaz (§2.5)', () => {
  let service: LTACalculationService;
  let getLTAForPlanContext: jest.Mock;
  let planSku: PlanSkuStub | null;

  beforeEach(async () => {
    planSku = buildPlanSku();
    getLTAForPlanContext = jest.fn().mockResolvedValue({
      finalOnInvoicePct: ON_PCT,
      finalOffInvoicePct: OFF_PCT,
    });

    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockImplementation(async () => planSku),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LTACalculationService,
        {
          provide: getRepositoryToken(PlanSku),
          useValue: { createQueryBuilder: jest.fn(() => queryBuilder) },
        },
        { provide: getRepositoryToken(Sku), useValue: {} },
        { provide: LTAAgreementService, useValue: { getLTAForPlanContext } },
      ],
    }).compile();

    service = moduleRef.get(LTACalculationService);
  });

  const ctx: PlanContextDto = { cplId: 'cpl-1' };

  describe('POZ. KONTROL — tam girdiyle hesap DOĞRU çalışıyor', () => {
    it('calculateBaseLTASpend: baseGsv = hacim × fiyat, LTA on/off oranlardan türüyor', async () => {
      const r = await service.calculateBaseLTASpend(TENANT, PLAN, SKU, ctx);
      const gsv = BASE_VOLUME * UNIT_PRICE;
      expect(r.baseGsv).toBeCloseTo(gsv, 6);
      expect(r.baseLtaOnInvoiceSpend).toBeCloseTo((gsv * ON_PCT) / 100, 6);
      expect(r.baseLtaOffInvoiceSpend).toBeCloseTo(
        ((gsv - (gsv * ON_PCT) / 100) * OFF_PCT) / 100,
        6,
      );
      // FARKI OKUYAN assertion: on ≠ off (iki oran karışsaydı düşerdi)
      expect(r.baseLtaOnInvoiceSpend).not.toBeCloseTo(
        r.baseLtaOffInvoiceSpend,
        6,
      );
    });

    it('calculatePlannedLTASpend: plannedGsv AYRI bir hacimden türüyor (base ile karışmıyor)', async () => {
      const r = await service.calculatePlannedLTASpend(TENANT, PLAN, SKU, ctx);
      expect(r.plannedGsv).toBeCloseTo(PLANNED_VOLUME * UNIT_PRICE, 6);
      // FARKI OKUYAN assertion: planned ≠ base — `plannedVolume` yerine
      // `baseVolume` okunsaydı bu düşerdi.
      expect(r.plannedGsv).not.toBeCloseTo(BASE_VOLUME * UNIT_PRICE, 6);
    });
  });

  describe('SESSİZ SIFIR ŞEKLİ — dört düşüşün her biri AÇIK HATA veriyor', () => {
    it(':45 baseVolume NULL → hata (ÖNCE: baseGsv sessizce 0)', async () => {
      planSku = buildPlanSku({ baseVolume: null });
      await expect(
        service.calculateBaseLTASpend(TENANT, PLAN, SKU, ctx),
      ).rejects.toThrow(/baseVolume/);
    });

    it(':46 unitPrice NULL (base yolu) → hata (ÖNCE: baseGsv sessizce 0 ⇒ LTA harcaması KÜÇÜK ⇒ ROI İYİ)', async () => {
      planSku = buildPlanSku({ sku: { unitPrice: null } });
      await expect(
        service.calculateBaseLTASpend(TENANT, PLAN, SKU, ctx),
      ).rejects.toThrow(/unitPrice/);
    });

    it(':120 plannedVolume NULL → hata (ÖNCE: plannedGsv sessizce 0)', async () => {
      planSku = buildPlanSku({ plannedVolume: null });
      await expect(
        service.calculatePlannedLTASpend(TENANT, PLAN, SKU, ctx),
      ).rejects.toThrow(/plannedVolume/);
    });

    it(':121 unitPrice NULL (planned yolu) → hata', async () => {
      planSku = buildPlanSku({ sku: { unitPrice: null } });
      await expect(
        service.calculatePlannedLTASpend(TENANT, PLAN, SKU, ctx),
      ).rejects.toThrow(/unitPrice/);
    });

    it('undefined de NULL ile AYNI sınıf (ORM ilişkisi yüklenmemişse)', async () => {
      planSku = buildPlanSku({ baseVolume: undefined });
      await expect(
        service.calculateBaseLTASpend(TENANT, PLAN, SKU, ctx),
      ).rejects.toThrow(/baseVolume/);
    });

    it('SONLU-OLMAYAN sayı da hata (⚠️ `Number(value)` kaldırıldıktan SONRA bu dalın ÖLMEDİĞİNİN kanıtı — review `B1b`)', async () => {
      // `requireFiniteNumber` artık `Number.isFinite(value)`'ı DOĞRUDAN
      // uyguluyor (araya `Number()` girmiyor). Bu test o dalın hâlâ
      // ateşlediğini ölçer: kaldırma bir NO-OP'tu, bir KAPATMA değil.
      planSku = buildPlanSku({ sku: { unitPrice: Number.NaN } });
      await expect(
        service.calculateBaseLTASpend(TENANT, PLAN, SKU, ctx),
      ).rejects.toThrow(/unitPrice/);
    });

    it('⚠️ AYIRT EDİCİ: GERÇEK `0` hacim MEŞRUDUR — hata DEĞİL', async () => {
      // `|| 0` bu iki durumu AYIRT EDEMİYORDU (`0 || 0` = `0`,
      // `null || 0` = `0`). Yeni kontrol yalnız NULL/undefined'ı reddeder.
      planSku = buildPlanSku({ baseVolume: 0 });
      const r = await service.calculateBaseLTASpend(TENANT, PLAN, SKU, ctx);
      expect(r.baseGsv).toBe(0);
      expect(r.baseLtaOnInvoiceSpend).toBe(0);
    });
  });

  describe('LTA YOKLUĞU bilgi kaybı üretmez (T-291 AC 2)', () => {
    it('ltaContext yoksa LTA harcamaları 0 ama baseGsv/baseVolume/listPrice KORUNUR', async () => {
      getLTAForPlanContext.mockResolvedValue(null);
      const r = await service.calculateBaseLTASpend(TENANT, PLAN, SKU, ctx);

      // LTA yok ⇒ LTA harcaması gerçekten 0 (çözülmüş değer, sessiz
      // varsayılan DEĞİL)
      expect(r.baseLtaOnInvoiceSpend).toBe(0);
      expect(r.baseLtaOffInvoiceSpend).toBe(0);

      // ⛔ ÖNCE bunlar da 0'lanıyordu — LTA'dan BAĞIMSIZ ve zaten
      // hesaplanmış değerlerin kaybı.
      expect(r.baseGsv).toBeCloseTo(BASE_VOLUME * UNIT_PRICE, 6);
      expect(r.baseVolume).toBe(BASE_VOLUME);
      expect(r.listPrice).toBe(UNIT_PRICE);
      // FARKI OKUYAN assertion: 0 DEĞİL (eski davranış tam olarak buydu)
      expect(r.baseGsv).not.toBe(0);
    });

    it('planned yolunda da aynı: plannedGsv/plannedVolume/listPrice KORUNUR', async () => {
      getLTAForPlanContext.mockResolvedValue(null);
      const r = await service.calculatePlannedLTASpend(TENANT, PLAN, SKU, ctx);
      expect(r.plannedLtaOnInvoiceSpend).toBe(0);
      expect(r.plannedGsv).toBeCloseTo(PLANNED_VOLUME * UNIT_PRICE, 6);
      expect(r.plannedVolume).toBe(PLANNED_VOLUME);
      expect(r.listPrice).toBe(UNIT_PRICE);
      expect(r.plannedGsv).not.toBe(0);
    });
  });

  it('plan_sku bulunamazsa yine AÇIK HATA (bu davranış zaten doğruydu — regresyon pini)', async () => {
    planSku = null;
    await expect(
      service.calculateBaseLTASpend(TENANT, PLAN, SKU, ctx),
    ).rejects.toThrow(/Plan SKU not found/);
  });
});

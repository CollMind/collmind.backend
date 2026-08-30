import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanSku } from '../../../database/entities/plan.entity';
import { Sku } from '../../../database/entities/sku.entity';
import { LTAAgreementService } from './lta-agreement.service';
import { LTASpendBreakdown } from './dto/lta-context.dto';
import { PlanContextDto } from '../../master-data/mechanic/dto/plan-context.dto';
import { LTAContext } from './dto/lta-context.dto';

/**
 * [[T-291]] — `§2.5` SESSİZ SIFIR YASAĞI.
 *
 * Bu servis dört yerde `planSku.baseVolume || 0` / `sku.unitPrice || 0`
 * yazıyordu. İkisi de DB'de NULLABLE (ölçüldü 2026-08-30, şema-nitelendirilmiş:
 * `main.plan_skus.base_volume`/`planned_volume` → `is_nullable=YES`,
 * `main.skus.unit_price` → `is_nullable=YES`), yani bu bir hata dalı değil
 * ULAŞILABİLİR bir yoldu.
 *
 * ⚠️ Ve yön TEHLİKELİ: eksik fiyat `0` GSV üretir → LTA harcaması olduğundan
 * KÜÇÜK görünür → ROI olduğundan İYİ. `DISIPLIN`: *"beklenen yöne yanılan bir
 * hata, ters yöne yanılandan tehlikelidir."*
 *
 * Karar: **null propagasyonu değil, AÇIK HATA.** Gerekçe — bu servisin dönüş
 * tipi (`LTASpendBreakdown`) tümü `number` olan düz bir DTO'dur; `null`
 * taşıyamaz, ve taşıyacak şekilde genişletmek dört alanın her tüketicisini
 * (controller yanıtı dahil) `null`-farkında yapmayı gerektirirdi — bugün
 * ihtiyaç olmayan bir genişleme (`İlke 1`). Emsal: `budget-policy.service.ts`
 * `BUDGET_POLICY_NOT_CONFIGURED` (`InternalServerErrorException({code,message})`)
 * — "veri eksik, hesaplanamaz" sınıfının bu repodaki yerleşik şekli.
 */
export const LTA_MISSING_INPUT_CODE = 'LTA_CALC_MISSING_INPUT';

function requireFiniteNumber(
  value: number | null | undefined,
  field: string,
  ownerLabel: string,
): number {
  if (value === null || value === undefined) {
    throw new InternalServerErrorException({
      code: LTA_MISSING_INPUT_CODE,
      message:
        `LTA harcaması hesaplanamıyor: ${ownerLabel} '${field}' alanı ` +
        `taşımıyor (NULL). §2.5 — finansal bir yolda eksik girdi sessizce ` +
        `0 sayılmaz; eksik değer girilmeden bu hesap yapılamaz.`,
    });
  }
  // ⛔ `Number(value)` YOK — bilerek, ve ÖLÇÜMLE.
  //
  // İlk yazımda burada `Number(value)` vardı. `money-float --ratchet` onu
  // yakaladı (`ADR 0007 Karar 8.2`: *yeni Alan A dosyası TAM DOĞMALI*) ve
  // ölçüm iki şey söyledi:
  //   1. **no-op'tu.** Bu yola değer YALNIZCA ORM'den geliyor
  //      (`planSkuRepository.createQueryBuilder(...).getOne()`, bu dosyada
  //      kurulur — dışarıdan enjekte edilen ham SQL yolu YOK), ve üç
  //      transformer'ın `from`'u da `parseFiniteOnRead`
  //      (`decimal.transformer.ts:210/283/291` — `DecimalTransformer`
  //      `baseVolume`/`plannedVolume`, `UnitPriceTransformer` `unitPrice`).
  //      `parseFiniteOnRead` `null`/`undefined`'ı KORUR, aksi hâlde
  //      **finite `number`** döndürür (değilse `InvalidDecimalError`).
  //      ⇒ Yukarıdaki `null` kontrolünden sonra `value` zaten `number`.
  //   2. **Zararsız değildi.** `Number()` bir DİZGEYİ sessizce sayıya
  //      çevirir; tip sözleşmesi `number` derken çalışma zamanında dizge
  //      kabul etmek `§2.5`'e komşu bir kokudur — ve `Number('')` `0`'dır,
  //      yani bu satır bir gün tam da yasakladığımız sessiz sıfırı geri
  //      getirebilirdi.
  // ⇒ `Number.isFinite` DOĞRUDAN değere uygulanır: dizge gelirse `false`
  //   döner ve AÇIK HATA'ya düşer (sessiz dönüşüm yok).
  if (!Number.isFinite(value)) {
    throw new InternalServerErrorException({
      code: LTA_MISSING_INPUT_CODE,
      message:
        `LTA harcaması hesaplanamıyor: ${ownerLabel} '${field}' alanı ` +
        `sonlu bir sayı değil. §2.5 — sessizce 0 sayılmaz.`,
    });
  }
  return value;
}

@Injectable()
export class LTACalculationService {
  constructor(
    @InjectRepository(PlanSku)
    private readonly planSkuRepository: Repository<PlanSku>,
    @InjectRepository(Sku)
    private readonly skuRepository: Repository<Sku>,
    private readonly ltaAgreementService: LTAAgreementService,
  ) {}

  async calculateBaseLTASpend(
    tenantId: string,
    planId: string,
    skuId: string,
    planContext: PlanContextDto,
  ): Promise<LTASpendBreakdown> {
    // Get plan SKU
    const planSku = await this.planSkuRepository
      .createQueryBuilder('planSku')
      .leftJoinAndSelect('planSku.sku', 'sku')
      .leftJoinAndSelect('planSku.planFu', 'planFu')
      .leftJoinAndSelect('planFu.plan', 'plan')
      .where('planSku.tenantId = :tenantId', { tenantId })
      .andWhere('planSku.skuId = :skuId', { skuId })
      .andWhere('plan.id = :planId', { planId })
      .getOne();

    if (!planSku) {
      throw new Error(
        `Plan SKU not found for planId: ${planId}, skuId: ${skuId}`,
      );
    }

    const sku = planSku.sku;
    const baseVolume = requireFiniteNumber(
      planSku.baseVolume,
      'baseVolume',
      `plan_skus/${planSku.id}`,
    );
    const listPrice = requireFiniteNumber(
      sku.unitPrice,
      'unitPrice',
      `skus/${skuId}`,
    );

    // Calculate Base GSV
    const baseGsv = baseVolume * listPrice;

    // Get LTA context (with planId for override check)
    const ltaContext = await this.ltaAgreementService.getLTAForPlanContext(
      tenantId,
      planContext,
      planId,
    );

    if (!ltaContext) {
      // [[T-291]] — LTA YOKLUĞU bir BİLİNMEYEN değil, BİLİNEN bir durumdur:
      // uygulanacak LTA oranı yoksa LTA harcaması gerçekten `0`'dır. Bu bir
      // sessiz varsayılan DEĞİL, çözülmüş bir değer.
      // ⛔ AMA `baseGsv`/`baseVolume`/`listPrice` LTA'DAN BAĞIMSIZ ve zaten
      // HESAPLANDI — onları da `0`'lamak bir BİLGİ KAYBIYDI (T-291 AC 2).
      return {
        baseLtaOnInvoiceSpend: 0,
        baseLtaOffInvoiceSpend: 0,
        plannedLtaOnInvoiceSpend: 0, // Will be calculated separately
        plannedLtaOffInvoiceSpend: 0, // Will be calculated separately
        baseGsv,
        plannedGsv: 0, // Will be calculated separately
        baseVolume,
        plannedVolume: 0, // Will be calculated separately
        listPrice,
      };
    }

    // Calculate Base LTA On-Invoice
    // Base GSV * On-Invoice % = Base LTA On-Invoice
    const baseLtaOnInvoiceSpend =
      (baseGsv * ltaContext.finalOnInvoicePct) / 100;

    // Calculate Base LTA Off-Invoice
    // (Base GSV - Base LTA On-Invoice) * Off-Invoice % = Base LTA Off-Invoice
    const baseLtaOffInvoiceSpend =
      ((baseGsv - baseLtaOnInvoiceSpend) * ltaContext.finalOffInvoicePct) / 100;

    return {
      baseLtaOnInvoiceSpend,
      baseLtaOffInvoiceSpend,
      plannedLtaOnInvoiceSpend: 0, // Will be calculated separately
      plannedLtaOffInvoiceSpend: 0, // Will be calculated separately
      baseGsv,
      plannedGsv: 0, // Will be calculated separately
      baseVolume,
      plannedVolume: 0, // Will be calculated separately
      listPrice,
    };
  }

  async calculatePlannedLTASpend(
    tenantId: string,
    planId: string,
    skuId: string,
    planContext: PlanContextDto,
  ): Promise<LTASpendBreakdown> {
    // Get plan SKU
    const planSku = await this.planSkuRepository
      .createQueryBuilder('planSku')
      .leftJoinAndSelect('planSku.sku', 'sku')
      .leftJoinAndSelect('planSku.planFu', 'planFu')
      .leftJoinAndSelect('planFu.plan', 'plan')
      .where('planSku.tenantId = :tenantId', { tenantId })
      .andWhere('planSku.skuId = :skuId', { skuId })
      .andWhere('plan.id = :planId', { planId })
      .getOne();

    if (!planSku) {
      throw new Error(
        `Plan SKU not found for planId: ${planId}, skuId: ${skuId}`,
      );
    }

    const sku = planSku.sku;
    const plannedVolume = requireFiniteNumber(
      planSku.plannedVolume,
      'plannedVolume',
      `plan_skus/${planSku.id}`,
    );
    const listPrice = requireFiniteNumber(
      sku.unitPrice,
      'unitPrice',
      `skus/${skuId}`,
    );

    // Calculate Planned GSV
    const plannedGsv = plannedVolume * listPrice;

    // Get LTA context (with planId for override check)
    const ltaContext = await this.ltaAgreementService.getLTAForPlanContext(
      tenantId,
      planContext,
      planId,
    );

    if (!ltaContext) {
      // [[T-291]] — yukarısıyla AYNI gerekçe (bkz. `calculateBaseLTASpend`):
      // LTA yokluğu çözülmüş bir `0`; `plannedGsv`/`plannedVolume`/
      // `listPrice` ise LTA'dan bağımsız ve zaten hesaplandı.
      return {
        baseLtaOnInvoiceSpend: 0, // Will be calculated separately
        baseLtaOffInvoiceSpend: 0, // Will be calculated separately
        plannedLtaOnInvoiceSpend: 0,
        plannedLtaOffInvoiceSpend: 0,
        baseGsv: 0, // Will be calculated separately
        plannedGsv,
        baseVolume: 0, // Will be calculated separately
        plannedVolume,
        listPrice,
      };
    }

    // Calculate Planned LTA On-Invoice
    // Planned GSV * On-Invoice % = Planned LTA On-Invoice
    const plannedLtaOnInvoiceSpend =
      (plannedGsv * ltaContext.finalOnInvoicePct) / 100;

    // Calculate Planned LTA Off-Invoice
    // (Planned GSV - Planned LTA On-Invoice) * Off-Invoice % = Planned LTA Off-Invoice
    const plannedLtaOffInvoiceSpend =
      ((plannedGsv - plannedLtaOnInvoiceSpend) *
        ltaContext.finalOffInvoicePct) /
      100;

    return {
      baseLtaOnInvoiceSpend: 0, // Will be calculated separately
      baseLtaOffInvoiceSpend: 0, // Will be calculated separately
      plannedLtaOnInvoiceSpend,
      plannedLtaOffInvoiceSpend,
      baseGsv: 0, // Will be calculated separately
      plannedGsv,
      baseVolume: 0, // Will be calculated separately
      plannedVolume,
      listPrice,
    };
  }

  async getLTAForPlanContext(
    tenantId: string,
    planContext: PlanContextDto,
  ): Promise<LTAContext | null> {
    return this.ltaAgreementService.getLTAForPlanContext(tenantId, planContext);
  }
}

/**
 * Mechanic Seed — Standart TPM Planlama Mekanikleri
 *
 * T-018: SpendCalc'in on/off-invoice ayrımını doğru yapabilmesi için
 * her mechanic'in spendingType, category ve mechanicType alanları dolu
 * olmalıdır. Bu seed Set A mekaniklerini + yaygın TPM mekaniklerini
 * idempotent upsert ile ekler.
 *
 * Upsert anahtarı: (tenantId, code) — unique index mechanic.entity'de tanımlı.
 * Değişen alanlar güncellenir; yeni satırlar eklenir; hiçbir şey silinmez.
 *
 * Bağımlılık: tacticler (agreement.seed içinde TAC-PROMO oluşturuluyor).
 * Bu seed agreement.seed'den ÖNCE çağrılır; tactic'leri de idempotent olarak
 * oluşturur.
 */
import { DataSource } from 'typeorm';
import { Tactic, TacticType } from '../entities/tactic.entity';
import {
  Mechanic,
  MechanicCategory,
  MechanicType,
  SpendingType,
  InputType,
  BudgetType,
  FormulaValidationStatus,
} from '../entities/mechanic.entity';

/** Tactic tanımları — her mechanic grubunun ait olduğu tactic. */
interface TacticDef {
  code: string;
  name: string;
  tacticType: TacticType;
  spendType: 'ON_INVOICE' | 'OFF_INVOICE' | 'BOTH';
}

const TACTICS: TacticDef[] = [
  {
    code: 'TAC-ON-DISCOUNT',
    name: 'On-Invoice Discount',
    tacticType: TacticType.DISCOUNT,
    spendType: 'ON_INVOICE',
  },
  {
    code: 'TAC-OFF-DISCOUNT',
    name: 'Off-Invoice Discount',
    tacticType: TacticType.DISCOUNT,
    spendType: 'OFF_INVOICE',
  },
  {
    code: 'TAC-VISIBILITY',
    name: 'Visibility & Display',
    tacticType: TacticType.LUMP_SUM,
    spendType: 'OFF_INVOICE',
  },
  {
    code: 'TAC-PRICE-SUPPORT',
    name: 'Price Support',
    tacticType: TacticType.OTHER,
    spendType: 'OFF_INVOICE',
  },
  // TAC-PROMO agreement.seed.ts tarafından da oluşturuluyor;
  // burada da tanımlıyoruz ki MEC-DISCOUNT bu seed'e taşınabilsin.
  {
    code: 'TAC-PROMO',
    name: 'Promotion',
    tacticType: TacticType.DISCOUNT,
    spendType: 'OFF_INVOICE',
  },
];

/** Mechanic tanım yapısı (tacticCode seed içi referans için). */
interface MechanicDef {
  code: string;
  name: string;
  description: string;
  tacticCode: string;
  mechanicType: MechanicType;
  spendingType: SpendingType;
  category: MechanicCategory;
  inputType: InputType;
  budgetType: BudgetType;
  unitSymbol?: string;
  minValue?: number;
  maxValue?: number;
  gridColumnOrder?: number;
  groupHeader?: string;
  /**
   * calculationFormula: SpendCalc döngüsünde mechanic.category tarafından
   * yönlendirilir; bu alan belge amaçlıdır ve admin UI'nda gösterilir.
   */
  calculationFormula?: string;
}

const MECHANICS: MechanicDef[] = [
  // ── ON-INVOICE ────────────────────────────────────────────────────────────
  {
    code: 'CPP_ON_PCT',
    name: 'CPP On-Invoice %',
    description:
      'Set A mekanik: on-invoice yüzde indirim. ' +
      'Spend = (PLANNED_GSV - PLANNED_LTA_ON) * CPP_ON_PCT / 100. ' +
      'BRD Set A referans değeri: %10.',
    tacticCode: 'TAC-ON-DISCOUNT',
    mechanicType: MechanicType.PERCENT,
    spendingType: SpendingType.ON_INVOICE,
    category: MechanicCategory.ON_INVOICE_DISCOUNT,
    inputType: InputType.PERCENTAGE,
    budgetType: BudgetType.ON_INVOICE,
    unitSymbol: '%',
    minValue: 0,
    maxValue: 100,
    gridColumnOrder: 10,
    groupHeader: 'On-Invoice Discounts',
    calculationFormula: '(PLANNED_GSV - PLANNED_LTA_ON) * entered_value / 100',
  },
  {
    code: 'MEC-DISCOUNT',
    name: 'Discount',
    description:
      'Genel on-invoice indirim mekanik (agreement seed ile uyumlu). ' +
      'Spend = (PLANNED_GSV - PLANNED_LTA_ON) * value / 100.',
    tacticCode: 'TAC-PROMO',
    mechanicType: MechanicType.PERCENT,
    spendingType: SpendingType.ON_INVOICE,
    category: MechanicCategory.ON_INVOICE_DISCOUNT,
    inputType: InputType.PERCENTAGE,
    budgetType: BudgetType.ON_INVOICE,
    unitSymbol: '%',
    minValue: 0,
    maxValue: 100,
    gridColumnOrder: 11,
    groupHeader: 'On-Invoice Discounts',
    calculationFormula: '(PLANNED_GSV - PLANNED_LTA_ON) * entered_value / 100',
  },
  // ── OFF-INVOICE: PERCENT (OFF_INVOICE_DISCOUNT) ───────────────────────────
  {
    code: 'CPP_OFF_PCT',
    name: 'CPP Off-Invoice %',
    description:
      'Off-invoice yüzde indirim. ' +
      'Spend = (PLANNED_GSV - PLANNED_LTA_ON - PLANNED_LTA_OFF - on_inv_promos) * value / 100.',
    tacticCode: 'TAC-OFF-DISCOUNT',
    mechanicType: MechanicType.PERCENT,
    spendingType: SpendingType.OFF_INVOICE,
    category: MechanicCategory.OFF_INVOICE_DISCOUNT,
    inputType: InputType.PERCENTAGE,
    budgetType: BudgetType.OFF_INVOICE,
    unitSymbol: '%',
    minValue: 0,
    maxValue: 100,
    gridColumnOrder: 20,
    groupHeader: 'Off-Invoice Discounts',
    calculationFormula:
      '(PLANNED_GSV - PLANNED_LTA_ON - PLANNED_LTA_OFF - total_on_inv_promos) * entered_value / 100',
  },
  // ── OFF-INVOICE: LUMPSUM ──────────────────────────────────────────────────
  {
    code: 'VIS_LS',
    name: 'Visibility Lump Sum',
    description:
      'Set A mekanik: görünürlük/teşhir lump-sum ödeme (off-invoice). ' +
      'Spend = entered_value (sabit tutar, FU seviyesinde girilir). ' +
      'BRD Set A referans değeri: 2000 TRY.',
    tacticCode: 'TAC-VISIBILITY',
    mechanicType: MechanicType.AMOUNT,
    spendingType: SpendingType.OFF_INVOICE,
    category: MechanicCategory.LUMPSUM_SPEND,
    inputType: InputType.CURRENCY,
    budgetType: BudgetType.OFF_INVOICE,
    unitSymbol: 'TRY',
    minValue: 0,
    gridColumnOrder: 30,
    groupHeader: 'Off-Invoice Lump Sum',
    calculationFormula: 'entered_value',
  },
  {
    code: 'DISPLAY_FEE',
    name: 'Display / Shelf Fee',
    description:
      'Teşhir / raf bedeli lump-sum (off-invoice). ' +
      'Spend = entered_value (sabit tutar, FU seviyesinde girilir).',
    tacticCode: 'TAC-VISIBILITY',
    mechanicType: MechanicType.AMOUNT,
    spendingType: SpendingType.OFF_INVOICE,
    category: MechanicCategory.LUMPSUM_SPEND,
    inputType: InputType.CURRENCY,
    budgetType: BudgetType.OFF_INVOICE,
    unitSymbol: 'TRY',
    minValue: 0,
    gridColumnOrder: 31,
    groupHeader: 'Off-Invoice Lump Sum',
    calculationFormula: 'entered_value',
  },
  // ── OFF-INVOICE: PER_UNIT_SUPPORT ─────────────────────────────────────────
  {
    code: 'PRICE_SUP',
    name: 'Price Support Per Unit',
    description:
      'Set A mekanik: birim başı fiyat desteği (off-invoice). ' +
      'Spend = entered_value * PLANNED_VOLUME. ' +
      'BRD Set A referans değeri: 0.25 TRY/birim.',
    tacticCode: 'TAC-PRICE-SUPPORT',
    mechanicType: MechanicType.AMOUNT_PER_UNIT,
    spendingType: SpendingType.OFF_INVOICE,
    category: MechanicCategory.PER_UNIT_SUPPORT,
    inputType: InputType.CURRENCY,
    budgetType: BudgetType.OFF_INVOICE,
    unitSymbol: 'TRY/unit',
    minValue: 0,
    gridColumnOrder: 40,
    groupHeader: 'Off-Invoice Per Unit',
    calculationFormula: 'entered_value * PLANNED_VOLUME',
  },
];

/** Idempotent upsert helper — duplicate key'e karşı güvenli. */
function isDuplicateError(error: any): boolean {
  return (
    error?.code === '23505' ||
    error?.driverError?.code === '23505' ||
    error?.driverError?.driverError?.code === '23505' ||
    (typeof error?.message === 'string' &&
      error.message.includes('duplicate key')) ||
    (typeof error?.driverError?.message === 'string' &&
      error.driverError.message.includes('duplicate key'))
  );
}

export async function seedMechanics(
  dataSource: DataSource,
  tenantId: string,
  createdByUserId: string,
): Promise<Mechanic[]> {
  const tacticRepo = dataSource.getRepository(Tactic);
  const mechanicRepo = dataSource.getRepository(Mechanic);

  // ── 1. Tactic'leri upsert et ──────────────────────────────────────────────
  const tacticMap = new Map<string, Tactic>();

  for (const def of TACTICS) {
    let tactic = await tacticRepo.findOne({
      where: { code: def.code, tenantId },
    });

    if (!tactic) {
      try {
        tactic = tacticRepo.create({
          code: def.code,
          name: def.name,
          tacticType: def.tacticType,
          spendType: def.spendType,
          tenantId,
          createdBy: createdByUserId,
        });
        tactic = await tacticRepo.save(tactic);
        console.log(`   [MECHANIC SEED] Tactic INSERT ${def.code}`);
      } catch (error) {
        if (isDuplicateError(error)) {
          tactic = await tacticRepo.findOne({
            where: { code: def.code, tenantId },
          });
          if (!tactic) throw error;
        } else {
          throw error;
        }
      }
    }

    tacticMap.set(def.code, tactic);
  }

  // ── 2. Mechanic'leri upsert et ────────────────────────────────────────────
  const upserted: Mechanic[] = [];

  for (const def of MECHANICS) {
    const tactic = tacticMap.get(def.tacticCode);
    if (!tactic) {
      throw new Error(
        `[MECHANIC SEED] Tactic bulunamadı: ${def.tacticCode} (mechanic: ${def.code})`,
      );
    }

    let mechanic = await mechanicRepo.findOne({
      where: { code: def.code, tenantId },
    });

    if (!mechanic) {
      try {
        mechanic = mechanicRepo.create({
          code: def.code,
          name: def.name,
          description: def.description,
          tacticId: tactic.id,
          mechanicType: def.mechanicType,
          spendingType: def.spendingType,
          category: def.category,
          inputType: def.inputType,
          budgetType: def.budgetType,
          unitSymbol: def.unitSymbol,
          minValue: def.minValue,
          maxValue: def.maxValue,
          calculationFormula: def.calculationFormula,
          gridColumnOrder: def.gridColumnOrder,
          groupHeader: def.groupHeader,
          formulaValidationStatus: FormulaValidationStatus.VALID,
          isActive: true,
          showInGrid: true,
          trackAgainstBudget: true,
          tenantId,
          createdBy: createdByUserId,
        });
        mechanic = await mechanicRepo.save(mechanic);
        console.log(`   [MECHANIC SEED] Mechanic INSERT ${def.code}`);
        upserted.push(mechanic);
      } catch (error) {
        if (isDuplicateError(error)) {
          mechanic = await mechanicRepo.findOne({
            where: { code: def.code, tenantId },
          });
          if (!mechanic) throw error;
          // Race condition — devam et, patch mantığına gir
        } else {
          throw error;
        }
      }
    }

    // Patch: spendingType veya category NULL ise ya da değer yanlışsa güncelle.
    // (Backfill migration DB'de düzeltiyor; bu seed uygulama seviyesi güvencesidir.)
    if (mechanic) {
      const needsUpdate =
        mechanic.spendingType !== def.spendingType ||
        mechanic.category !== def.category ||
        mechanic.mechanicType !== def.mechanicType ||
        !mechanic.budgetType;

      if (needsUpdate) {
        mechanic.spendingType = def.spendingType;
        mechanic.category = def.category;
        mechanic.mechanicType = def.mechanicType;
        mechanic.budgetType = def.budgetType;
        // calculationFormula'yı da düzelt (boşsa)
        if (!mechanic.calculationFormula && def.calculationFormula) {
          mechanic.calculationFormula = def.calculationFormula;
        }
        mechanic = await mechanicRepo.save(mechanic);
        console.log(
          `   [MECHANIC SEED] Mechanic UPSERT ${def.code} (classification updated)`,
        );
        upserted.push(mechanic);
      }
    }
  }

  console.log(
    `   Mechanics: ${upserted.length} inserted/updated (total seed definitions: ${MECHANICS.length})`,
  );
  return upserted;
}

import { DataSource } from 'typeorm';
import {
  Agreement,
  AgreementStatus,
  AgreementType,
  SpendType,
} from '../entities/agreement.entity';
import { Channel } from '../entities/channel.entity';
import { Brand } from '../entities/brand.entity';
import { Category } from '../entities/category.entity';
import { GenericUnit } from '../entities/generic-unit.entity';
import { ForecastingUnit } from '../entities/forecasting-unit.entity';
import { Tactic, TacticType } from '../entities/tactic.entity';
import {
  Mechanic,
  MechanicType,
  MechanicCategory,
  SpendingType,
} from '../entities/mechanic.entity';
import { Sku } from '../entities/sku.entity';

export async function seedAgreements(
  dataSource: DataSource,
  tenantId: string,
  cplId: string,
  createdByUserId: string,
): Promise<Agreement[]> {
  const repo = dataSource.getRepository(Agreement);
  const channelRepo = dataSource.getRepository(Channel);
  const brandRepo = dataSource.getRepository(Brand);
  const categoryRepo = dataSource.getRepository(Category);
  const guRepo = dataSource.getRepository(GenericUnit);
  const fuRepo = dataSource.getRepository(ForecastingUnit);
  const tacticRepo = dataSource.getRepository(Tactic);
  const mechanicRepo = dataSource.getRepository(Mechanic);

  // Get channel IDs by code (or use placeholder if channels don't exist)
  const nkaChannel = await channelRepo.findOne({
    where: { code: 'NKA', tenantId },
  });
  const traditionalChannel = await channelRepo.findOne({
    where: { code: 'TRADITIONAL_TRADE', tenantId },
  });

  // Use placeholder UUIDs if channels don't exist (for development)
  const nkaChannelId = nkaChannel?.id || '00000000-0000-0000-0000-000000000001';
  const traditionalChannelId =
    traditionalChannel?.id || '00000000-0000-0000-0000-000000000002';

  // Helper function to check if error is a duplicate key error
  const isDuplicateError = (error: any): boolean => {
    return (
      error?.code === '23505' ||
      error?.driverError?.code === '23505' ||
      error?.driverError?.driverError?.code === '23505' ||
      (error?.message && error.message.includes('duplicate key')) ||
      (error?.driverError?.message &&
        error.driverError.message.includes('duplicate key'))
    );
  };

  // Create or get Brand
  let brand = await brandRepo.findOne({ where: { code: 'WELLA', tenantId } });
  if (!brand) {
    try {
      brand = brandRepo.create({
        code: 'WELLA',
        name: 'Wella',
        tenantId,
        createdBy: createdByUserId,
      });
      brand = await brandRepo.save(brand);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        brand = await brandRepo.findOne({ where: { code: 'WELLA', tenantId } });
        if (!brand) throw error;
      } else {
        throw error;
      }
    }
  }

  // Create or get Category
  let category = await categoryRepo.findOne({
    where: { code: 'HAIR_CARE', tenantId },
  });
  if (!category) {
    try {
      category = categoryRepo.create({
        code: 'HAIR_CARE',
        name: 'Hair Care',
        tenantId,
        createdBy: createdByUserId,
      });
      category = await categoryRepo.save(category);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        category = await categoryRepo.findOne({
          where: { code: 'HAIR_CARE', tenantId },
        });
        if (!category) throw error;
      } else {
        throw error;
      }
    }
  }

  // Create or get Generic Unit
  let gu = await guRepo.findOne({
    where: { code: 'GU-WELLA-HC-001', tenantId },
  });
  if (!gu) {
    try {
      gu = guRepo.create({
        code: 'GU-WELLA-HC-001',
        name: 'Wella Hair Care Generic Unit',
        brandId: brand.id,
        categoryId: category.id,
        tenantId,
        createdBy: createdByUserId,
      });
      gu = await guRepo.save(gu);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        gu = await guRepo.findOne({
          where: { code: 'GU-WELLA-HC-001', tenantId },
        });
        if (!gu) throw error;
      } else {
        throw error;
      }
    }
  }

  // Create or get Forecasting Unit
  let fu = await fuRepo.findOne({
    where: { code: 'FU-WELLA-HC-500ML', tenantId },
  });
  if (!fu) {
    try {
      fu = fuRepo.create({
        code: 'FU-WELLA-HC-500ML',
        name: 'Wella Hair Care 500ml',
        guId: gu.id,
        size: '500ml',
        segment: 'Premium',
        currency: 'TRY',
        tenantId,
        createdBy: createdByUserId,
      });
      fu = await fuRepo.save(fu);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        // Try to find it again (might have been created by another process)
        fu = await fuRepo.findOne({
          where: { code: 'FU-WELLA-HC-500ML', tenantId },
        });
        if (!fu) {
          throw error; // Re-throw if still not found
        }
        // Successfully found, continue
      } else {
        throw error; // Re-throw other errors
      }
    }
  }

  // T-027: synthetic e2e-only SKU with explicit COGS/unitPrice, attached to
  // this fixture FU (FU-WELLA-HC-500ML is a test-only FU, not part of the
  // real Product.xlsx-derived Wella catalog — see product.seed.ts). Real
  // Wella SKUs are intentionally left without COGS (source data doesn't have
  // it; BRD forbids inventing master data), so a "COGS present → real ROI"
  // path needs a dedicated synthetic fixture. Used by
  // test/role-journey.e2e-spec.ts (A5c) to prove the positive path alongside
  // A5's "COGS missing → null ROI" defect-fix proof.
  const skuRepo = dataSource.getRepository(Sku);
  let cogsFixtureSku = await skuRepo.findOne({
    where: { code: 'SKU-E2E-COGS-FIXTURE', tenantId },
  });
  if (!cogsFixtureSku) {
    try {
      cogsFixtureSku = skuRepo.create({
        code: 'SKU-E2E-COGS-FIXTURE',
        name: 'E2E COGS Fixture SKU (Wella HC 500ml)',
        guId: gu.id,
        fuId: fu.id,
        size: '500ml',
        unitPrice: 100,
        cogs: 60,
        currency: 'TRY',
        tenantId,
        createdBy: createdByUserId,
      });
      cogsFixtureSku = await skuRepo.save(cogsFixtureSku);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        cogsFixtureSku = await skuRepo.findOne({
          where: { code: 'SKU-E2E-COGS-FIXTURE', tenantId },
        });
        if (!cogsFixtureSku) throw error;
      } else {
        throw error;
      }
    }
  } else if (cogsFixtureSku.cogs == null || cogsFixtureSku.unitPrice == null) {
    // Backfill if a prior seed run created it without COGS/price.
    cogsFixtureSku.unitPrice = 100;
    cogsFixtureSku.cogs = 60;
    cogsFixtureSku = await skuRepo.save(cogsFixtureSku);
  }

  // T-062: two additional synthetic e2e-only SKUs on the SAME fixture FU
  // (FU-WELLA-HC-500ML), needed to test LUMPSUM_SPEND base-volume-
  // proportional distribution across >1 SKU (SKU-E2E-COGS-FIXTURE alone
  // is not enough — a single-SKU FU always gets 100% of any lumpsum,
  // which cannot distinguish "distributed proportionally" from "not
  // distributed at all"). PlanSku.baseVolume/plannedVolume are set per
  // PLAN (via PATCH .../skus/:skuId/volume), not on the master Sku row,
  // so these rows are safe to reuse across unrelated e2e plans.
  const lumpsumFixtureSkuDefs = [
    {
      code: 'SKU-E2E-LUMPSUM-A',
      name: 'E2E Lumpsum Fixture SKU A (Wella HC 500ml)',
    },
    {
      code: 'SKU-E2E-LUMPSUM-B',
      name: 'E2E Lumpsum Fixture SKU B (Wella HC 500ml)',
    },
  ];
  for (const def of lumpsumFixtureSkuDefs) {
    let lumpsumSku = await skuRepo.findOne({
      where: { code: def.code, tenantId },
    });
    if (!lumpsumSku) {
      try {
        lumpsumSku = skuRepo.create({
          code: def.code,
          name: def.name,
          guId: gu.id,
          fuId: fu.id,
          size: '500ml',
          unitPrice: 100,
          cogs: 60,
          currency: 'TRY',
          tenantId,
          createdBy: createdByUserId,
        });
        lumpsumSku = await skuRepo.save(lumpsumSku);
      } catch (error: any) {
        if (isDuplicateError(error)) {
          lumpsumSku = await skuRepo.findOne({
            where: { code: def.code, tenantId },
          });
          if (!lumpsumSku) throw error;
        } else {
          throw error;
        }
      }
    }
  }

  // T-113: dedicated single-SKU FU for grid e2e fixtures. FU-WELLA-HC-500ML
  // (above) is shared by multiple unrelated e2e fixtures (SKU-E2E-COGS-FIXTURE
  // and the T-062 lumpsum pair), so its SKU count is no longer 1 and can't be
  // relied on by any test that needs "exactly one SKU on this FU". The name
  // deliberately encodes ownership + the invariant it protects, so nobody
  // extends this FU without reading why.
  //
  // OWNERSHIP CONTRACT: this FU must have EXACTLY ONE SKU
  // (SKU-E2E-GRID-SINGLE-SKU, created right below). Adding a second SKU here
  // breaks collmind.frontend/tests/e2e/support/api.ts's
  // createDraftPlanWithSingleSkuFu (which asserts skus.length === 1), and
  // through it collmind.frontend/tests/e2e/04-grid-cell-kpi.spec.ts and
  // collmind.frontend/tests/e2e/02-version-conflict.spec.ts. If you need a
  // multi-SKU fixture, create a NEW FU — do not add SKUs here.
  let e2eGridFu = await fuRepo.findOne({
    where: { code: 'FU-E2E-GRID-SINGLE-SKU', tenantId },
  });
  if (!e2eGridFu) {
    try {
      e2eGridFu = fuRepo.create({
        code: 'FU-E2E-GRID-SINGLE-SKU',
        name: 'E2E Grid Fixture FU (single SKU)',
        guId: gu.id,
        size: '500ml',
        segment: 'Premium',
        currency: 'TRY',
        tenantId,
        createdBy: createdByUserId,
      });
      e2eGridFu = await fuRepo.save(e2eGridFu);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        e2eGridFu = await fuRepo.findOne({
          where: { code: 'FU-E2E-GRID-SINGLE-SKU', tenantId },
        });
        if (!e2eGridFu) throw error;
      } else {
        throw error;
      }
    }
  }

  let e2eGridSku = await skuRepo.findOne({
    where: { code: 'SKU-E2E-GRID-SINGLE-SKU', tenantId },
  });
  if (!e2eGridSku) {
    try {
      e2eGridSku = skuRepo.create({
        code: 'SKU-E2E-GRID-SINGLE-SKU',
        name: 'E2E Grid Fixture SKU (Wella HC 500ml)',
        guId: gu.id,
        fuId: e2eGridFu.id,
        size: '500ml',
        // LOAD-BEARING: collmind.frontend/tests/e2e/05-grid-column-alignment.spec.ts
        // asserts these exact values render in the correct grid columns —
        // unitPrice as ₺100 in "List Price per Piece" (toContainText('₺100'))
        // and cogs as ₺60 in "COGS per Piece" (toContainText('₺60')), plus
        // negative assertions that neither value leaks into the volume
        // columns (not.toContainText('₺100') / not.toContainText('₺60')).
        // Line numbers deliberately omitted — they drift with formatting;
        // grep the assertion text above instead. Changing either number
        // here silently changes what that test proves.
        unitPrice: 100,
        cogs: 60,
        currency: 'TRY',
        tenantId,
        createdBy: createdByUserId,
      });
      e2eGridSku = await skuRepo.save(e2eGridSku);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        e2eGridSku = await skuRepo.findOne({
          where: { code: 'SKU-E2E-GRID-SINGLE-SKU', tenantId },
        });
        if (!e2eGridSku) throw error;
      } else {
        throw error;
      }
    }
  }

  // Create or get Tactic
  let tactic = await tacticRepo.findOne({
    where: { code: 'TAC-PROMO', tenantId },
  });
  if (!tactic) {
    try {
      tactic = tacticRepo.create({
        code: 'TAC-PROMO',
        name: 'Promotion',
        tacticType: TacticType.DISCOUNT,
        spendType: 'OFF_INVOICE',
        tenantId,
        createdBy: createdByUserId,
      });
      tactic = await tacticRepo.save(tactic);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        tactic = await tacticRepo.findOne({
          where: { code: 'TAC-PROMO', tenantId },
        });
        if (!tactic) throw error;
      } else {
        throw error;
      }
    }
  }

  // Create or get Mechanic
  // T-017: category + spendingType MUST be populated so SpendCalculationService
  // can classify on/off-invoice correctly (no string-hack fallback).
  let mechanic = await mechanicRepo.findOne({
    where: { code: 'MEC-DISCOUNT', tenantId },
  });
  if (!mechanic) {
    try {
      mechanic = mechanicRepo.create({
        code: 'MEC-DISCOUNT',
        name: 'Discount',
        tacticId: tactic.id,
        mechanicType: MechanicType.PERCENT,
        category: MechanicCategory.ON_INVOICE_DISCOUNT,
        spendingType: SpendingType.ON_INVOICE,
        tenantId,
        createdBy: createdByUserId,
      });
      mechanic = await mechanicRepo.save(mechanic);
    } catch (error: any) {
      if (isDuplicateError(error)) {
        mechanic = await mechanicRepo.findOne({
          where: { code: 'MEC-DISCOUNT', tenantId },
        });
        if (!mechanic) throw error;
      } else {
        throw error;
      }
    }
  } else if (!mechanic.category || !mechanic.spendingType) {
    // Patch existing seed mechanic that was created without classification (T-017).
    mechanic.category = MechanicCategory.ON_INVOICE_DISCOUNT;
    mechanic.spendingType = SpendingType.ON_INVOICE;
    mechanic = await mechanicRepo.save(mechanic);
  }

  // Agreement 1: DRAFT (ready to submit)
  const draftAgreement = {
    tenantId,
    agreementCode: 'STA-2026-0001',
    agreementName: 'Wella NKA Migros Ocak Promosyon',
    agreementType: AgreementType.STA,
    cplId,
    channelId: nkaChannelId,
    fuId: fu.id,
    tacticId: tactic.id,
    mechanicId: mechanic.id,
    skuScope: 'FU',
    capTotalAmount: 50000,
    spendType: SpendType.OFF_INVOICE,
    startDate: new Date('2026-01-15'),
    endDate: new Date('2026-01-31'),
    periodMonth: '2026-01',
    justification: 'Ocak ayı için Migros ile yapılan promosyon anlaşması',
    status: AgreementStatus.DRAFT,
    currency: 'TRY',
    createdBy: createdByUserId,
  };

  // Agreement 2: APPROVED (ready for transactions)
  const approvedAgreement = {
    tenantId,
    agreementCode: 'STA-2026-0002',
    agreementName: 'Wella NKA CarrefourSA Şubat Promosyon',
    agreementType: AgreementType.STA,
    cplId,
    channelId: nkaChannelId,
    fuId: fu.id,
    tacticId: tactic.id,
    mechanicId: mechanic.id,
    skuScope: 'FU',
    capTotalAmount: 75000,
    spendType: SpendType.OFF_INVOICE,
    startDate: new Date('2026-02-01'),
    endDate: new Date('2026-02-28'),
    periodMonth: '2026-02',
    justification: 'Şubat ayı CarrefourSA promosyon anlaşması',
    status: AgreementStatus.APPROVED,
    approvedAt: new Date(),
    approvedById: createdByUserId,
    currency: 'TRY',
    createdBy: createdByUserId,
  };

  // Agreement 3: LTA example
  const ltaAgreement = {
    tenantId,
    agreementCode: 'LTA-2026-0001',
    agreementName: 'Wella Traditional Trade Q1 2026',
    agreementType: AgreementType.LTA,
    cplId,
    channelId: traditionalChannelId,
    fuId: fu.id,
    tacticId: tactic.id,
    mechanicId: mechanic.id,
    skuScope: 'FU',
    capTotalAmount: 150000,
    spendType: SpendType.OFF_INVOICE,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-03-31'),
    periodMonth: '2026-01',
    justification: 'Q1 2026 geleneksel kanal yıllık anlaşma',
    status: AgreementStatus.DRAFT,
    currency: 'TRY',
    createdBy: createdByUserId,
  };

  const agreements = [draftAgreement, approvedAgreement, ltaAgreement];
  const created: Agreement[] = [];

  for (const agreement of agreements) {
    const existing = await repo.findOne({
      where: { agreementCode: agreement.agreementCode, tenantId },
    });
    if (!existing) {
      const entity = repo.create(agreement);
      created.push(await repo.save(entity));
    } else {
      created.push(existing);
    }
  }

  console.log(`✅ Seeded ${created.length} agreements`);
  return created;
}

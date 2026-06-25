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

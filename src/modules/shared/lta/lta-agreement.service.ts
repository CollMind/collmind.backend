import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LTAAgreementRepository } from './lta-agreement.repository';
import {
  LTAAgreement,
  LTAAgreementStatus,
} from '../../../database/entities/lta-agreement.entity';
import { LTARate } from '../../../database/entities/lta-rate.entity';
import {
  Agreement,
  AgreementType,
} from '../../../database/entities/agreement.entity';
import { CreateLTAAgreementDto } from './dto/create-lta-agreement.dto';
import { UpdateLTAAgreementDto } from './dto/update-lta-agreement.dto';
import { CplService } from '../../master-data/cpl/cpl.service';
import { PlanContextDto } from '../../master-data/mechanic/dto/plan-context.dto';
import { LTAContext } from './dto/lta-context.dto';

@Injectable()
export class LTAAgreementService {
  constructor(
    private readonly ltaRepository: LTAAgreementRepository,
    @InjectRepository(LTARate)
    private readonly ltaRateRepository: Repository<LTARate>,
    // [[T-293]] — yaşam döngüsü kaydının DOĞRULANMASI için. Yalnız okuma;
    // `agreements` üzerindeki yazma/onay akışı bu modülün işi DEĞİL
    // (`Z38 §3`: devir REDDEDİLDİ, bağ kuruldu).
    @InjectRepository(Agreement)
    private readonly agreementRepository: Repository<Agreement>,
    private readonly cplService: CplService,
  ) {}

  async createAgreement(
    tenantId: string,
    dto: CreateLTAAgreementDto,
  ): Promise<LTAAgreement> {
    // Validate CPL exists
    await this.cplService.findOne(tenantId, dto.cplId);

    // ── [[T-293]] / `Z38 §3(a)` — YAŞAM DÖNGÜSÜ BAĞI ────────────────────
    // Oran şartları bir `main.agreements` (agreement_type=LTA) kaydına
    // BAĞLI DOĞAR. Üç ayrı kontrol, üçü de AÇIK HATA (§2.5: sessiz
    // varsayılan / sessiz atlama yok):
    //   1. ebeveyn var mı (tenant kapsamında)
    //   2. ebeveyn gerçekten LTA mı  — STA bir yaşam döngüsü kaydına LTA
    //      oran kademesi bağlanamaz
    //   3. `cplId` ebeveyninkiyle aynı mı — iki temsil AYRIŞMAZ (`İlke 4`);
    //      uyuşmazlık SESSİZCE ebeveyninkiyle DEĞİŞTİRİLMEZ, REDDEDİLİR
    const parent = await this.agreementRepository.findOne({
      where: { id: dto.agreementId, tenantId },
    });
    if (!parent) {
      throw new NotFoundException(
        `Yaşam döngüsü kaydı bulunamadı: agreements/${dto.agreementId}`,
      );
    }
    if (parent.agreementType !== AgreementType.LTA) {
      throw new BadRequestException(
        `Yaşam döngüsü kaydı ${parent.agreementCode} tipi ` +
          `'${parent.agreementType}' — LTA oran şartları yalnız ` +
          `agreement_type='LTA' bir kayda bağlanabilir (Z38 §3(a)).`,
      );
    }
    if (parent.cplId !== dto.cplId) {
      throw new BadRequestException(
        `cplId uyuşmazlığı: yaşam döngüsü kaydı ${parent.agreementCode} ` +
          `CPL ${parent.cplId} için, gönderilen ${dto.cplId}. Sessizce ` +
          `düzeltilmez (§2.5) — aynı olgunun iki temsili ayrışamaz.`,
      );
    }
    const alreadyBound = await this.ltaRateRepository.manager.findOne(
      LTAAgreement,
      { where: { tenantId, agreementId: dto.agreementId } },
    );
    if (alreadyBound) {
      throw new ConflictException(
        `Yaşam döngüsü kaydı ${parent.agreementCode} zaten bir oran-şartları ` +
          `başlığı taşıyor (${alreadyBound.agreementCode}). Bir kaydın EN ÇOK ` +
          `BİR oran-şartları başlığı olur (UQ_lta_agreements_agreement_id).`,
      );
    }

    // Validate code uniqueness
    const existing = await this.ltaRepository.findByCode(
      tenantId,
      dto.agreementCode,
    );
    if (existing) {
      throw new ConflictException(
        `LTA Agreement with code '${dto.agreementCode}' already exists`,
      );
    }

    // Validate dates
    const effectiveDate = new Date(dto.effectiveDate);
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : undefined;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (effectiveDate < today) {
      throw new BadRequestException(
        'Effective date must be today or in the future',
      );
    }

    if (expiryDate && expiryDate <= effectiveDate) {
      throw new BadRequestException('Expiry date must be after effective date');
    }

    // Validate no overlapping agreements
    const hasOverlap = await this.validateNoOverlappingAgreements(
      tenantId,
      dto.cplId,
      effectiveDate,
      expiryDate || null,
    );
    if (!hasOverlap) {
      throw new ConflictException(
        'An active LTA agreement already exists for this CPL in the specified date range',
      );
    }

    // Validate rates
    this.validateRates(dto.rates);

    // Create agreement
    const agreement = this.ltaRepository.create({
      tenantId,
      agreementId: dto.agreementId,
      cplId: dto.cplId,
      agreementName: dto.agreementName,
      agreementCode: dto.agreementCode,
      effectiveDate,
      expiryDate,
      status: LTAAgreementStatus.DRAFT,
      totalAgreementValue: dto.totalAgreementValue,
      notes: dto.notes,
    });

    const savedAgreement = await this.ltaRepository.save(agreement);

    // Create rates
    const rates = dto.rates.map((rateDto) => {
      // If channel is "ALL", set channelId to null
      const channelId =
        rateDto.channel === 'ALL' ? undefined : rateDto.channelId;
      // If category is "ALL", set categoryId to null
      const categoryId =
        rateDto.category === 'ALL' ? undefined : rateDto.categoryId;

      return this.ltaRateRepository.create({
        tenantId,
        ltaAgreementId: savedAgreement.id,
        channelId,
        channel: rateDto.channel,
        categoryId,
        category: rateDto.category,
        onInvoicePercentage: rateDto.onInvoicePercentage,
        offInvoicePercentage: rateDto.offInvoicePercentage,
        minimumVolumeCommitment: rateDto.minimumVolumeCommitment,
        maximumDiscountCap: rateDto.maximumDiscountCap,
        paymentTerms: rateDto.paymentTerms,
        isActive: rateDto.isActive ?? true,
      });
    });

    await this.ltaRateRepository.save(rates);

    return this.ltaRepository.findById(
      tenantId,
      savedAgreement.id,
    ) as Promise<LTAAgreement>;
  }

  async updateAgreement(
    tenantId: string,
    id: string,
    dto: UpdateLTAAgreementDto,
  ): Promise<LTAAgreement> {
    const agreement = await this.ltaRepository.findById(tenantId, id);
    if (!agreement) {
      throw new NotFoundException(`LTA Agreement with ID ${id} not found`);
    }

    // [[T-293]] — KİMLİK ALANLARI PATCH ile DEĞİŞTİRİLEMEZ.
    //
    // `UpdateLTAAgreementDto = PartialType(CreateLTAAgreementDto)` ⇒ hem
    // `agreementId` hem `cplId` şema düzeyinde KABUL edilir, ama aşağıdaki
    // `Object.assign` ikisini de UYGULAMAZ. Sessizce yok saymak `§2.5`'in
    // *"if yazıp else bırakmamak"* dalıdır — ve `cplId` için bu, yaratımda
    // `400` ile korunan invaryantın (`parent.cplId === dto.cplId`) PATCH
    // KAÇIŞ DELİĞİ olurdu: çağıran gönderdiğini uygulanmış sanır.
    // ⇒ İkisi de AÇIKÇA reddedilir.
    if (dto.agreementId && dto.agreementId !== agreement.agreementId) {
      throw new BadRequestException(
        'Yaşam döngüsü bağı (agreementId) güncellenemez. Bağı değiştirmek ' +
          'yerine oran-şartları başlığı sonlandırılır ve yenisi doğru ' +
          'yaşam döngüsü kaydına bağlı yaratılır.',
      );
    }
    if (dto.cplId && dto.cplId !== agreement.cplId) {
      throw new BadRequestException(
        'cplId güncellenemez: oran şartlarının CPL’i, bağlı olduğu yaşam ' +
          'döngüsü kaydının (agreements) CPL’inden gelir ve ondan ' +
          'ayrışamaz (İlke 4). Sessizce yok sayılmaz (§2.5).',
      );
    }

    // Cannot update expired agreements
    if (agreement.status === LTAAgreementStatus.EXPIRED) {
      throw new BadRequestException('Cannot update expired agreements');
    }

    // Cannot change date range for active agreements
    if (agreement.status === LTAAgreementStatus.ACTIVE) {
      if (dto.effectiveDate || dto.expiryDate) {
        throw new BadRequestException(
          'Cannot change date range for active agreements. Terminate and create a new one.',
        );
      }
    }

    // Validate code uniqueness if changed
    if (dto.agreementCode && dto.agreementCode !== agreement.agreementCode) {
      const existing = await this.ltaRepository.findByCode(
        tenantId,
        dto.agreementCode,
      );
      if (existing) {
        throw new ConflictException(
          `LTA Agreement with code '${dto.agreementCode}' already exists`,
        );
      }
    }

    // Validate dates if changed
    if (dto.effectiveDate || dto.expiryDate) {
      const effectiveDate = dto.effectiveDate
        ? new Date(dto.effectiveDate)
        : agreement.effectiveDate;
      const expiryDate = dto.expiryDate
        ? new Date(dto.expiryDate)
        : agreement.expiryDate;

      if (expiryDate && expiryDate <= effectiveDate) {
        throw new BadRequestException(
          'Expiry date must be after effective date',
        );
      }

      // Validate no overlapping agreements
      const hasOverlap = await this.validateNoOverlappingAgreements(
        tenantId,
        agreement.cplId,
        effectiveDate,
        expiryDate || null,
        id,
      );
      if (!hasOverlap) {
        throw new ConflictException(
          'An active LTA agreement already exists for this CPL in the specified date range',
        );
      }
    }

    // Update agreement
    Object.assign(agreement, {
      agreementName: dto.agreementName ?? agreement.agreementName,
      agreementCode: dto.agreementCode ?? agreement.agreementCode,
      effectiveDate: dto.effectiveDate
        ? new Date(dto.effectiveDate)
        : agreement.effectiveDate,
      expiryDate: dto.expiryDate
        ? new Date(dto.expiryDate)
        : agreement.expiryDate,
      totalAgreementValue:
        dto.totalAgreementValue ?? agreement.totalAgreementValue,
      notes: dto.notes ?? agreement.notes,
    });

    // Update rates if provided
    if (dto.rates) {
      this.validateRates(dto.rates);
      // Delete existing rates
      await this.ltaRateRepository.delete({ ltaAgreementId: id });
      // Create new rates
      const rates = dto.rates.map((rateDto) => {
        // If channel is "ALL", set channelId to null
        const channelId =
          rateDto.channel === 'ALL' ? undefined : rateDto.channelId;
        // If category is "ALL", set categoryId to null
        const categoryId =
          rateDto.category === 'ALL' ? undefined : rateDto.categoryId;

        return this.ltaRateRepository.create({
          tenantId,
          ltaAgreementId: id,
          channelId,
          channel: rateDto.channel,
          categoryId,
          category: rateDto.category,
          onInvoicePercentage: rateDto.onInvoicePercentage,
          offInvoicePercentage: rateDto.offInvoicePercentage,
          minimumVolumeCommitment: rateDto.minimumVolumeCommitment,
          maximumDiscountCap: rateDto.maximumDiscountCap,
          paymentTerms: rateDto.paymentTerms,
          isActive: rateDto.isActive ?? true,
        });
      });
      await this.ltaRateRepository.save(rates);
    }

    return this.ltaRepository.save(agreement);
  }

  async activateAgreement(tenantId: string, id: string): Promise<void> {
    const agreement = await this.ltaRepository.findById(tenantId, id);
    if (!agreement) {
      throw new NotFoundException(`LTA Agreement with ID ${id} not found`);
    }

    if (agreement.status !== LTAAgreementStatus.DRAFT) {
      throw new BadRequestException('Only draft agreements can be activated');
    }

    // Check for overlapping active agreements
    const hasOverlap = await this.validateNoOverlappingAgreements(
      tenantId,
      agreement.cplId,
      agreement.effectiveDate,
      agreement.expiryDate || null,
      id,
    );
    if (!hasOverlap) {
      throw new ConflictException(
        'An active LTA agreement already exists for this CPL in the specified date range',
      );
    }

    agreement.status = LTAAgreementStatus.ACTIVE;
    await this.ltaRepository.save(agreement);
  }

  async terminateAgreement(
    tenantId: string,
    id: string,
    reason: string,
  ): Promise<void> {
    const agreement = await this.ltaRepository.findById(tenantId, id);
    if (!agreement) {
      throw new NotFoundException(`LTA Agreement with ID ${id} not found`);
    }

    if (agreement.status === LTAAgreementStatus.TERMINATED) {
      throw new BadRequestException('Agreement is already terminated');
    }

    agreement.status = LTAAgreementStatus.TERMINATED;
    agreement.notes = agreement.notes
      ? `${agreement.notes}\n\nTerminated: ${reason}`
      : `Terminated: ${reason}`;
    await this.ltaRepository.save(agreement);
  }

  async getActiveAgreementForCPL(
    tenantId: string,
    cplId: string,
    date: Date = new Date(),
  ): Promise<LTAAgreement | null> {
    return this.ltaRepository.findActiveForCPL(tenantId, cplId, date);
  }

  async getRatesForContext(
    tenantId: string,
    cplId: string,
    channel: string,
    category: string,
    date: Date = new Date(),
  ): Promise<LTARate | null> {
    const agreement = await this.getActiveAgreementForCPL(
      tenantId,
      cplId,
      date,
    );
    return this.findRateInAgreement(agreement, channel, category);
  }

  /**
   * Matches a rate within an already-fetched agreement. Extracted so callers
   * that already hold the agreement (e.g. `getLTAForPlanContext`) don't have
   * to re-fetch it from the DB just to find the applicable rate
   * (T-045: eliminates a duplicate `findActiveForCPL` round-trip per call).
   */
  private findRateInAgreement(
    agreement: LTAAgreement | null,
    channel: string,
    category: string,
  ): LTARate | null {
    if (!agreement || !agreement.rates || agreement.rates.length === 0) {
      return null;
    }

    // Find matching rate - prioritize specific matches over "ALL"
    // First try exact match
    let rate = agreement.rates.find((r) => {
      const channelMatch = r.channel === channel;
      const categoryMatch = r.category === category;
      return channelMatch && categoryMatch && r.isActive;
    });

    // If no exact match, try channel match with ALL category
    if (!rate) {
      rate = agreement.rates.find((r) => {
        const channelMatch = r.channel === channel;
        const categoryMatch = r.category === 'ALL';
        return channelMatch && categoryMatch && r.isActive;
      });
    }

    // If still no match, try ALL channel with category match
    if (!rate) {
      rate = agreement.rates.find((r) => {
        const channelMatch = r.channel === 'ALL';
        const categoryMatch = r.category === category;
        return channelMatch && categoryMatch && r.isActive;
      });
    }

    // Last resort: ALL channel and ALL category
    if (!rate) {
      rate = agreement.rates.find((r) => {
        const channelMatch = r.channel === 'ALL';
        const categoryMatch = r.category === 'ALL';
        return channelMatch && categoryMatch && r.isActive;
      });
    }

    return rate || null;
  }

  async validateNoOverlappingAgreements(
    tenantId: string,
    cplId: string,
    effectiveDate: Date,
    expiryDate: Date | null,
    excludeId?: string,
  ): Promise<boolean> {
    const overlapping = await this.ltaRepository.findOverlappingAgreements(
      tenantId,
      cplId,
      effectiveDate,
      expiryDate,
      excludeId,
    );
    return overlapping.length === 0;
  }

  async getLTAForPlanContext(
    tenantId: string,
    planContext: PlanContextDto,
    planId?: string,
  ): Promise<LTAContext | null> {
    if (!planContext.cplId) {
      return null;
    }

    const date = new Date(); // Use plan's date if available, otherwise current date
    const agreement = await this.getActiveAgreementForCPL(
      tenantId,
      planContext.cplId,
      date,
    );
    if (!agreement || !agreement.rates) {
      return null;
    }

    const channel = planContext.channelCode || planContext.channelId || '';
    const category = planContext.categoryCode || planContext.categoryId || '';

    // T-045: reuse the agreement already fetched above instead of calling
    // getRatesForContext (which would re-fetch the identical agreement).
    const rate = this.findRateInAgreement(agreement, channel, category);
    if (!rate) {
      return null;
    }

    // Check for override if planId is provided
    let overrideOnInvoicePct: number | undefined;
    let overrideOffInvoicePct: number | undefined;

    if (planId && agreement.planOverrides) {
      const override = agreement.planOverrides.find(
        (o) => o.planId === planId && o.ltaRateId === rate.id,
      );
      if (override) {
        overrideOnInvoicePct = override.overrideOnInvoicePct ?? undefined;
        overrideOffInvoicePct = override.overrideOffInvoicePct ?? undefined;
      }
    }

    // Use override if exists, otherwise use default
    const finalOnInvoicePct = overrideOnInvoicePct ?? rate.onInvoicePercentage;
    const finalOffInvoicePct =
      overrideOffInvoicePct ?? rate.offInvoicePercentage;

    return {
      agreement,
      rate,
      overrideOnInvoicePct,
      overrideOffInvoicePct,
      finalOnInvoicePct,
      finalOffInvoicePct,
    };
  }

  async findAll(
    tenantId: string,
    status?: LTAAgreementStatus,
  ): Promise<LTAAgreement[]> {
    return this.ltaRepository.findAllByTenant(tenantId, status);
  }

  async findOne(tenantId: string, id: string): Promise<LTAAgreement> {
    const agreement = await this.ltaRepository.findById(tenantId, id);
    if (!agreement) {
      throw new NotFoundException(`LTA Agreement with ID ${id} not found`);
    }
    return agreement;
  }

  private validateRates(rates: CreateLTAAgreementDto['rates']): void {
    // Check for duplicate channel+category combinations
    const combinations = new Set<string>();
    for (const rate of rates) {
      const key = `${rate.channel}:${rate.category}`;
      if (combinations.has(key)) {
        throw new BadRequestException(
          `Duplicate channel+category combination: ${rate.channel} + ${rate.category}`,
        );
      }
      combinations.add(key);

      // Validate percentages
      if (rate.onInvoicePercentage + rate.offInvoicePercentage > 100) {
        // Warning: This is allowed but should be logged
        console.warn(
          `LTA Rate has total discount > 100%: ${rate.onInvoicePercentage}% + ${rate.offInvoicePercentage}%`,
        );
      }
    }
  }
}

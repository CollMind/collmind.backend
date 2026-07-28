import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AgreementRepository } from './agreement.repository';
import { CreateAgreementDto, UpdateAgreementDto } from './dto';
import {
  Agreement,
  AgreementStatus,
  AgreementType,
} from '../../../../database/entities/agreement.entity';
import { BudgetService } from '../../../shared/budget/budget.service';
import { BudgetReservationService } from '../../../shared/budget/budget-reservation.service';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';
import { KpiEngineService } from '../../../shared/kpi-engine/kpi-engine.service';
import { TacticService } from '../../../master-data/tactic/tactic.service';
import { CplService } from '../../../master-data/cpl/cpl.service';
import { ChannelService } from '../../../master-data/channel/channel.service';
import { MechanicService } from '../../../master-data/mechanic/mechanic.service';
import { CategoryService } from '../../../master-data/category/category.service';
import { FuService } from '../../../master-data/forecasting-unit/fu.service';
import { UserRole } from '../../../../database/entities/user.entity';
import { AccessScopeService } from '../../../shared/access-scope/access-scope.service';

/**
 * T-028c: caller identity for scope-aware create/read (mirrors
 * plan.service.ts#PlanActor — Agreement has no CATEGORY_MANAGER-facing
 * read/decision flow analogous to Plan's, so this is deliberately a
 * separate, minimal type rather than a cross-module import).
 */
export interface AgreementActor {
  userId: string;
  role: UserRole;
}

@Injectable()
export class AgreementService {
  private readonly logger = new Logger(AgreementService.name);

  constructor(
    private readonly agreementRepo: AgreementRepository,
    private readonly budgetService: BudgetService,
    private readonly budgetReservationService: BudgetReservationService,
    private readonly approvalService: ApprovalService,
    private readonly kpiEngine: KpiEngineService,
    private readonly tacticService: TacticService,
    private readonly cplService: CplService,
    private readonly channelService: ChannelService,
    private readonly mechanicService: MechanicService,
    private readonly categoryService: CategoryService,
    private readonly forecastingUnitService: FuService,
    private readonly accessScope: AccessScopeService,
  ) {}

  async create(
    dto: CreateAgreementDto,
    tenantId: string,
    userId: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    // T-028c: PLANNER may only create agreements within their assigned
    // CPL+Category scope (BRD "Planner sadece yetkili CPL+Category").
    // categoryId is optional on CreateAgreementDto — undefined maps to
    // entity.categoryId=null, matching the PLANNER seed convention (a
    // planner's CPL scope row has categoryId=null="tüm kategoriler"), so an
    // agreement with no category is checked purely on the cplId dimension.
    // Flag-gated inside AccessScopeService — no-op while
    // SCOPE_ENFORCEMENT_ENABLED is false.
    if (actor) {
      const scope = await this.accessScope.resolveScope(
        tenantId,
        actor.userId,
        actor.role,
      );
      this.accessScope.assertEntityInScope(scope, {
        cplId: dto.cplId,
        categoryId: dto.categoryId ?? null,
      });
    }

    try {
      // Validate STA/LTA duration rules
      const startDate = new Date(dto.startDate);
      const endDate = new Date(dto.endDate);
      const durationDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (dto.agreementType === AgreementType.STA && durationDays > 30) {
        throw new BadRequestException('STA agreements must be 30 days or less');
      }
      if (dto.agreementType === AgreementType.LTA && durationDays <= 30) {
        throw new BadRequestException(
          'LTA agreements must be more than 30 days',
        );
      }

      // Validate foreign key references exist (these will throw NotFoundException if not found)
      // This prevents foreign key constraint violations with clearer error messages
      await Promise.all([
        this.cplService.findOne(tenantId, dto.cplId),
        this.channelService.findOne(tenantId, dto.channelId),
        this.tacticService.findOne(tenantId, dto.tacticId),
        this.mechanicService.findOne(tenantId, dto.mechanicId),
        this.forecastingUnitService.findOne(tenantId, dto.fuId),
      ]);

      // Generate initial agreement code
      let agreementCode = await this.agreementRepo.generateAgreementCode(
        tenantId,
        dto.agreementType,
      );

      // Check if code already exists (including soft-deleted records)
      let existing = await this.agreementRepo.findByCode(
        agreementCode,
        tenantId,
        true,
      );
      let attempts = 0;
      const maxAttempts = 10;

      // If code exists, increment sequence until we find an available one
      while (existing && attempts < maxAttempts) {
        attempts++;

        // Extract current sequence and increment it by 1
        const parts = agreementCode.split('-');
        if (parts.length >= 3) {
          const currentSequence = parseInt(parts[2], 10);
          if (!isNaN(currentSequence) && currentSequence > 0) {
            const newSequence = currentSequence + 1;
            const sequenceStr = String(newSequence).padStart(3, '0');
            agreementCode = `${parts[0]}-${parts[1]}-${sequenceStr}`;
          } else {
            // Fallback: generate new code
            agreementCode = await this.agreementRepo.generateAgreementCode(
              tenantId,
              dto.agreementType,
            );
          }
        } else {
          // Fallback: generate new code
          agreementCode = await this.agreementRepo.generateAgreementCode(
            tenantId,
            dto.agreementType,
          );
        }

        // Check if new code exists
        existing = await this.agreementRepo.findByCode(
          agreementCode,
          tenantId,
          true,
        );

        if (attempts >= maxAttempts) {
          throw new ConflictException(
            `Unable to generate unique agreement code after ${maxAttempts} attempts. Please try again.`,
          );
        }
      }

      // Calculate period month from start date
      const periodMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;

      // Convert string dates to Date objects
      const agreementData: Partial<Agreement> = {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        agreementCode,
        periodMonth,
        tenantId,
        status: AgreementStatus.DRAFT,
        createdBy: userId,
        consumedAmount: 0,
        currency: dto.currency || 'TRY',
        skuScope: dto.skuScope || 'FU',
      };

      let agreement: Agreement;
      let createAttempts = 0;
      const maxCreateAttempts = 10;

      // Retry mechanism for database-level unique constraint violations
      while (createAttempts < maxCreateAttempts) {
        try {
          agreement = await this.agreementRepo.create(agreementData);
          break; // Success, exit retry loop
        } catch (createError: any) {
          // Check if it's a unique constraint violation (PostgreSQL error code 23505)
          const isUniqueConstraintError =
            createError?.code === '23505' ||
            createError?.driverError?.code === '23505' ||
            (createError?.message &&
              createError.message.includes('duplicate key')) ||
            (createError?.message &&
              createError.message.includes('IDX_AGREEMENTS_TENANT_CODE')) ||
            createError?.driverError?.constraint ===
              'IDX_AGREEMENTS_TENANT_CODE';

          if (isUniqueConstraintError) {
            createAttempts++;
            if (createAttempts >= maxCreateAttempts) {
              throw new ConflictException(
                `Unable to create agreement after ${maxCreateAttempts} attempts due to code conflicts. Please try again.`,
              );
            }

            // Increment sequence number manually instead of regenerating
            // This ensures we get a different code each time
            const parts = agreementCode.split('-');
            if (parts.length >= 3) {
              const currentSequence = parseInt(parts[2], 10);
              if (!isNaN(currentSequence)) {
                const newSequence = currentSequence + 1;
                const sequenceStr = String(newSequence).padStart(3, '0');
                agreementCode = `${parts[0]}-${parts[1]}-${sequenceStr}`;
              } else {
                // Fallback: generate new code
                agreementCode = await this.agreementRepo.generateAgreementCode(
                  tenantId,
                  dto.agreementType,
                );
              }
            } else {
              // Fallback: generate new code
              agreementCode = await this.agreementRepo.generateAgreementCode(
                tenantId,
                dto.agreementType,
              );
            }
            agreementData.agreementCode = agreementCode;

            // Wait a bit before retrying (exponential backoff)
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * createAttempts),
            );
            continue;
          }

          // If it's not a unique constraint error, re-throw it
          throw createError;
        }
      }

      // Calculate KPIs
      try {
        const kpiResults = await this.calculateKpis(agreement!, tenantId);
        if (kpiResults) {
          agreement!.kpiResults = kpiResults;
          await this.agreementRepo.update(agreement!.id, tenantId, {
            kpiResults,
          });
        }
      } catch (error) {
        console.error('KPI calculation failed:', error);
        // Don't fail agreement creation if KPI calculation fails
      }

      return agreement!;
    } catch (error) {
      const logFile = path.join(process.cwd(), 'debug_agreement_error.log');
      const errorMessage =
        error instanceof Error ? error.stack || error.message : String(error);
      const logMsg = `[${new Date().toISOString()}] Error creating agreement:\n${errorMessage}\nDTO: ${JSON.stringify(dto)}\n\n`;
      fs.appendFileSync(logFile, logMsg);
      console.error('Agreement creation failed:', error);
      throw error;
    }
  }

  /**
   * T-028e: agreement's effective category for scope purposes. Product
   * decision (task doc, DB-verified): `agreements.category_id` is empty on
   * essentially every row (133/133 in prod snapshot) — the real category is
   * carried by the product hierarchy and must be DERIVED:
   *   1. agreement.categoryId if set (priority — explicit wins).
   *   2. else agreement.fuId -> forecasting_units.gu_id ->
   *      generic_units.category_id (loaded via the
   *      'forecastingUnit.genericUnit' relation — no extra query).
   *   3. else fail-closed: return null and log a warning. A null category
   *      never matches a CATEGORY_MANAGER's (non-null) scope pair, so this
   *      agreement becomes invisible/unapprovable to CM without any special
   *      casing in AccessScopeService (PLANNER's cpl-only pairs, which carry
   *      categoryId:null meaning "any category", are unaffected).
   * DO NOT backfill agreements.category_id from this — a copied value goes
   * stale the moment the FU's category assignment changes upstream.
   */
  private resolveEffectiveCategoryId(agreement: Agreement): string | null {
    if (agreement.categoryId) {
      return agreement.categoryId;
    }
    const derived = agreement.forecastingUnit?.genericUnit?.categoryId;
    if (derived) {
      return derived;
    }
    this.logger.warn(
      `Agreement ${agreement.id} (code=${agreement.agreementCode ?? 'n/a'}) has no resolvable category ` +
        `(categoryId is null; fuId=${agreement.fuId ?? 'null'} -> forecastingUnit.genericUnit.categoryId ` +
        `did not resolve either). Failing closed: CATEGORY_MANAGER scope checks will deny this agreement.`,
    );
    return null;
  }

  async findById(
    id: string,
    tenantId: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    const agreement = await this.agreementRepo.findById(id, tenantId);
    if (!agreement) {
      throw new NotFoundException(`Agreement with ID ${id} not found`);
    }
    // T-028c: out-of-scope PLANNER -> 404 (varlık sızdırma yok, plan.service
    // ile aynı desen). No actor -> unchanged (internal callers).
    // T-028e: categoryId artık türetilmiş değer (bkz. resolveEffectiveCategoryId)
    // — CM için agreement.categoryId kolonu çoğunlukla boş, ham kolonu
    // kullanmak CM'i fail-open (UNRESTRICTED gibi davranış) yapardı.
    if (actor) {
      const scope = await this.accessScope.resolveScope(
        tenantId,
        actor.userId,
        actor.role,
      );
      if (
        !this.accessScope.isInScope(scope, {
          cplId: agreement.cplId,
          categoryId: this.resolveEffectiveCategoryId(agreement),
        })
      ) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Agreement with ID ${id} not found`,
          code: 'OUT_OF_SCOPE',
        });
      }
    }
    return agreement;
  }

  /**
   * T-028e: CM kategori-scoped onay/red — kesişim yoksa 403 (plan.service
   * #assertCmDecisionScope ile aynı desen: varlık zaten biliniyor/aksiyon
   * denendi, bu yüzden 404 değil 403). No-op for non-CM roles/no actor.
   */
  private async assertCmDecisionScope(
    agreement: Agreement,
    tenantId: string,
    actor?: AgreementActor,
  ): Promise<void> {
    if (!actor || actor.role !== UserRole.CATEGORY_MANAGER) return;
    const scope = await this.accessScope.resolveScope(
      tenantId,
      actor.userId,
      actor.role,
    );
    this.accessScope.assertEntityInScope(scope, {
      categoryId: this.resolveEffectiveCategoryId(agreement),
    });
  }

  async findByCode(code: string, tenantId: string): Promise<Agreement> {
    const agreement = await this.agreementRepo.findByCode(code, tenantId);
    if (!agreement) {
      throw new NotFoundException(`Agreement with code ${code} not found`);
    }
    return agreement;
  }

  async findAll(
    tenantId: string,
    filters?: {
      status?: AgreementStatus;
      cplId?: string;
      channel?: string;
    },
    actor?: AgreementActor,
  ): Promise<Agreement[]> {
    // T-028c: cheap no-DB-query UNRESTRICTED for ADMIN/CM/FM/READONLY (see
    // AccessScopeService.resolveScope), real cpl+category pair filtering for
    // PLANNER. undefined actor (internal callers) -> undefined scope ->
    // no-op filter, unchanged.
    const scope = actor
      ? await this.accessScope.resolveScope(tenantId, actor.userId, actor.role)
      : undefined;
    return this.agreementRepo.findAll(tenantId, filters, scope);
  }

  async findPendingApprovals(tenantId: string): Promise<Agreement[]> {
    return this.agreementRepo.findAll(tenantId, {
      status: AgreementStatus.PENDING,
    });
  }

  async update(
    id: string,
    dto: UpdateAgreementDto,
    tenantId: string,
    userId: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    // T-028c: threading actor closes the write-path gap for PLANNER (mirrors
    // plan.service.ts#update — findById already 404s out-of-scope).
    const agreement = await this.findById(id, tenantId, actor);

    // Only DRAFT agreements can be edited
    if (agreement.status !== AgreementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT agreements can be edited');
    }

    // If dates are being updated, validate STA/LTA rules
    if (dto.startDate || dto.endDate) {
      const startDate = new Date(dto.startDate || agreement.startDate);
      const endDate = new Date(dto.endDate || agreement.endDate);
      const durationDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (agreement.agreementType === AgreementType.STA && durationDays > 30) {
        throw new BadRequestException('STA agreements must be 30 days or less');
      }
      if (agreement.agreementType === AgreementType.LTA && durationDays <= 30) {
        throw new BadRequestException(
          'LTA agreements must be more than 30 days',
        );
      }
    }

    // Update period month if start date changed
    // Exclude date fields from spread to convert them separately
    const {
      startDate: dtoStartDate,
      endDate: dtoEndDate,
      ...dtoWithoutDates
    } = dto;
    const updateData: Partial<Agreement> = {
      ...dtoWithoutDates,
      updatedBy: userId,
    };

    if (dtoStartDate) {
      const startDate = new Date(dtoStartDate);
      updateData.periodMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
      updateData.startDate = startDate;
    }
    if (dtoEndDate) {
      updateData.endDate = new Date(dtoEndDate);
    }

    // If parameters affecting KPIs changed, recalculate
    const kpiAffectingFields = [
      'mechanicValue',
      'mechanicType',
      'tacticId',
      'startDate',
      'endDate',
      'additionalParams',
    ];

    const shouldRecalculate = Object.keys(dto).some((key) =>
      kpiAffectingFields.includes(key),
    );

    const updatedAgreement = await this.agreementRepo.update(
      id,
      tenantId,
      updateData,
    );

    if (shouldRecalculate) {
      try {
        const fullAgreement = await this.findById(id, tenantId);
        const kpiResults = await this.calculateKpis(fullAgreement, tenantId);
        if (kpiResults) {
          await this.agreementRepo.update(id, tenantId, { kpiResults });
          // Return the agreement with updated KPIs
          return { ...fullAgreement, kpiResults } as Agreement;
        }
      } catch (error) {
        console.error('KPI calculation failed during update:', error);
      }
    }

    return updatedAgreement;
  }

  async submit(
    id: string,
    tenantId: string,
    userId: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId, actor);

    if (agreement.status !== AgreementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT agreements can be submitted');
    }

    // Create approval request
    const approvalRequest = await this.approvalService.createRequest(
      {
        requestType: ApprovalRequestType.AGREEMENT,
        entityType: 'AGREEMENT',
        entityId: agreement.id,
      },
      tenantId,
      userId,
    );

    // Update agreement with approval request ID and status
    return this.agreementRepo.updateStatus(
      id,
      tenantId,
      AgreementStatus.PENDING,
      {
        approvalRequestId: approvalRequest.id,
        updatedBy: userId,
      },
    );
  }

  async approve(
    id: string,
    tenantId: string,
    userId: string,
    comments?: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId);

    if (agreement.status !== AgreementStatus.PENDING) {
      throw new BadRequestException('Only PENDING agreements can be approved');
    }

    // T-028e: CM kategori-scoped onay (BRD "Category Manager ATANMIŞ
    // kategoriyi onaylar"). Kesişim yoksa 403.
    await this.assertCmDecisionScope(agreement, tenantId, actor);

    // Validate that approval request exists for PENDING agreements
    // PENDING agreements should always have approvalRequestId from submit() flow
    if (!agreement.approvalRequestId) {
      throw new BadRequestException(
        'Approval request not found. PENDING agreements must have an associated approval request.',
      );
    }

    // Create budget reservation FIRST (before updating approval request)
    // This ensures that if budget reservation fails, approval request remains pending
    // Load channel relation if not already loaded
    let agreementWithChannel: Agreement = agreement;
    if (!agreement.channel) {
      const loadedAgreement = await this.agreementRepo.findById(
        agreement.id,
        tenantId,
      );
      if (!loadedAgreement || !loadedAgreement.channel) {
        throw new BadRequestException('Agreement channel not found');
      }
      agreementWithChannel = loadedAgreement;
    }

    try {
      await this.budgetService.reserveForAgreement(
        agreementWithChannel.id,
        agreementWithChannel.capTotalAmount,
        agreementWithChannel.channel.code,
        agreementWithChannel.periodMonth,
        agreementWithChannel.currency,
        tenantId,
        userId,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(
        `Budget reservation failed: ${errorMessage}`,
      );
    }

    // Update approval request AFTER successful budget reservation
    // This ensures approval request is only marked approved if budget reservation succeeded
    if (!agreement.approvalRequestId) {
      throw new BadRequestException(
        'Agreement does not have an approval request',
      );
    }
    await this.approvalService.approve(
      agreement.approvalRequestId,
      tenantId,
      userId,
      { comments },
    );

    // Update agreement status
    return this.agreementRepo.updateStatus(
      id,
      tenantId,
      AgreementStatus.APPROVED,
      {
        approvedAt: new Date(),
        approvedById: userId,
        updatedBy: userId,
      },
    );
  }

  async reject(
    id: string,
    tenantId: string,
    userId: string,
    reason: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId);

    if (agreement.status !== AgreementStatus.PENDING) {
      throw new BadRequestException('Only PENDING agreements can be rejected');
    }

    // T-028e: CM kategori-scoped red — kesişim yoksa 403.
    await this.assertCmDecisionScope(agreement, tenantId, actor);

    // Validate that approval request exists for PENDING agreements
    // PENDING agreements should always have approvalRequestId from submit() flow
    if (!agreement.approvalRequestId) {
      throw new BadRequestException(
        'Approval request not found. PENDING agreements must have an associated approval request.',
      );
    }

    // Update approval request
    await this.approvalService.reject(
      agreement.approvalRequestId,
      tenantId,
      userId,
      { reason },
    );

    const updated = await this.agreementRepo.updateStatus(
      id,
      tenantId,
      AgreementStatus.REJECTED,
      {
        rejectedAt: new Date(),
        rejectedById: userId,
        rejectionReason: reason,
        updatedBy: userId,
      },
    );

    // T-030 (F3, defensive): PENDING agreements normally have no budget
    // reservation yet (RESERVE only happens on approve()), so this is
    // expected to be a no-op today. Kept defensive in case reservation
    // timing changes upstream — reject() must never leave a stray RESERVE.
    //
    // Code-review fix (2026-07-27, #2): status was already written to
    // REJECTED above, so a release failure here must NOT throw (unlike
    // cancel(), where release happens before the status write and a
    // BadRequestException correctly blocks the transition). Throwing after
    // the status write would surface a 500 for an already-committed,
    // immutably-audited rejection, and a retry would then hit "Only PENDING
    // agreements can be rejected" — confusing. Log and continue, same
    // defensive no-op-on-failure pattern as PlanService#reject (T-029).
    try {
      await this.budgetReservationService.releaseAgreementReservation(
        id,
        tenantId,
        userId,
        'REJECT',
      );
    } catch (error) {
      this.logger.error(
        `Budget release failed after reject for agreement ${id} (status already committed as REJECTED): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }

    return updated;
  }

  async cancel(
    id: string,
    tenantId: string,
    userId: string,
    reason?: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId, actor);

    if (
      ![AgreementStatus.APPROVED, AgreementStatus.ACTIVE].includes(
        agreement.status,
      )
    ) {
      throw new BadRequestException(
        'Only APPROVED or ACTIVE agreements can be cancelled',
      );
    }

    // T-030: release the FULL net outstanding reservation (RESERVE+COMMIT−RELEASE)
    // for every envelope this agreement touched, not `capTotalAmount` (drift risk
    // if cap was edited post-approval) and not just the single first RESERVE tx
    // found (multi-envelope agreements, T-019). Idempotency key is identical to
    // the one this call used to write directly, so no double-release / conflict.
    try {
      await this.budgetReservationService.releaseAgreementReservation(
        agreement.id,
        tenantId,
        userId,
        'CANCEL',
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(`Budget release failed: ${errorMessage}`);
    }

    // Update agreement status
    return this.agreementRepo.updateStatus(
      id,
      tenantId,
      AgreementStatus.CANCELLED,
      {
        updatedBy: userId,
      },
    );
  }

  async delete(
    id: string,
    tenantId: string,
    userId: string,
    actor?: AgreementActor,
  ): Promise<void> {
    const agreement = await this.findById(id, tenantId, actor);

    // Only DRAFT agreements can be deleted
    if (agreement.status !== AgreementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT agreements can be deleted');
    }

    await this.agreementRepo.softDelete(id, tenantId);
  }

  /**
   * Get available tactics for channel and category
   * BRD: Tactic-Mechanic structure
   * - Tactic: Central catalog with applicability rules (channel/category codes)
   * - Mechanic: Belongs to a tactic, defines calculation method (PERCENT, AMOUNT, AMOUNT_PER_UNIT)
   * - One tactic can have multiple mechanics
   *
   * Filters tactics based on applicability rules using channel/category codes
   * Returns tactics with their associated active mechanics
   */
  async getAvailableTactics(
    tenantId: string,
    channelIdOrCode?: string,
    categoryId?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      code: string;
      spendType: 'ON_INVOICE' | 'OFF_INVOICE' | 'BOTH';
      mechanics: Array<{
        id: string;
        name: string;
        code: string;
        mechanicType: 'PERCENT' | 'AMOUNT' | 'AMOUNT_PER_UNIT';
        minValue?: number;
        maxValue?: number;
      }>;
    }>
  > {
    // Get all active tactics with their mechanics (relations loaded)
    const tactics = await this.tacticService.findAll(tenantId, true);

    // Resolve channel code from channelId if provided (UUID format check)
    let channelCode: string | undefined;
    if (channelIdOrCode) {
      // Check if it's a UUID (channelId) or a code
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          channelIdOrCode,
        );
      if (isUuid) {
        try {
          const channel = await this.channelService.findOne(
            tenantId,
            channelIdOrCode,
          );
          channelCode = channel.code;
        } catch (error) {
          console.warn(`Channel with ID ${channelIdOrCode} not found`);
        }
      } else {
        channelCode = channelIdOrCode;
      }
    }

    // Resolve category code from categoryId if provided
    let categoryCode: string | undefined;
    if (categoryId) {
      try {
        const category = await this.categoryService.findOne(
          tenantId,
          categoryId,
        );
        categoryCode = category.code;
      } catch (error) {
        console.warn(`Category with ID ${categoryId} not found`);
      }
    }

    // Filter by channel applicability (using channel code)
    let filtered = tactics.filter((t) => {
      // If no applicable channels defined, it's available for all
      if (!t.applicableChannels || t.applicableChannels.length === 0)
        return true;
      if (!channelCode) return false;
      return t.applicableChannels.includes(channelCode);
    });

    // Filter by category applicability if provided (using category code)
    if (categoryCode) {
      filtered = filtered.filter((t) => {
        // If no applicable categories defined, it's available for all
        if (!t.applicableCategories || t.applicableCategories.length === 0)
          return true;
        return t.applicableCategories.includes(categoryCode!);
      });
    }

    // Return tactics with their active mechanics
    return filtered.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      spendType: t.spendType || 'ON_INVOICE',
      mechanics: (t.mechanics || [])
        .filter((m) => m.isActive)
        .map((m) => ({
          id: m.id,
          name: m.name,
          code: m.code,
          mechanicType: m.mechanicType,
          minValue: m.minValue,
          maxValue: m.maxValue,
        })),
    }));
  }

  /**
   * Calculate KPIs for agreement using KpiEngine
   */
  private async calculateKpis(
    agreement: Agreement,
    tenantId: string,
  ): Promise<Record<string, any>> {
    // Construct SKU context (simplification: assuming 1 SKU or aggregate context)
    // For now, we'll use a simplified context based on agreement fields
    // In a real scenario, this would iterate over all SKUs in scope

    // Flatten additional params into tactics context
    const tacticsContext: Record<string, number> = {};
    if (agreement.additionalParams) {
      for (const [key, value] of Object.entries(agreement.additionalParams)) {
        if (typeof value === 'number') {
          tacticsContext[key] = value;
        }
      }
    }

    // Add mechanic value if present
    if (agreement.mechanicValue) {
      // Assuming tactic ID or code maps to the KpiEngine context key
      // This mapping needs to be defined in master data
      tacticsContext['MECHANIC_VAL'] = agreement.mechanicValue;
    }

    // Mock SKU results for now (since we don't have full SKU data flow here yet)
    // In production, this should fetch actual SKU volumes
    const skuResults = [
      {
        BASE_VOL: { value: 1000, displayFormat: 'N0', decimalPlaces: 0 },
        PLAN_VOL: { value: 1100, displayFormat: 'N0', decimalPlaces: 0 }, // 10% uplift assumption
      },
    ];

    // Calculate at FU level
    const kpiResults = await this.kpiEngine.calculateFu(
      tenantId,
      skuResults as any, // Type assertion due to mock structure
      tacticsContext,
    );

    // Transform results to simple value map for storage
    const simplifiedResults: Record<string, any> = {};
    for (const [key, result] of Object.entries(kpiResults)) {
      simplifiedResults[key] = {
        value: result.value,
        rag: result.ragStatus,
      };
    }

    return simplifiedResults;
  }
}

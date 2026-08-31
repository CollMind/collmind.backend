import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
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
import { AdminAuditService } from '../../../../common/services/admin-audit.service';
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
import { missingVersionConflict } from '../../../shared/persistence/versioned-update.helper';

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
    private readonly adminAuditService: AdminAuditService,
    // T-034b: agreement's canonical state-transition path (submit/approve/
    // reject) — same real-transaction + FOR UPDATE + status-CAS treatment
    // as plan.service.ts/approval-workflow.service.ts (docs/analysis/0005
    // §4).
    private readonly dataSource: DataSource,
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
          // T-034: deliberate CAS bypass — kpiResults is a derived output
          // computed right after create(), not a user edit.
          await this.agreementRepo.updateUnversioned(agreement!.id, tenantId, {
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
    // T-028c: UNRESTRICTED for ADMIN/FM/READONLY via their wildcard
    // user_scopes row (Z30 H8 — NOT "no-DB-query" any more, and CM was NEVER
    // UNRESTRICTED: it gets category-only normalization). Real cpl+category
    // pair filtering for
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
    userEmail?: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    // T-028c: threading actor closes the write-path gap for PLANNER (mirrors
    // plan.service.ts#update — findById already 404s out-of-scope).
    const agreement = await this.findById(id, tenantId, actor);

    // Only DRAFT agreements can be edited
    if (agreement.status !== AgreementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT agreements can be edited');
    }

    // T-034: optimistic locking, strict mode — version is required; a
    // request that omits it is rejected with 409 MISSING_VERSION (not a
    // ValidationPipe 400 — see UpdateAgreementDto#version).
    if (dto.version === undefined || dto.version === null) {
      throw missingVersionConflict({ entity: 'AGREEMENT', entityId: id });
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
    // Exclude date fields from spread to convert them separately.
    // T-034: also strip `version` (CAS metadata, not an Agreement column).
    const {
      startDate: dtoStartDate,
      endDate: dtoEndDate,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      version: _version,
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

    const updatedAgreement = await this.agreementRepo.updateVersioned(
      id,
      tenantId,
      dto.version,
      updateData,
    );

    // T-032: audit immutable — BRD "her işlem loglanır" also covers field
    // edits of a DRAFT agreement, not just state transitions. before/after
    // are scoped to the fields actually present in the DTO (not the full
    // entity) to keep the log focused and avoid dumping unrelated columns.
    // Best-effort / non-blocking (unlike submit/approve/reject/cancel
    // below): a DRAFT edit is freely repeatable and has no budget/approval
    // side effect to compensate, so a logging failure here must not fail
    // the edit that has already been persisted — same trade-off already
    // accepted for the "KPI recalculation failed" catch further down.
    // T-034: `version` is optimistic-locking metadata, not a business field
    // — exclude it from the audit before/after diff (it is not a "changed
    // field" in the BRD sense, and diffing it would misleadingly log every
    // edit as also having "changed" version).
    const changedKeys = Object.keys(dto).filter(
      (key) =>
        key !== 'version' &&
        (dto as Record<string, unknown>)[key] !== undefined,
    );
    if (changedKeys.length > 0) {
      const beforeValues: Record<string, unknown> = {};
      const afterValues: Record<string, unknown> = {};
      for (const key of changedKeys) {
        beforeValues[key] = (agreement as unknown as Record<string, unknown>)[
          key
        ];
        afterValues[key] = (dto as unknown as Record<string, unknown>)[key];
      }
      try {
        await this.adminAuditService.logAdminAction(
          tenantId,
          userId,
          userEmail ?? 'unknown',
          'UPDATE',
          'AGREEMENT',
          id,
          undefined,
          'SUCCESS',
          beforeValues,
          afterValues,
        );
      } catch (error) {
        this.logger.error(
          `Audit log failed for agreement ${id} update (edit already committed): ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }

    if (shouldRecalculate) {
      try {
        const fullAgreement = await this.findById(id, tenantId);
        const kpiResults = await this.calculateKpis(fullAgreement, tenantId);
        if (kpiResults) {
          // T-034: deliberate CAS bypass — derived KPI output, not a user
          // edit; would fail CAS every time against the version the
          // #updateVersioned call above just bumped.
          await this.agreementRepo.updateUnversioned(id, tenantId, {
            kpiResults,
          });
          // Return the agreement with updated KPIs
          return { ...fullAgreement, kpiResults } as Agreement;
        }
      } catch (error) {
        console.error('KPI calculation failed during update:', error);
      }
    }

    return updatedAgreement;
  }

  /**
   * T-034b (docs/analysis/0005 §4): real transaction + `FOR UPDATE` +
   * status-CAS, replacing the old compensate-on-failure pattern (T-032).
   * No budget moves at submit() time (agreement reserves budget in
   * approve(), unlike Plan) — the atomicity here closes the
   * status/approval-request/audit race instead.
   */
  async submit(
    id: string,
    tenantId: string,
    userId: string,
    userEmail?: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    // Pre-transaction: 404/OUT_OF_SCOPE.
    await this.findById(id, tenantId, actor);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let auditLog: Awaited<
      ReturnType<AdminAuditService['logAdminAction']>
    > | null = null;

    try {
      const agreement = await this.agreementRepo.findByIdForUpdate(
        id,
        tenantId,
        queryRunner.manager,
      );
      if (!agreement) {
        throw new NotFoundException(`Agreement with ID ${id} not found`);
      }
      if (agreement.status !== AgreementStatus.DRAFT) {
        throw new BadRequestException('Only DRAFT agreements can be submitted');
      }

      const approvalRequest = await this.approvalService.createRequest(
        {
          requestType: ApprovalRequestType.AGREEMENT,
          entityType: 'AGREEMENT',
          entityId: agreement.id,
        },
        tenantId,
        userId,
        queryRunner.manager,
      );

      const affected = await this.agreementRepo.updateStatusCas(
        queryRunner.manager,
        id,
        tenantId,
        AgreementStatus.DRAFT,
        {
          status: AgreementStatus.PENDING,
          approvalRequestId: approvalRequest.id,
          updatedBy: userId,
          version: () => '"version" + 1',
        } as any,
      );
      if (affected === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INVALID_STATE_TRANSITION',
          message: 'Agreement status changed concurrently; retry.',
        });
      }

      // T-032 (BRD "audit immutable ... onay/red dahil her işlem loglanır"):
      // now inside the same transaction (T-014's manager overload) — a
      // failed audit write rolls back the status + approval-request
      // together, no manual revert-to-DRAFT needed.
      auditLog = await this.adminAuditService.logAdminAction(
        tenantId,
        userId,
        userEmail ?? 'unknown',
        'SUBMIT',
        'AGREEMENT',
        id,
        undefined,
        'SUCCESS',
        { previousStatus: AgreementStatus.DRAFT },
        {
          newStatus: AgreementStatus.PENDING,
          approvalRequestId: approvalRequest.id,
        },
        undefined,
        { manager: queryRunner.manager },
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // T-014: high-risk alarm (SUBMIT is not flagged high-risk today, so this
    // is a no-op — kept for consistency with approve()/reject() below and in
    // case that classification ever changes) fires only AFTER a successful
    // commit, in its own try/catch (never masks a committed submit as a 500).
    try {
      await this.adminAuditService.flushPendingAlert(auditLog);
    } catch (alertErr) {
      this.logger.error(
        `HIGH-RISK ALERT FAILED — AGREEMENT ${id} submitted successfully; alert not delivered: ${
          alertErr instanceof Error ? alertErr.message : 'Unknown error'
        }`,
      );
    }

    return (await this.agreementRepo.findById(id, tenantId)) as Agreement;
  }

  /**
   * T-034b: real transaction + `FOR UPDATE` + status-CAS, replacing the old
   * compensate-on-failure pattern (release RESERVE + revert to PENDING).
   * Mirrors plan.service.ts#approve — budget RESERVE, approval-request
   * decision, status write, and audit log are now one atomic unit.
   */
  async approve(
    id: string,
    tenantId: string,
    userId: string,
    comments?: string,
    userEmail?: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    // Pre-transaction: 404 + channel relation (needed for the envelope
    // lookup; channel does not participate in the money/status race this
    // task closes — same rationale as plan.service.ts#approve's channelCode
    // capture) + CM scope check (categoryId derivation needs full relations,
    // see #assertCmDecisionScope/#resolveEffectiveCategoryId).
    const initial = await this.findById(id, tenantId);
    await this.assertCmDecisionScope(initial, tenantId, actor);

    let agreementWithChannel: Agreement = initial;
    if (!initial.channel) {
      const loaded = await this.agreementRepo.findById(id, tenantId);
      if (!loaded || !loaded.channel) {
        throw new BadRequestException('Agreement channel not found');
      }
      agreementWithChannel = loaded;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let auditLog: Awaited<
      ReturnType<AdminAuditService['logAdminAction']>
    > | null = null;

    try {
      const agreement = await this.agreementRepo.findByIdForUpdate(
        id,
        tenantId,
        queryRunner.manager,
      );
      if (!agreement) {
        throw new NotFoundException(`Agreement with ID ${id} not found`);
      }
      if (agreement.status !== AgreementStatus.PENDING) {
        throw new BadRequestException(
          'Only PENDING agreements can be approved',
        );
      }
      if (!agreement.approvalRequestId) {
        throw new BadRequestException(
          'Approval request not found. PENDING agreements must have an associated approval request.',
        );
      }

      // Budget RESERVE, approval-request decision, status write — all
      // inside the same transaction now (T-034b "asıl ödül": a failure
      // anywhere rolls back everything, no manual compensation needed).
      await this.budgetService.reserveForAgreement(
        agreementWithChannel.id,
        agreementWithChannel.capTotalAmount,
        agreementWithChannel.channel.code,
        agreementWithChannel.periodMonth,
        agreementWithChannel.currency,
        tenantId,
        userId,
        agreementWithChannel.spendType,
        queryRunner.manager,
      );

      await this.approvalService.approve(
        agreement.approvalRequestId,
        tenantId,
        userId,
        { comments },
        queryRunner.manager,
      );

      const affected = await this.agreementRepo.updateStatusCas(
        queryRunner.manager,
        id,
        tenantId,
        AgreementStatus.PENDING,
        {
          status: AgreementStatus.APPROVED,
          approvedAt: new Date(),
          approvedById: userId,
          updatedBy: userId,
          version: () => '"version" + 1',
        } as any,
      );
      if (affected === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INVALID_STATE_TRANSITION',
          message: 'Agreement status changed concurrently; retry.',
        });
      }

      // T-032: audit immutable — approve must be recorded.
      auditLog = await this.adminAuditService.logAdminAction(
        tenantId,
        userId,
        userEmail ?? 'unknown',
        'APPROVE',
        'AGREEMENT',
        id,
        undefined,
        'SUCCESS',
        { previousStatus: AgreementStatus.PENDING },
        {
          newStatus: AgreementStatus.APPROVED,
          capTotalAmount: Number(agreementWithChannel.capTotalAmount),
          comments,
        },
        comments,
        { manager: queryRunner.manager },
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // T-014: APPROVE is high-risk (admin-audit.service.ts#isHighRiskAction)
    // — alarm fires only AFTER a successful commit, in its own try/catch.
    try {
      await this.adminAuditService.flushPendingAlert(auditLog);
    } catch (alertErr) {
      this.logger.error(
        `HIGH-RISK ALERT FAILED — AGREEMENT ${id} approved successfully; alert not delivered: ${
          alertErr instanceof Error ? alertErr.message : 'Unknown error'
        }`,
      );
    }

    return (await this.agreementRepo.findById(id, tenantId)) as Agreement;
  }

  /**
   * T-034b: real transaction + `FOR UPDATE` + status-CAS. Unlike
   * plan.service.ts#reject, the defensive budget release here stays
   * best-effort (logged, not thrown/rolled-back): PENDING agreements
   * normally have NO outstanding reservation at all (RESERVE only happens
   * in approve(), unlike Plan's submit()) — so this call is expected to be
   * a no-op today, and rolling back an already-correct REJECTED decision
   * over a defensive no-op's failure would be strictly worse. Status write
   * + approval-request decision + audit ARE atomic (T-034b "asıl ödül").
   */
  async reject(
    id: string,
    tenantId: string,
    userId: string,
    reason: string,
    userEmail?: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    const initial = await this.findById(id, tenantId);
    await this.assertCmDecisionScope(initial, tenantId, actor);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let auditLog: Awaited<
      ReturnType<AdminAuditService['logAdminAction']>
    > | null = null;

    try {
      const agreement = await this.agreementRepo.findByIdForUpdate(
        id,
        tenantId,
        queryRunner.manager,
      );
      if (!agreement) {
        throw new NotFoundException(`Agreement with ID ${id} not found`);
      }
      if (agreement.status !== AgreementStatus.PENDING) {
        throw new BadRequestException(
          'Only PENDING agreements can be rejected',
        );
      }
      if (!agreement.approvalRequestId) {
        throw new BadRequestException(
          'Approval request not found. PENDING agreements must have an associated approval request.',
        );
      }

      await this.approvalService.reject(
        agreement.approvalRequestId,
        tenantId,
        userId,
        { reason },
        queryRunner.manager,
      );

      const affected = await this.agreementRepo.updateStatusCas(
        queryRunner.manager,
        id,
        tenantId,
        AgreementStatus.PENDING,
        {
          status: AgreementStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedById: userId,
          rejectionReason: reason,
          updatedBy: userId,
          version: () => '"version" + 1',
        } as any,
      );
      if (affected === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INVALID_STATE_TRANSITION',
          message: 'Agreement status changed concurrently; retry.',
        });
      }

      // T-032: audit immutable — reject must be recorded.
      auditLog = await this.adminAuditService.logAdminAction(
        tenantId,
        userId,
        userEmail ?? 'unknown',
        'REJECT',
        'AGREEMENT',
        id,
        undefined,
        'SUCCESS',
        { previousStatus: AgreementStatus.PENDING },
        { newStatus: AgreementStatus.REJECTED, rejectionReason: reason },
        reason,
        { manager: queryRunner.manager },
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // T-014: REJECT is not flagged high-risk today — no-op, kept for
    // consistency; fires only after a successful commit either way.
    try {
      await this.adminAuditService.flushPendingAlert(auditLog);
    } catch (alertErr) {
      this.logger.error(
        `HIGH-RISK ALERT FAILED — AGREEMENT ${id} rejected successfully; alert not delivered: ${
          alertErr instanceof Error ? alertErr.message : 'Unknown error'
        }`,
      );
    }

    // T-030 (F3, defensive): PENDING agreements normally have no budget
    // reservation yet (RESERVE only happens on approve()) — best-effort,
    // outside the transaction (see method header comment for why this one
    // stays a logged no-op rather than participating in the rollback).
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

    return (await this.agreementRepo.findById(id, tenantId)) as Agreement;
  }

  /**
   * T-042 (code-review follow-up to T-034b, docs/analysis/0005 §4): moved to
   * the same real-transaction pattern as approve()/reject() above. Previously
   * this method read the agreement UNLOCKED (`findById`) and wrote the new
   * status UNCONDITIONALLY (`updateStatus` → `updateUnversioned`, no status
   * precondition at all) — the one state transition T-034b left behind.
   * Concrete failure this closes: settlement-close.service.ts locks the same
   * row with `pessimistic_write` and writes CLOSED; a concurrent cancel()
   * reading a stale "APPROVED" copy could still land its unconditional
   * UPDATE AFTER close's commit, silently turning CLOSED back into
   * CANCELLED — an invalid state-machine transition, not just a lost update.
   *
   * Lock ORDER matches settlement-close.service.ts: agreement row
   * (`findByIdForUpdate`, pessimistic_write) is locked FIRST, THEN the
   * budget envelope is touched (`releaseAgreementReservation` with
   * `queryRunner.manager`) inside the same transaction — same order both
   * call sites use, so this and closeAgreement() can never deadlock on each
   * other regardless of which one wins the race; the loser blocks on the
   * agreement row lock and then re-reads the now-committed status via the
   * status-CAS guard below (or, defensively, the `expectedStatus` mismatch
   * itself), not on a lock cycle.
   *
   * Former T-032 note (now stale, kept here crossed out for the historical
   * record — do NOT resurrect this trade-off): "cancel doesn't revert state
   * on audit-write failure because budget release already committed and its
   * idempotency key is one-shot, so there is no safe re-reserve path; log
   * ERROR + 500 instead". That reasoning assumed audit was written OUTSIDE
   * any transaction the budget release participated in. It no longer
   * applies: audit now uses the T-014 `{ manager }` overload inside THIS
   * queryRunner's transaction, so a failed audit write rolls back the budget
   * release AND the status-CAS together — there is nothing left to
   * "reconcile manually". A commit failure now behaves like every other
   * transition here (submit/approve/reject): full rollback, no compensation
   * code needed.
   */
  async cancel(
    id: string,
    tenantId: string,
    userId: string,
    reason?: string,
    userEmail?: string,
    actor?: AgreementActor,
  ): Promise<Agreement> {
    // Pre-transaction: scope check only (out-of-scope PLANNER -> 404, same
    // pattern as approve()/reject()'s `initial` read above).
    await this.findById(id, tenantId, actor);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let auditLog: Awaited<
      ReturnType<AdminAuditService['logAdminAction']>
    > | null = null;
    let previousStatus: AgreementStatus;

    try {
      const agreement = await this.agreementRepo.findByIdForUpdate(
        id,
        tenantId,
        queryRunner.manager,
      );
      if (!agreement) {
        throw new NotFoundException(`Agreement with ID ${id} not found`);
      }
      // [[T-335]] `Q21` — bu küme kod tabanında BEŞ yerde ayrı ayrı yazılı;
      // kaynak (Section_04:603, tam alıntı `agreement.entity.ts`
      // `IN_FORCE_AGREEMENT_STATES` yorumunda) BİR KEZ yazılıdır, buraya
      // TEKRAR EDİLMEZ. Bu kopyanın sorduğu soru: **"iptal edilebilir mi?"**
      // Kardeşleri (aynı DEĞER, FARKLI soru — bilerek birleştirilmedi):
      //   reversal.service.ts#REVERSIBLE_AGREEMENT_STATES         "ters kayıt atılabilir mi"
      //   settlement-close.service.ts#SETTLEABLE_STATES          "kapatılabilir mi"
      //   off-invoice-validation.service.ts#validateRow          "harcama girilebilir mi"
      //   agreement.entity.ts IN_FORCE_AGREEMENT_STATES             "oran kademesi harcama motoruna iner mi"
      // Biri değişirse diğer DÖRDÜ OTOMATİK değişmez — ayrı soru, ayrı karar.
      if (
        ![AgreementStatus.APPROVED, AgreementStatus.ACTIVE].includes(
          agreement.status,
        )
      ) {
        throw new BadRequestException(
          'Only APPROVED or ACTIVE agreements can be cancelled',
        );
      }
      previousStatus = agreement.status;

      // T-030: release the FULL net outstanding reservation
      // (RESERVE+COMMIT−RELEASE) for every envelope this agreement touched,
      // not `capTotalAmount` (drift risk if cap was edited post-approval)
      // and not just the single first RESERVE tx found (multi-envelope
      // agreements, T-019). Same idempotency key as before; now runs inside
      // this transaction (`queryRunner.manager`) so the "net outstanding"
      // read sees this transaction's own not-yet-committed writes (there are
      // none earlier in this method) and — same as approve()/reject() —
      // rollback undoes the release together with the status write, so the
      // idempotency key is never left "used up" against a status change that
      // didn't actually happen.
      await this.budgetReservationService.releaseAgreementReservation(
        agreement.id,
        tenantId,
        userId,
        'CANCEL',
        queryRunner.manager,
      );

      // Row is already locked (`findByIdForUpdate` above) — `expectedStatus`
      // here is the value just read under that lock, not a stale copy, so a
      // single-status CAS predicate is safe even though two source statuses
      // (APPROVED/ACTIVE) are allowed by the guard above. The CAS remains a
      // second line of defense (belt-and-suspenders with the row lock), same
      // as approve()/reject().
      const affected = await this.agreementRepo.updateStatusCas(
        queryRunner.manager,
        id,
        tenantId,
        previousStatus,
        {
          status: AgreementStatus.CANCELLED,
          updatedBy: userId,
          version: () => '"version" + 1',
        } as any,
      );
      if (affected === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'INVALID_STATE_TRANSITION',
          message: 'Agreement status changed concurrently; retry.',
        });
      }

      // T-032: audit immutable — cancel must be recorded (BRD: "her işlem
      // loglanır"). T-014: same transaction as the status write + budget
      // release above (`{ manager: queryRunner.manager }`) — see method
      // header for why the old "audit outside the transaction" compensation
      // note no longer applies.
      auditLog = await this.adminAuditService.logAdminAction(
        tenantId,
        userId,
        userEmail ?? 'unknown',
        'CANCEL',
        'AGREEMENT',
        id,
        undefined,
        'SUCCESS',
        { previousStatus },
        { newStatus: AgreementStatus.CANCELLED, reason },
        reason,
        { manager: queryRunner.manager },
      );

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // T-014: CANCEL is a terminal, irreversible state transition that
    // releases budget — same isHighRisk class as CLOSE
    // (admin-audit.service.ts). Alarm fires only AFTER a successful commit,
    // in its OWN try/catch (T-014 lesson): an alert-delivery failure must
    // never turn an already-committed cancel into a 500.
    try {
      await this.adminAuditService.flushPendingAlert(auditLog);
    } catch (alertErr) {
      this.logger.error(
        `HIGH-RISK ALERT FAILED — AGREEMENT ${id} cancelled successfully; alert not delivered: ${
          alertErr instanceof Error ? alertErr.message : 'Unknown error'
        }`,
      );
    }

    return (await this.agreementRepo.findById(id, tenantId)) as Agreement;
  }

  async delete(
    id: string,
    tenantId: string,
    userId: string,
    version?: number,
    actor?: AgreementActor,
  ): Promise<void> {
    const agreement = await this.findById(id, tenantId, actor);

    // Only DRAFT agreements can be deleted
    if (agreement.status !== AgreementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT agreements can be deleted');
    }

    // T-034 (code-review follow-up): delete was found entirely unguarded —
    // same fix as PlanService#delete. Strict-mode missing version -> 409
    // MISSING_VERSION.
    if (version === undefined || version === null) {
      throw missingVersionConflict({ entity: 'AGREEMENT', entityId: id });
    }

    await this.agreementRepo.softDeleteVersioned(id, tenantId, version);
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
        // ⚠️ `T-342` `N3` — BU EŞLEME `ragExclusionReason`'I DÜŞÜRÜYOR.
        // Bugün etkisiz (ölçüldü: bu yol taşıyıcı KPI'ı bu şekilde
        // sunmuyor, tüketicisi rengin yokluk SEBEBİNİ okumuyor), ama alan
        // burada **sessizce kayboluyor** — bir gün bu çıktı bir rozet
        // besleyecek olursa *"değerlendirilmedi"* ile *"değerlendirme
        // dışı"* yine karışır. Adı konuldu ki sessiz kalmasın.
        rag: result.ragStatus,
      };
    }

    return simplifiedResults;
  }
}

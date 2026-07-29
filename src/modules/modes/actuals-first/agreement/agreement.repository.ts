import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Agreement,
  AgreementStatus,
  AgreementType,
} from '../../../../database/entities/agreement.entity';
import {
  AccessScopeService,
  EffectiveScope,
} from '../../../shared/access-scope/access-scope.service';
import {
  applyVersionedUpdate,
  staleVersionConflict,
} from '../../../shared/persistence/versioned-update.helper';

@Injectable()
export class AgreementRepository {
  constructor(
    @InjectRepository(Agreement)
    private readonly repo: Repository<Agreement>,
    private readonly accessScope: AccessScopeService,
  ) {}

  async create(data: Partial<Agreement>): Promise<Agreement> {
    const agreement = this.repo.create(data);
    return this.repo.save(agreement);
  }

  async findById(id: string, tenantId: string): Promise<Agreement | null> {
    return this.repo.findOne({
      where: { id, tenantId },
      relations: [
        'cpl',
        'channel',
        'category',
        // T-028e: forecastingUnit.genericUnit — CM kategori-scope türetme
        // zinciri (agreement.categoryId çoğu satırda boş; kategori
        // fuId -> forecasting_units.gu_id -> generic_units.category_id
        // üzerinden çözülür, bkz. AgreementService#resolveEffectiveCategoryId).
        // Tek query'de LEFT JOIN (TypeORM nested relations), N+1 yok.
        'forecastingUnit.genericUnit',
        'tactic',
        'mechanic',
      ],
    });
  }

  async findByCode(
    code: string,
    tenantId: string,
    includeDeleted = false,
  ): Promise<Agreement | null> {
    const query = this.repo
      .createQueryBuilder('agreement')
      .where('agreement.agreementCode = :code', { code })
      .andWhere('agreement.tenantId = :tenantId', { tenantId });

    if (!includeDeleted) {
      query.andWhere('agreement.deletedAt IS NULL');
    }

    return query.getOne();
  }

  async findAll(
    tenantId: string,
    filters?: {
      status?: AgreementStatus;
      cplId?: string;
      channelId?: string;
    },
    /**
     * T-028c: PLANNER cpl-scoped okuma (docs/analysis/0004-rbac-brd-alignment.md
     * §4/§5, agreement row aynı desen — plan.repository.ts#findAll ile
     * tutarlı). Yalnızca çağıran taraf (AgreementService) bir scope
     * geçtiğinde uygulanır — undefined için no-op (geriye uyumlu).
     */
    scope?: EffectiveScope,
  ): Promise<Agreement[]> {
    const query = this.repo
      .createQueryBuilder('agreement')
      .where('agreement.tenantId = :tenantId', { tenantId })
      .andWhere('agreement.deletedAt IS NULL');

    if (filters?.status) {
      query.andWhere('agreement.status = :status', { status: filters.status });
    }
    if (filters?.cplId) {
      query.andWhere('agreement.cplId = :cplId', { cplId: filters.cplId });
    }
    if (filters?.channelId) {
      query.andWhere('agreement.channelId = :channelId', {
        channelId: filters.channelId,
      });
    }
    if (scope && scope.kind !== 'UNRESTRICTED') {
      // T-028e: agreement.categoryId is empty on almost every row — the
      // effective category is derived via fuId -> forecasting_units.gu_id ->
      // generic_units.category_id (product decision, see task doc). Plain
      // LEFT JOIN (no *AndSelect*, columns not needed on the result set) so
      // this stays a single query — no N+1 for CM/PLANNER list filtering.
      query
        .leftJoin('agreement.forecastingUnit', 'scopeFu')
        .leftJoin('scopeFu.genericUnit', 'scopeGu');
      this.accessScope.applyToQueryBuilder(
        query,
        'agreement',
        scope,
        'COALESCE(agreement.categoryId, scopeGu.categoryId)',
      );
    }

    return query.orderBy('agreement.createdAt', 'DESC').getMany();
  }

  /**
   * T-034: deliberate CAS bypass — see
   * src/modules/shared/persistence/versioned-update.helper.ts header
   * comment. Used by (a) state-transition writes via #updateStatus (submit/
   * approve/reject/close — status-CAS is T-034b's job, not this task's) and
   * (b) the KPI-recalc write inside #update / #create (`kpiResults` is a
   * derived output, not a user edit — a CAS there would fail every time
   * against the version the preceding user-input write already bumped).
   * Grep-able on purpose (T-034 acceptance criteria / code-reviewer
   * checklist item).
   */
  async updateUnversioned(
    id: string,
    tenantId: string,
    data: Partial<Agreement>,
  ): Promise<Agreement> {
    await this.repo.update({ id, tenantId }, data);
    const updated = await this.findById(id, tenantId);
    if (!updated) {
      throw new Error('Agreement not found after update');
    }
    return updated;
  }

  /**
   * T-034: CAS write for the user-input DRAFT-edit path
   * (AgreementService#update). `affected === 0` means either not-found or
   * stale; a version-less re-read tells the two apart.
   */
  async updateVersioned(
    id: string,
    tenantId: string,
    expectedVersion: number,
    data: Partial<Agreement>,
  ): Promise<Agreement> {
    const affected = await applyVersionedUpdate(
      this.repo,
      { id, tenantId },
      expectedVersion,
      data as any,
    );
    if (affected === 0) {
      const current = await this.repo.findOne({ where: { id, tenantId } });
      if (!current) {
        throw new NotFoundException(`Agreement with ID ${id} not found`);
      }
      throw staleVersionConflict({
        entity: 'AGREEMENT',
        entityId: id,
        expectedVersion,
        currentVersion: current.version,
        current: {
          agreementName: current.agreementName,
          startDate: current.startDate,
          endDate: current.endDate,
          updatedBy: current.updatedBy,
          updatedAt: current.updatedAt,
        },
      });
    }
    const updated = await this.findById(id, tenantId);
    if (!updated) {
      throw new Error('Agreement not found after update');
    }
    return updated;
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: AgreementStatus,
    additionalFields?: Partial<Agreement>,
  ): Promise<Agreement> {
    const updateData = { status, ...additionalFields };
    return this.updateUnversioned(id, tenantId, updateData);
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    await this.repo.softDelete({ id, tenantId });
  }

  /**
   * T-034 (code-review follow-up, 2026-07-29): destructive — mirrors
   * PlanRepository#softDeleteVersioned. Sets `deletedAt` directly rather
   * than calling `Repository#softDelete` (which builds its own UPDATE and
   * cannot carry the version predicate).
   */
  async softDeleteVersioned(
    id: string,
    tenantId: string,
    expectedVersion: number,
  ): Promise<void> {
    const affected = await applyVersionedUpdate(
      this.repo,
      { id, tenantId },
      expectedVersion,
      { deletedAt: new Date() } as any,
    );
    if (affected === 0) {
      const current = await this.repo.findOne({ where: { id, tenantId } });
      if (!current) {
        throw new NotFoundException(`Agreement with ID ${id} not found`);
      }
      throw staleVersionConflict({
        entity: 'AGREEMENT',
        entityId: id,
        expectedVersion,
        currentVersion: current.version,
        current: {
          agreementName: current.agreementName,
          updatedBy: current.updatedBy,
          updatedAt: current.updatedAt,
        },
      });
    }
  }

  async generateAgreementCode(
    tenantId: string,
    type: AgreementType,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `${type}-${year}-`;

    // Find the highest sequence number for this type and year
    // Include ALL records (including soft-deleted) to avoid code conflicts with unique constraint
    // The unique constraint applies to all records regardless of deletedAt
    const agreements = await this.repo
      .createQueryBuilder('agreement')
      .where('agreement.tenantId = :tenantId', { tenantId })
      .andWhere('agreement.agreementType = :type', { type })
      .andWhere('agreement.agreementCode LIKE :prefix', {
        prefix: `${prefix}%`,
      })
      .orderBy('agreement.agreementCode', 'DESC')
      .limit(1)
      .getOne();

    let sequence = 1;
    if (agreements && agreements.agreementCode) {
      const lastCode = agreements.agreementCode;
      const parts = lastCode.split('-');
      if (parts.length >= 3) {
        const lastSequence = parseInt(parts[2], 10);
        if (!isNaN(lastSequence) && lastSequence > 0) {
          sequence = lastSequence + 1;
        }
      }
    }

    const sequenceStr = String(sequence).padStart(3, '0');
    return `${prefix}${sequenceStr}`;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Kpi } from '../../../database/entities/kpi.entity';
import {
  applyVersionedUpdate,
  staleVersionConflict,
} from '../../shared/persistence/versioned-update.helper';

@Injectable()
export class KpiRepository {
  constructor(
    @InjectRepository(Kpi)
    private readonly repository: Repository<Kpi>,
  ) {}

  async findByCode(tenantId: string, kpiCode: string): Promise<Kpi | null> {
    return this.repository.findOne({ where: { tenantId, kpiCode } });
  }

  async findAllByTenant(tenantId: string, activeOnly = false): Promise<Kpi[]> {
    const where: any = { tenantId };
    if (activeOnly) {
      where.isActive = true;
    }
    return this.repository.find({
      where,
      order: { calculationOrder: 'ASC', kpiCode: 'ASC' },
    });
  }

  async findGridKpis(tenantId: string): Promise<Kpi[]> {
    return this.repository.find({
      where: { tenantId, isActive: true, showInGrid: true },
      order: { columnOrder: 'ASC', calculationOrder: 'ASC' },
    });
  }

  async findCalculableKpis(tenantId: string): Promise<Kpi[]> {
    return this.repository.find({
      where: { tenantId, isActive: true },
      order: { calculationOrder: 'ASC' },
    });
  }

  async findOne(options: any): Promise<Kpi | null> {
    return this.repository.findOne(options);
  }

  async find(options: any): Promise<Kpi[]> {
    return this.repository.find(options);
  }

  create(entity: Partial<Kpi>): Kpi {
    return this.repository.create(entity);
  }

  async save(entity: Kpi): Promise<Kpi> {
    return this.repository.save(entity);
  }

  async softRemove(entity: Kpi): Promise<Kpi> {
    return this.repository.softRemove(entity);
  }

  /**
   * T-039: CAS write for the KPI/formula-config edit path
   * (`KpiService#update` when the caller supplies `version`). `affected===0`
   * means either not-found or stale; a version-less re-read tells the two
   * apart (same contract as `PlanRepository#updateVersioned`, T-034).
   */
  async updateVersioned(
    tenantId: string,
    id: string,
    expectedVersion: number,
    data: Partial<Kpi>,
  ): Promise<Kpi> {
    const affected = await applyVersionedUpdate(
      this.repository,
      { id, tenantId },
      expectedVersion,
      data as any,
    );
    if (affected === 0) {
      const current = await this.repository.findOne({
        where: { id, tenantId },
      });
      if (!current) {
        throw new NotFoundException(`KPI with ID ${id} not found`);
      }
      throw staleVersionConflict({
        entity: 'KPI',
        entityId: id,
        expectedVersion,
        currentVersion: current.version,
        current: {
          kpiCode: current.kpiCode,
          formulaText: current.formulaText,
          calculationOrder: current.calculationOrder,
          // `T-343`: `ragGreenThreshold` → `targetRoiThreshold` (RENAME,
          // migration 1820). `ragAmberThreshold` ÖLDÜ — kadran onu girdisiz
          // bıraktı (`Z70 §2`), çakışma yükünde artık gösterilecek bir
          // değeri yok.
          targetRoiThreshold: current.targetRoiThreshold,
          isActive: current.isActive,
          updatedBy: current.updatedBy,
          updatedAt: current.updatedAt,
        },
      });
    }
    const updated = await this.repository.findOne({ where: { id, tenantId } });
    if (!updated) {
      throw new Error('KPI not found after update');
    }
    return updated;
  }

  /**
   * T-039: legacy/backward-compatible write path — no caller supplied
   * `version` (additive rollout, unlike T-034's strict mode; the KPI admin
   * screen does not send `version` yet). Updates unconditionally, like
   * before this task, but still bumps the stored `version` (single atomic
   * UPDATE, same raw-SQL increment idiom `applyVersionedUpdate` uses) so a
   * version-aware client reading afterwards sees an accurate value instead
   * of a frozen 1.
   */
  async updateUnversioned(
    tenantId: string,
    id: string,
    data: Partial<Kpi>,
  ): Promise<Kpi> {
    await this.repository.update(
      { id, tenantId } as any,
      {
        ...(data as object),
        version: () => '"version" + 1',
      } as any,
    );
    const updated = await this.repository.findOne({ where: { id, tenantId } });
    if (!updated) {
      throw new NotFoundException(`KPI with ID ${id} not found`);
    }
    return updated;
  }
}

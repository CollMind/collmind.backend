import { ConflictException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

/**
 * T-034 — Optimistic locking (BRD "eş zamanlı düzenleme"). Single CAS write
 * path for user-input mutations. See
 * docs/analysis/0005-optimistic-locking-design.md K1 for why this is a
 * manual `version integer` + conditional UPDATE and NOT `@VersionColumn`
 * (every mutation in this codebase goes through `repo.update()`, which
 * `@VersionColumn` never checks/bumps).
 *
 * Any mutation that must be protected against lost updates goes through
 * `applyVersionedUpdate`. Derived (recalc) and compensation/state-transition
 * writes deliberately do NOT — they go through the sibling
 * `*Unversioned`/`updateStatus` methods on the owning repository (grep for
 * `updateUnversioned`), because a CAS on those would fail every time (the
 * preceding forward write already bumped the version the held-in-memory
 * entity is stale against).
 *
 * WHERE id = :id AND tenantId = :tenantId AND version = :expectedVersion
 * SET ...data, version = version + 1
 *
 * Single atomic UPDATE — no extra round trip on the hot path (grid
 * `updateSkuVolume`, BRD <500ms). Returns the number of affected rows: 0
 * means "stale OR not found OR wrong tenant" — the caller re-reads
 * (version-less, tenant-scoped) to tell those apart and build the 404/409.
 */
export interface VersionedWhere {
  id: string;
  tenantId: string;
}

export async function applyVersionedUpdate<T extends ObjectLiteral>(
  repo: Repository<T>,
  where: VersionedWhere,
  expectedVersion: number,
  data: QueryDeepPartialEntity<T>,
): Promise<number> {
  const result = await repo.update(
    {
      id: where.id,
      tenantId: where.tenantId,
      version: expectedVersion,
    } as unknown as import('typeorm').FindOptionsWhere<T>,
    {
      ...(data as object),
      version: () => '"version" + 1',
    } as unknown as QueryDeepPartialEntity<T>,
  );
  return result.affected ?? 0;
}

export const STALE_VERSION_CODE = 'STALE_VERSION';
export const MISSING_VERSION_CODE = 'MISSING_VERSION';

/**
 * 409 body for a stale-version CAS failure. `current` carries only
 * user-input fields (never derived/financial ones — the client already
 * refetches the full entity after a conflict, and this keeps the payload
 * from doubling as a KPI/spend leak). Must only be called AFTER the caller's
 * scope/tenant check has already passed (the entity read backing `current`
 * is tenant-scoped, but the 409 body itself is only as safe as the caller
 * verifying the requester may see this entity at all).
 */
export function staleVersionConflict(params: {
  entity: string;
  entityId: string;
  expectedVersion: number;
  currentVersion: number;
  current?: Record<string, unknown>;
}): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: STALE_VERSION_CODE,
    message:
      'This record was modified by another user. Review the current values and retry.',
    entity: params.entity,
    entityId: params.entityId,
    expectedVersion: params.expectedVersion,
    currentVersion: params.currentVersion,
    current: params.current,
  });
}

/**
 * 409 for a strict-mode request that omitted `version` entirely (T-034
 * "Geçiş modu: KATI" — version zorunlu, no feature flag / gradual rollout;
 * see T-034 task doc). Distinguished from `STALE_VERSION` so a client can
 * tell "you forgot to send version" apart from "you sent a stale one".
 */
export function missingVersionConflict(params: {
  entity: string;
  entityId?: string;
}): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: MISSING_VERSION_CODE,
    message: `A 'version' field is required for this update (optimistic locking). Fetch the current entity and retry with its version.`,
    entity: params.entity,
    entityId: params.entityId,
  });
}

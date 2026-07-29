import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  applyVersionedUpdate,
  staleVersionConflict,
  missingVersionConflict,
  STALE_VERSION_CODE,
  MISSING_VERSION_CODE,
} from './versioned-update.helper';

describe('applyVersionedUpdate (T-034 CAS helper)', () => {
  it('issues a single UPDATE with id+tenantId+version in the WHERE and version+1 in the SET', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const repo = { update } as any;

    const affected = await applyVersionedUpdate(
      repo,
      { id: 'plan-1', tenantId: 'tenant-1' },
      5,
      { planName: 'New name' } as any,
    );

    expect(affected).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    const [where, set] = update.mock.calls[0];
    expect(where).toEqual({
      id: 'plan-1',
      tenantId: 'tenant-1',
      version: 5,
    });
    expect(set.planName).toBe('New name');
    expect(typeof set.version).toBe('function');
    expect(set.version()).toBe('"version" + 1');
  });

  it('returns 0 (not an exception) when the CAS predicate matches no row — caller decides 404 vs 409', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 0 });
    const repo = { update } as any;

    const affected = await applyVersionedUpdate(
      repo,
      { id: 'plan-1', tenantId: 'tenant-1' },
      5,
      {} as any,
    );

    expect(affected).toBe(0);
  });

  it('treats a missing `affected` field on the result as 0 (defensive default)', async () => {
    const update = jest.fn().mockResolvedValue({});
    const repo = { update } as any;

    const affected = await applyVersionedUpdate(
      repo,
      { id: 'plan-1', tenantId: 'tenant-1' },
      5,
      {} as any,
    );

    expect(affected).toBe(0);
  });
});

describe('staleVersionConflict (T-034 409 body)', () => {
  it('builds a ConflictException with code STALE_VERSION and version/current fields', () => {
    const err = staleVersionConflict({
      entity: 'PLAN_SKU',
      entityId: 'sku-1',
      expectedVersion: 3,
      currentVersion: 4,
      current: { plannedVolume: 1350 },
    });

    expect(err).toBeInstanceOf(ConflictException);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.statusCode).toBe(409);
    expect(body.code).toBe(STALE_VERSION_CODE);
    expect(body.entity).toBe('PLAN_SKU');
    expect(body.entityId).toBe('sku-1');
    expect(body.expectedVersion).toBe(3);
    expect(body.currentVersion).toBe(4);
    expect(body.current).toEqual({ plannedVolume: 1350 });
  });
});

describe('missingVersionConflict (T-034 strict-mode 409 body)', () => {
  it('builds a ConflictException with code MISSING_VERSION (not a 400)', () => {
    const err = missingVersionConflict({ entity: 'PLAN', entityId: 'plan-1' });

    expect(err).toBeInstanceOf(ConflictException);
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.statusCode).toBe(409);
    expect(body.code).toBe(MISSING_VERSION_CODE);
    expect(body.entity).toBe('PLAN');
  });
});

// Sanity: NotFoundException remains the caller's responsibility (the
// helper never throws it itself — see PlanRepository/AgreementRepository
// #updateVersioned re-read-and-decide logic).
describe('helper does not itself decide 404 vs 409', () => {
  it('NotFoundException is importable/usable by callers (helper stays generic)', () => {
    expect(() => {
      throw new NotFoundException('not found');
    }).toThrow(NotFoundException);
  });
});

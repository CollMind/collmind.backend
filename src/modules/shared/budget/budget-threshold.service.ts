import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BudgetAlertConfiguration,
  AlertLevel,
} from '../../../database/entities/budget-alert-configuration.entity';
import { UtilizationStatus } from '../finance-reporting/dto/budget-utilization.dto';
import { diagnosticsOf } from '../../../common/errors/diagnostics';

export interface BudgetThresholds {
  warning: number;
  critical: number;
  exceeded: number;
}

/**
 * T-101: where the thresholds in use actually came from.
 *
 * Before this existed, four different situations produced the same object and
 * nothing downstream could tell them apart — and the camouflage was total, because
 * the seeded configuration happens to hold exactly the hardcoded defaults
 * (80/95/100, measured). A fallback fired or did not fire and no test, log or user
 * complaint could distinguish the two. It would first become visible on the day a
 * tenant configures something different, which is precisely the day it matters.
 *
 * `source` says what was USED; `reason` says why it was not the configuration.
 * Keeping them apart matters: the product owner's shorthand was
 * `'config' | 'default' | 'partial'`, but `partial` is a cause, not a result — a
 * partial configuration now yields DEFAULTS (see below), so it belongs in `reason`.
 *
 * `unavailable` is deliberately NOT folded into `default`. "Nothing is configured"
 * and "we could not read the configuration" are different facts, and merging them
 * is the exact defect T-098 removed one layer up: an error wearing the costume of
 * data.
 */
export type ThresholdSource = 'config' | 'default' | 'unavailable';

export type ThresholdFallbackReason =
  | 'no-configuration'
  | 'partial-configuration'
  | 'invalid-value'
  | 'duplicate-level'
  | 'unordered'
  | 'read-failed';

export interface ResolvedThresholds extends BudgetThresholds {
  readonly source: ThresholdSource;
  /** Absent when `source === 'config'`. */
  readonly reason?: ThresholdFallbackReason;
}

/**
 * T-101 (K4): the ordering the product depends on. `toStatus` reads
 * `percent >= critical → RED` before `percent >= warning → AMBER`, so a set with
 * `warning > critical` makes 75% RED while never being AMBER — a state no
 * configuration could legitimately express.
 *
 * ⚠️ This cannot be a DB CHECK in the current schema, and that is a measurement,
 * not a preference: `budget_alert_configurations` stores ONE ROW PER ALERT LEVEL,
 * so the invariant spans three rows and a per-row CHECK cannot see it. The schema
 * can still close two other holes — per-row bounds and one-row-per-level — and
 * those belong in a migration; the ordering is enforced here.
 */
function isOrdered(t: BudgetThresholds): boolean {
  return t.warning <= t.critical && t.critical <= t.exceeded;
}

const DEFAULT_THRESHOLDS: BudgetThresholds = {
  warning: 80,
  critical: 95,
  exceeded: 100,
};

/** Short-lived in-memory cache: avoids repeated DB hits within a single request burst. */
const CACHE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  thresholds: ResolvedThresholds;
  expiresAt: number;
}

@Injectable()
export class BudgetThresholdService {
  private readonly logger = new Logger(BudgetThresholdService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(BudgetAlertConfiguration)
    private readonly alertConfigRepo: Repository<BudgetAlertConfiguration>,
  ) {}

  /**
   * Returns BudgetThresholds for the given tenant.
   * Reads from BudgetAlertConfiguration; falls back to {80, 95, 100} if no rows found.
   * Results are cached per-tenant for CACHE_TTL_MS to avoid N+1 DB hits.
   * Cross-tenant isolation is guaranteed: cache key is tenantId.
   */
  async getThresholds(tenantId: string): Promise<ResolvedThresholds> {
    const entry = this.cache.get(tenantId);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.thresholds;
    }

    let configs;
    try {
      configs = await this.alertConfigRepo.find({
        where: { tenantId, isActive: true },
      });
    } catch (err) {
      // NOT cached: a read failure is transient, and caching it would extend one
      // bad moment across the TTL. Also not reported as `default` — see the
      // ResolvedThresholds doc for why those two facts stay apart.
      this.logger.error(
        `Failed to load BudgetAlertConfiguration for tenant ${tenantId}; using defaults`,
        diagnosticsOf(err),
      );
      return {
        ...DEFAULT_THRESHOLDS,
        source: 'unavailable',
        reason: 'read-failed',
      };
    }

    return this.cacheAndReturn(tenantId, this.resolve(tenantId, configs ?? []));
  }

  /**
   * T-101 (K3): ALL THREE FROM THE CONFIGURATION, OR ALL THREE FROM THE DEFAULTS.
   * Never a mixture.
   *
   * The previous version seeded the result with defaults and overwrote whatever the
   * configuration supplied, so a tenant with only `warning=60` configured received
   * `{60, 95, 100}` — a set that is neither the configuration nor the defaults, and
   * that nothing marked as such. Worse, mixing two internally consistent sets can
   * produce an inconsistent third: measured, a single invalid value yielded
   * `{warning: 80, critical: 70}`, where 75% is RED without ever being AMBER.
   *
   * So a configuration is taken as a whole or not at all. Every rejection carries
   * the reason it was rejected.
   */
  private resolve(
    tenantId: string,
    configs: BudgetAlertConfiguration[],
  ): ResolvedThresholds {
    const fallback = (reason: ThresholdFallbackReason): ResolvedThresholds => ({
      ...DEFAULT_THRESHOLDS,
      source: 'default',
      reason,
    });

    if (configs.length === 0) {
      this.logger.debug(
        `No active BudgetAlertConfiguration for tenant ${tenantId}; using defaults`,
      );
      return fallback('no-configuration');
    }

    const byLevel = new Map<AlertLevel, number>();
    for (const config of configs) {
      // Duplicates are refused rather than resolved: the query has no ORDER BY, so
      // "the last one wins" would mean "whichever Postgres happened to return
      // last" — a threshold that could differ between two identical requests.
      //
      // UNREACHABLE TODAY, and the reason is worth stating precisely. An earlier
      // version of this comment claimed the table "has no unique constraint on
      // (tenant_id, alert_level)". That was wrong: `IDX_budget_alert_config_tenant_level`,
      // a UNIQUE index over exactly that pair, has existed since migration
      // 1771169825000.
      //
      // The claim was wrong because it was measured in `pg_constraint` alone, and
      // TypeORM's `@Index({ unique: true })` creates an INDEX, not a constraint —
      // so it never appears there. Absence in one catalogue is not absence.
      //
      // Kept as defence: the guarantee lives in an index a future migration could
      // drop or narrow, and this branch costs one Map lookup.
      if (byLevel.has(config.alertLevel)) {
        this.logger.warn(
          `Duplicate active BudgetAlertConfiguration for alertLevel=${config.alertLevel} tenant=${tenantId}; using defaults`,
        );
        return fallback('duplicate-level');
      }
      const pct = Number(config.thresholdPercent);
      if (!Number.isFinite(pct) || pct <= 0) {
        this.logger.warn(
          `Invalid thresholdPercent (${config.thresholdPercent}) for alertLevel=${config.alertLevel} tenant=${tenantId}; using defaults`,
        );
        return fallback('invalid-value');
      }
      byLevel.set(config.alertLevel, pct);
    }

    const warning = byLevel.get(AlertLevel.WARNING_80);
    const critical = byLevel.get(AlertLevel.CRITICAL_95);
    const exceeded = byLevel.get(AlertLevel.EXCEEDED_100);
    if (
      warning === undefined ||
      critical === undefined ||
      exceeded === undefined
    ) {
      this.logger.warn(
        `Incomplete BudgetAlertConfiguration for tenant ${tenantId}; using defaults`,
      );
      return fallback('partial-configuration');
    }

    const candidate = { warning, critical, exceeded };
    if (!isOrdered(candidate)) {
      this.logger.warn(
        `BudgetAlertConfiguration for tenant ${tenantId} is not ordered ` +
          `(${warning}/${critical}/${exceeded}); using defaults`,
      );
      return fallback('unordered');
    }

    return { ...candidate, source: 'config' };
  }

  /**
   * Maps a utilization percentage to a UtilizationStatus.
   *
   * BRD boundary rules:
   *   percent < warning         → GREEN
   *   warning <= percent < critical → AMBER
   *   percent >= critical        → RED
   */
  toStatus(percent: number, thresholds: BudgetThresholds): UtilizationStatus {
    if (percent >= thresholds.critical) return UtilizationStatus.RED;
    if (percent >= thresholds.warning) return UtilizationStatus.AMBER;
    return UtilizationStatus.GREEN;
  }

  /**
   * Returns true when percent has reached or exceeded the "exceeded" threshold.
   */
  isExceeded(percent: number, thresholds: BudgetThresholds): boolean {
    return percent >= thresholds.exceeded;
  }

  /**
   * Invalidate the cache entry for a tenant (e.g. after config update).
   * TODO: BudgetAlertConfiguration güncelleyen admin endpoint eklenirse
   *       invalidateCache(tenantId) buna bağlanmalı.
   */
  invalidateCache(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private cacheAndReturn(
    tenantId: string,
    thresholds: ResolvedThresholds,
  ): ResolvedThresholds {
    this.cache.set(tenantId, {
      thresholds,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return thresholds;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BudgetAlertConfiguration,
  AlertLevel,
} from '../../../database/entities/budget-alert-configuration.entity';
import { UtilizationStatus } from '../finance-reporting/dto/budget-utilization.dto';

export interface BudgetThresholds {
  warning: number;
  critical: number;
  exceeded: number;
}

const DEFAULT_THRESHOLDS: BudgetThresholds = {
  warning: 80,
  critical: 95,
  exceeded: 100,
};

/** Short-lived in-memory cache: avoids repeated DB hits within a single request burst. */
const CACHE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry {
  thresholds: BudgetThresholds;
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
  async getThresholds(tenantId: string): Promise<BudgetThresholds> {
    // Cache hit?
    const entry = this.cache.get(tenantId);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.thresholds;
    }

    try {
      const configs = await this.alertConfigRepo.find({
        where: { tenantId, isActive: true },
      });

      if (!configs || configs.length === 0) {
        this.logger.debug(
          `No active BudgetAlertConfiguration for tenant ${tenantId}; using defaults`,
        );
        return this.cacheAndReturn(tenantId, { ...DEFAULT_THRESHOLDS });
      }

      const thresholds: BudgetThresholds = { ...DEFAULT_THRESHOLDS };

      for (const config of configs) {
        const pct = Number(config.thresholdPercent);
        if (isNaN(pct) || pct <= 0) {
          this.logger.warn(
            `Invalid thresholdPercent (${config.thresholdPercent}) for alertLevel=${config.alertLevel} tenant=${tenantId}; keeping default`,
          );
          continue;
        }
        switch (config.alertLevel) {
          case AlertLevel.WARNING_80:
            thresholds.warning = pct;
            break;
          case AlertLevel.CRITICAL_95:
            thresholds.critical = pct;
            break;
          case AlertLevel.EXCEEDED_100:
            thresholds.exceeded = pct;
            break;
        }
      }

      return this.cacheAndReturn(tenantId, thresholds);
    } catch (err) {
      this.logger.error(
        `Failed to load BudgetAlertConfiguration for tenant ${tenantId}; using defaults`,
        err,
      );
      return { ...DEFAULT_THRESHOLDS };
    }
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
    thresholds: BudgetThresholds,
  ): BudgetThresholds {
    this.cache.set(tenantId, {
      thresholds,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return thresholds;
  }
}

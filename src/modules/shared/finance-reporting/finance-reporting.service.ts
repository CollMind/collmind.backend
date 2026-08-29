import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../../../database/entities/plan.entity';
import { PlanFu } from '../../../database/entities/plan.entity';
import { PlanMechanicValue } from '../../../database/entities/plan-mechanic-value.entity';
import { MechanicSpendBreakdown } from '../../../database/entities/mechanic-spend-breakdown.entity';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
  BudgetSpendType,
} from '../../../database/entities/budget-envelope.entity';
import { BudgetSummaryView } from '../../../database/entities/budget-summary.view-entity';
import { UserRole } from '../../../database/entities/user.entity';
import { BudgetRepository } from '../budget/budget.repository';
import {
  BudgetThresholdService,
  BudgetThresholds,
} from '../budget/budget-threshold.service';
import { AccessScopeService } from '../access-scope/access-scope.service';
import {
  ReportFilters,
  PaginationParams,
  ReportGranularity,
  ComparisonType,
} from './dto/report-filters.dto';
import {
  BudgetUtilizationReport,
  BudgetSummary,
  UtilizationStatus,
} from './dto/budget-utilization.dto';
import { TrendReport, TrendDataPoint } from './dto/trend-report.dto';
import {
  CompositionReport,
  CompositionSlice,
} from './dto/composition-report.dto';
import {
  PaginatedPlanReport,
  PlanPerformanceRow,
} from './dto/plan-performance.dto';
import { RiskReport, RiskPlan } from './dto/risk-report.dto';
import {
  MechanicReport,
  MechanicEffectiveness,
} from './dto/mechanic-effectiveness.dto';
import { VarianceReport, VarianceItem } from './dto/variance-report.dto';
import { CashFlowReport, CashFlowProjection } from './dto/cash-flow-report.dto';
import {
  BudgetVarianceReport,
  BudgetVarianceItem,
  BudgetVarianceGroup,
  BudgetVarianceQueryDto,
} from './dto/budget-variance-report.dto';
import {
  moneyFromNumericString,
  moneyToMajorUnits,
} from '../../../common/numeric/money';
import { addMonthsClamped } from '../../../common/date/add-months';

/**
 * A `numeric(18,2)` column value as a number in TRY — T-093.
 *
 * ⚠️ STALE PREMISE, CORRECTED (review, 2026-08-15): this comment used to say
 * "these columns declare no transformer, so TypeORM hands back a STRING". That
 * is no longer true for any of the three columns `spendOf` is called on —
 * `pmv.calculatedSpend` now carries `MoneyTransformer`
 * (`plan-mechanic-value.entity.ts`), and `planSku.plannedLtaOnInvoiceSpend` /
 * `plannedLtaOffInvoiceSpend` already carried `DecimalTransformer`
 * (`plan.entity.ts`) — the latter two were WRONG about the entity even before
 * this turn, not newly changed by it. All three now arrive as `number`.
 *
 * `spendOf` is kept rather than removed: its signature (`number | string`) and
 * its `String(raw)` conversion make it correct for EITHER shape, so it stays
 * safe if a future column on this path ever loses its transformer, and its 7
 * call sites do not need to change. What follows below is the ORIGINAL defect
 * this function was written to close, kept for the historical record — it is
 * no longer reachable through these three columns, but the reasoning (why
 * `Number()`-based concatenation is a live-route defect, not a Domain B
 * excuse) still applies to any column that DOES arrive as a string.
 *
 * These columns declare no transformer, so TypeORM hands back a STRING even
 * though TypeScript types them `number`. `0 + "100.00"` is concatenation, and
 * with two rows an accumulator became `"0100.0050.00"` — a string in a numeric
 * DTO field, on two live GET routes (`/finance-reporting/spend-trend` and
 * `/finance-reporting/budget-at-risk`). With a SINGLE row it worked by accident,
 * because `Number("0100.00")` is 100; the corruption needed a second row. Same
 * shape as T-089 and T-091.
 *
 * "This is Domain B so float is fine" does NOT excuse it. The Domain A/B split
 * is about representation PRECISION — `10.1799` where `10.18` was meant. A
 * concatenated string is not an imprecise number, it is not a number at all, and
 * Domain B expects numbers just as much as Domain A does.
 *
 * The `|| 0` that used to sit at each of these call sites is gone rather than
 * ported: all three columns are NOT NULL (measured), so it could never fire —
 * it was dead code in the shape CLAUDE.md §2.5 forbids, quietly promising a
 * default that no path could reach.
 *
 * `moneyFromNumericString` is still used here, but not for the reason this
 * paragraph originally gave.
 *
 * ⚠️ STALE PREMISE, CORRECTED (review, T-197/T-221, 2026-08-15): this used to
 * say the point of routing through `moneyFromNumericString` "rather than
 * `Number()`" was to avoid IEEE-754 on the way in. That is no longer true for
 * any of the three columns above — `raw` already passed through `Number()`
 * once, inside the entity's transformer (see the correction above), before
 * `spendOf` ever sees it; the pg driver's exact decimal string is gone by
 * this point, so parsing `String(raw)` digit-wise here recovers nothing that
 * was not already settled. What this call still does, and the reason it is
 * kept: reject anything that is not a clean `-?\d+(\.\d*)?` with an explicit
 * throw instead of a silent NaN (§2.5), and produce a branded `MoneyMinor`
 * integer for the accumulator. All three columns are scale 2 (measured), so
 * it cannot throw on legitimate data.
 */
function spendOf(raw: number | string): number {
  return moneyToMajorUnits(moneyFromNumericString(String(raw)));
}

/**
 * First instant of the UTC calendar month `d` falls in.
 *
 * ⛔ Z63 §2 (iii) — THIS LIVES HERE, NOT IN `common/date/add-months.ts`.
 * Adding months is general arithmetic and belongs to the shared helper;
 * "a reporting bucket is snapped to the calendar month" is the SEMANTICS OF
 * THIS REPORT. Pushing it into the helper would make the helper the prisoner
 * of one report — the next caller ("weekly trend") needs the same arithmetic
 * with a different normalisation.
 *
 * UTC on purpose, matching `addMonthsClamped` and the `toISOString()` that
 * formats the label: the query's `startDate` arrives as an ISO `YYYY-MM-DD`
 * string, which `new Date()` parses at UTC midnight, and the defect class
 * `common/date/excel-serial-date.ts` documents (reading LOCAL components and
 * writing a UTC string) is exactly how a bucket label slips a day.
 */
function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

@Injectable()
export class FinanceReportingService {
  private readonly logger = new Logger(FinanceReportingService.name);

  constructor(
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @InjectRepository(PlanFu)
    private readonly planFuRepository: Repository<PlanFu>,
    @InjectRepository(PlanMechanicValue)
    private readonly planMechanicValueRepository: Repository<PlanMechanicValue>,
    @InjectRepository(MechanicSpendBreakdown)
    private readonly mechanicSpendBreakdownRepository: Repository<MechanicSpendBreakdown>,
    @InjectRepository(BudgetEnvelope)
    private readonly budgetEnvelopeRepository: Repository<BudgetEnvelope>,
    private readonly budgetThresholdService: BudgetThresholdService,
    private readonly budgetRepository: BudgetRepository,
    private readonly accessScopeService: AccessScopeService,
  ) {}

  /**
   * Get budget utilization report.
   *
   * T-270/Z21 (A1 + A2): throws when the envelope+filter combination matches
   * NO data at all — a caller must not render an all-zero/GREEN report for a
   * period with no budget data (§2.5 sessiz sıfır, §2.3 "kapsama yoksa renk
   * yok"). `DashboardService#getSummary` already has a dedicated catch branch
   * for exactly this (`dashboard-summary.dto.ts:76-105`,
   * `budgetUtilizationStatus = 'unavailable'`) — this throw is the branch
   * that was missing to reach it. `getBudgetAtRisk`/`getVarianceAnalysis`
   * below do NOT go through this throwing entry point — they call
   * `computeBudgetUtilization` directly (see its own doc comment for why).
   */
  async getBudgetUtilization(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<BudgetUtilizationReport> {
    const { report, hasData } = await this.computeBudgetUtilization(
      tenantId,
      filters,
    );
    if (!hasData) {
      throw new NotFoundException(
        'No budget envelope data found for the requested period/filters — a utilization figure cannot be computed',
      );
    }
    return report;
  }

  /**
   * T-270/Z21 (A2): `budget_allocations` retired as a K-2.2.3 violation — a
   * SECOND envelope-resolution path with its own (cplId + channel + category
   * + date-range) dimension set, measured to have 0 rows in every tenant
   * (Z21 karar kaydı). `budget_envelopes` + `v_budget_summary` is now the
   * ONLY source this method reads.
   *
   * `cplId` is DELIBERATELY not a filter dimension here: K-2.2.1 defines an
   * envelope as Kanal × Kategori × Dönem, and A7 places CPL in the SCOPE
   * layer, not the budget layer — carrying it as a query dimension is
   * exactly the "eksen ihlali" Z21 rejected for `budget_allocations`.
   *
   * `filters.cplIds` — the one scope dimension `DashboardService#getSummary`
   * forwards for a CPL-scoped PLANNER — has no home on `BudgetEnvelope` (no
   * `cplId` column) and is NOT applied here. This method does not silently
   * narrow AND does not silently widen: it simply has no cplId predicate to
   * apply, same as before A2 it had one that a dead, always-empty table made
   * moot.
   *
   * T-272/Z22: an earlier revision (T-270/Z21) had `DashboardService` skip
   * calling this method entirely for a CPL-scoped caller, reading the
   * missing dimension as a reason to fail closed. That was reversed —
   * `docs/decisions/PLAN_BUTCE_NETLESTIRME.md` `netleştirme-1` requires a
   * CPL-scoped Planner to SEE envelope fill state before submitting (a
   * visibility requirement, not an access-control one), and A7 makes the
   * budget figure CPL-axis-insensitive BY DEFINITION — so there is no
   * restriction here to fail closed on in the first place. Every caller,
   * scoped or not, now reaches this method and gets the same tenant-wide
   * figure; `filters.cplIds` is accepted but inert on this path.
   */
  private async computeBudgetUtilization(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<{ report: BudgetUtilizationReport; hasData: boolean }> {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    // Fetch thresholds once outside any loop (config-driven, tenant-scoped)
    const thresholds =
      await this.budgetThresholdService.getThresholds(tenantId);

    const qb = this.budgetEnvelopeRepository
      .createQueryBuilder('envelope')
      .where('envelope.tenantId = :tenantId', { tenantId })
      .andWhere('envelope.deletedAt IS NULL')
      .andWhere('envelope.status = :status', {
        status: BudgetEnvelopeStatus.ACTIVE,
      });

    // Period-range match. `envelope.period` is a free-form string column
    // (entity JSDoc examples: "Jan", "Q1", "2024"), but every row measured
    // in this tenant (2026-08-23, main.budget_envelopes) uses "YYYY-MM" —
    // lexicographic comparison on that zero-padded shape is chronological.
    // This is a reporting-only RANGE match, and a deliberately DIFFERENT
    // query shape from `findEnvelopeByDimensions`'s exact/year-LIKE SINGLE-
    // envelope resolution: that function answers "which one envelope does a
    // reservation write land on" (K-2.2.3's concern); this one answers "sum
    // every envelope whose period falls in this window" — a different
    // question, not a second, competing answer to the same one.
    const startPeriod = startDate.toISOString().slice(0, 7);
    const endPeriod = endDate.toISOString().slice(0, 7);
    qb.andWhere(
      'envelope.period >= :startPeriod AND envelope.period <= :endPeriod',
      { startPeriod, endPeriod },
    );

    // Channel/category use the SAME dedicated-column resolution as this
    // file's `getBudgetVarianceReport` (below) — one derivation method for
    // BudgetEnvelope dimensions in this file, not a second one. (Measured:
    // today's seeded envelopes carry channel/category ONLY in `metadata`,
    // not in these dedicated columns — same limitation `getBudgetVarianceReport`
    // already has; not introduced here.)
    if (filters.channels && filters.channels.length > 0) {
      qb.andWhere('envelope.channel IN (:...channels)', {
        channels: filters.channels,
      });
    }
    if (filters.categories && filters.categories.length > 0) {
      qb.andWhere('envelope.category IN (:...categories)', {
        categories: filters.categories,
      });
    }

    const envelopes = await qb.getMany();
    const hasData = envelopes.length > 0;

    const summaries = hasData
      ? await this.budgetRepository.getAllBudgetSummaries(tenantId)
      : [];
    const summaryByEnvelopeId = new Map(
      summaries.map((s) => [s.envelopeId, s]),
    );

    // Aggregate totals
    let totalOnInvoiceAllocated = 0;
    let totalOnInvoiceUtilized = 0;
    let totalOnInvoiceReserved = 0;
    let totalOffInvoiceAllocated = 0;
    let totalOffInvoiceUtilized = 0;
    let totalOffInvoiceReserved = 0;
    // T-270/Z21 pinned behaviour-diff — UNSPLIT On/Off (ADR 0004 §5.5): an
    // UNSPLIT envelope (`spendType IS NULL`) is ONE shared pool for both
    // On- and Off-Invoice spend — `BudgetService#checkPlanBudgetAvailability`
    // measures it as a single combined amount, never split (§5.5 "birleşik
    // kural"). Attributing an UNSPLIT envelope's figures to a fabricated
    // on/off split here would either double-count it in `total` or invent a
    // division the data does not carry (§2.5 sessiz sıfır — a guessed split
    // is a guessed number). It is counted ONLY in this combined pool, which
    // feeds `total` but neither `onInvoice` nor `offInvoice`. Measured
    // 2026-08-23: 4/4 seeded envelopes are UNSPLIT, so today `onInvoice` and
    // `offInvoice` both report `allocated: 0` while `total` shows the real
    // ₺1,600,000 — an honest "no typed split exists yet" rather than a
    // fabricated one, not a residual defect of this change.
    let poolAllocated = 0;
    let poolUtilized = 0;
    let poolReserved = 0;

    for (const envelope of envelopes) {
      const summary = summaryByEnvelopeId.get(envelope.id);
      if (!summary) {
        this.logger.warn(
          `Envelope ${envelope.id} (${envelope.code}) has no v_budget_summary row — skipped from budget-utilization`,
        );
        continue;
      }
      const allocated = Number(summary.allocatedAmount) || 0;
      const reserved = Number(summary.reservedAmount) || 0;
      const consumed = Number(summary.consumedAmount) || 0;

      if (envelope.spendType === BudgetSpendType.ON_INVOICE) {
        totalOnInvoiceAllocated += allocated;
        totalOnInvoiceUtilized += consumed;
        totalOnInvoiceReserved += reserved;
      } else if (envelope.spendType === BudgetSpendType.OFF_INVOICE) {
        totalOffInvoiceAllocated += allocated;
        totalOffInvoiceUtilized += consumed;
        totalOffInvoiceReserved += reserved;
      } else {
        poolAllocated += allocated;
        poolUtilized += consumed;
        poolReserved += reserved;
      }
    }

    const onInvoiceAvailable =
      totalOnInvoiceAllocated - totalOnInvoiceUtilized - totalOnInvoiceReserved;
    const offInvoiceAvailable =
      totalOffInvoiceAllocated -
      totalOffInvoiceUtilized -
      totalOffInvoiceReserved;
    const onInvoiceUtilizationPercent =
      totalOnInvoiceAllocated > 0
        ? ((totalOnInvoiceUtilized + totalOnInvoiceReserved) /
            totalOnInvoiceAllocated) *
          100
        : 0;
    const offInvoiceUtilizationPercent =
      totalOffInvoiceAllocated > 0
        ? ((totalOffInvoiceUtilized + totalOffInvoiceReserved) /
            totalOffInvoiceAllocated) *
          100
        : 0;

    const onInvoice: BudgetSummary = {
      allocated: totalOnInvoiceAllocated,
      utilized: totalOnInvoiceUtilized,
      reserved: totalOnInvoiceReserved,
      available: onInvoiceAvailable,
      utilizationPercent: onInvoiceUtilizationPercent,
      status: this.getUtilizationStatus(
        onInvoiceUtilizationPercent,
        thresholds,
      ),
    };

    const offInvoice: BudgetSummary = {
      allocated: totalOffInvoiceAllocated,
      utilized: totalOffInvoiceUtilized,
      reserved: totalOffInvoiceReserved,
      available: offInvoiceAvailable,
      utilizationPercent: offInvoiceUtilizationPercent,
      status: this.getUtilizationStatus(
        offInvoiceUtilizationPercent,
        thresholds,
      ),
    };

    const totalAllocated =
      totalOnInvoiceAllocated + totalOffInvoiceAllocated + poolAllocated;
    const totalUtilized =
      totalOnInvoiceUtilized + totalOffInvoiceUtilized + poolUtilized;
    const totalReserved =
      totalOnInvoiceReserved + totalOffInvoiceReserved + poolReserved;
    const totalAvailable = totalAllocated - totalUtilized - totalReserved;
    const totalUtilizationPercent =
      totalAllocated > 0
        ? ((totalUtilized + totalReserved) / totalAllocated) * 100
        : 0;

    const total: BudgetSummary = {
      allocated: totalAllocated,
      utilized: totalUtilized,
      reserved: totalReserved,
      available: totalAvailable,
      utilizationPercent: totalUtilizationPercent,
      status: this.getUtilizationStatus(totalUtilizationPercent, thresholds),
    };

    // byCpl: CPL is not an envelope dimension (K-2.2.1/A7, Z21) — not
    // computable under the envelope model, unlike under the retired
    // `budget_allocations` shape. Always `undefined` (an already-optional
    // DTO field, `ApiPropertyOptional`).
    const byChannel =
      filters.channels && filters.channels.length > 0
        ? undefined
        : this.aggregateEnvelopesByDimension(
            envelopes,
            summaryByEnvelopeId,
            thresholds,
            (e) => e.channel ?? undefined,
          ).map(({ key, onInvoice: on, offInvoice: off }) => ({
            channel: key,
            onInvoice: on,
            offInvoice: off,
          }));
    const byCategory =
      filters.categories && filters.categories.length > 0
        ? undefined
        : this.aggregateEnvelopesByDimension(
            envelopes,
            summaryByEnvelopeId,
            thresholds,
            (e) => e.category ?? undefined,
          ).map(({ key, onInvoice: on, offInvoice: off }) => ({
            category: key,
            onInvoice: on,
            offInvoice: off,
          }));

    return {
      report: {
        onInvoice,
        offInvoice,
        total,
        periodStart: startDate.toISOString().split('T')[0],
        periodEnd: endDate.toISOString().split('T')[0],
        byCpl: undefined,
        byChannel,
        byCategory,
      },
      hasData,
    };
  }

  /**
   * Get spend trend report.
   *
   * ⛔ KOVA TANIMI — MONTHLY (Z63/`T-329`, ürün sahibi hükmü `(c)`), TEK CÜMLE:
   *
   *   **Aylık bir kova BİR TAKVİM AYIDIR: sınırları ayın 1'i, etiketi o aydır,
   *   ve uç kovalar KISMİ olabilir** — 15 Ocak'ta başlayan bir sorgu, 15-31'i
   *   kapsayan ama etiketi yine "Ocak" olan bir kova üretir.
   *
   * Gerekçe ürün tarafında: *"aylık trend"* kullanıcı için ***"Şubat'ta ne
   * harcandı"*** sorusudur — *"31 Ocak'tan 28 Şubat'a kayan pencerede ne
   * harcandı"* değil. Bağımsız teyit: demo-Excel'in `Fund Utilization Report`
   * kova yapısı da `Jan`/`Feb`/`Mar` kolonlarıdır (atadan gelen model de
   * takvim-ayı).
   *
   * ⛔ DÜZELTİLEN KUSUR (`T-329`, düzeltmeden ÖNCE ölçüldü):
   *
   *     periodEnd.setMonth(periodEnd.getMonth() + 1);      // taşıyor
   *     currentDate.setMonth(currentDate.getMonth() + 1);  // ve BİRİKİYOR
   *
   *     startDate=2026-01-31, endDate=2026-06-30
   *       kovalar -> 2026-01-31 · 2026-03-03 · 2026-04-03 · 2026-05-03 · 2026-06-03
   *       ⛔ ŞUBAT HİÇ YOK — ve Şubat'ın harcaması yok olmuyor, 31 gün
   *          GENİŞLEMİŞ Ocak kovasına KATLANIYOR (ölçüldü: Ocak 100+200=300).
   *       Sapma birikimli: kovalar ayın 3'üne kayıyor ve ORADA KALIYOR.
   *     startDate=2026-01-28 (poz. kontrol) -> her ay yerinde; `setMonth`
   *       yalnız başlangıç günü hedef ayda YOKSA taşar, yani kusur ayın ~28
   *       gününde uykuda.
   *
   * ⚠️ Ay aritmetiği `common/date/add-months.ts`'ten (`addMonthsClamped`,
   * `T-328`) gelir; takvim-ayı normalleştirmesi ORAYA GÖMÜLMEZ (Z63 §2 iii):
   * yarın "haftalık trend" aynı yardımcıyı FARKLI bir normalleştirmeyle
   * kullanacak — semantik RAPORUN, aritmetik yardımcının.
   *
   * ⚠️ DAILY/WEEKLY dalları bilerek dokunulmadı: gün ekleme `setDate` ile
   * taşmaz (ay uzunluğuna bakmaz), ve o granülaritelerde kova = pencerenin
   * başlangıcından itibaren sabit uzunlukta bir dilimdir — takvim hizası
   * onların sözleşmesi değil (ölçüldü `T-329`, `§7.1`).
   */
  async getSpendTrend(
    tenantId: string,
    filters: ReportFilters,
    granularity: ReportGranularity,
  ): Promise<TrendReport> {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    // Get plans in the period
    const plans = await this.getFilteredPlans(tenantId, filters);

    // Group by granularity
    const dataPoints: TrendDataPoint[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const periodStart = new Date(currentDate);
      let periodEnd: Date;
      // The bucket's LABEL. For daily/weekly it is the bucket's own start; for
      // monthly it is the CALENDAR MONTH the bucket belongs to, which is not
      // the same date when the edge bucket is partial (see the class doc).
      let periodLabel = periodStart;

      if (granularity === ReportGranularity.DAILY) {
        periodEnd = new Date(currentDate);
        periodEnd.setDate(periodEnd.getDate() + 1);
        currentDate.setDate(currentDate.getDate() + 1);
      } else if (granularity === ReportGranularity.WEEKLY) {
        periodEnd = new Date(currentDate);
        periodEnd.setDate(periodEnd.getDate() + 7);
        currentDate.setDate(currentDate.getDate() + 7);
      } else {
        // Monthly — a bucket IS a calendar month (Z63/T-329).
        //
        // The boundary is the 1st of the NEXT month, never "start day + 1
        // month": the latter both overflows (2026-01-31 -> 2026-03-03) and
        // carries the drift into every following bucket. `periodStart` keeps
        // the WINDOW's start on the first iteration, so the leading bucket is
        // partial and the window is not silently widened backwards.
        periodLabel = startOfUtcMonth(currentDate);
        periodEnd = addMonthsClamped(startOfUtcMonth(currentDate), 1);
        currentDate.setTime(periodEnd.getTime());
      }

      // Calculate spends for this period
      const periodPlans = plans.filter(
        (p) =>
          new Date(p.startDate) < periodEnd &&
          new Date(p.endDate) >= periodStart,
      );

      let onInvoice = 0;
      let offInvoice = 0;
      let ltaOnInvoice = 0;
      let ltaOffInvoice = 0;
      let promoOnInvoice = 0;
      let promoOffInvoice = 0;

      for (const plan of periodPlans) {
        const planFus = await this.planFuRepository.find({
          where: { planId: plan.id },
          relations: [
            'planSkus',
            'planMechanicValues',
            'planMechanicValues.mechanic',
          ],
        });

        for (const planFu of planFus) {
          for (const pmv of planFu.planMechanicValues || []) {
            const mechanic = pmv.mechanic;
            if (!mechanic) continue;

            const spend = spendOf(pmv.calculatedSpend);
            if (mechanic.category === 'on_invoice_discount') {
              onInvoice += spend;
              promoOnInvoice += spend;
            } else {
              offInvoice += spend;
              promoOffInvoice += spend;
            }
          }

          // Add LTA spends from SKUs
          for (const planSku of planFu.planSkus || []) {
            const ltaOn = spendOf(planSku.plannedLtaOnInvoiceSpend);
            const ltaOff = spendOf(planSku.plannedLtaOffInvoiceSpend);
            ltaOnInvoice += ltaOn;
            ltaOffInvoice += ltaOff;
            onInvoice += ltaOn;
            offInvoice += ltaOff;
          }
        }
      }

      dataPoints.push({
        date: periodLabel.toISOString().split('T')[0],
        onInvoice,
        offInvoice,
        total: onInvoice + offInvoice,
        ltaOnInvoice,
        ltaOffInvoice,
        promoOnInvoice,
        promoOffInvoice,
      });
    }

    const totalOnInvoice = dataPoints.reduce(
      (sum, dp) => sum + dp.onInvoice,
      0,
    );
    const totalOffInvoice = dataPoints.reduce(
      (sum, dp) => sum + dp.offInvoice,
      0,
    );
    const days = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const avgDailyOnInvoice = days > 0 ? totalOnInvoice / days : 0;
    const avgDailyOffInvoice = days > 0 ? totalOffInvoice / days : 0;

    return {
      granularity,
      dataPoints,
      totalOnInvoice,
      totalOffInvoice,
      avgDailyOnInvoice,
      avgDailyOffInvoice,
    };
  }

  /**
   * Get spend composition report
   */
  async getSpendComposition(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<CompositionReport> {
    const plans = await this.getFilteredPlans(tenantId, filters);

    const onInvoiceMap = new Map<
      string,
      { amount: number; planCount: number; totalRoi: number; roiCount: number }
    >();
    const offInvoiceMap = new Map<
      string,
      { amount: number; planCount: number; totalRoi: number; roiCount: number }
    >();

    for (const plan of plans) {
      const planFus = await this.planFuRepository.find({
        where: { planId: plan.id },
        relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
      });

      for (const planFu of planFus) {
        for (const pmv of planFu.planMechanicValues || []) {
          const mechanic = pmv.mechanic;
          if (!mechanic) continue;

          const spend = spendOf(pmv.calculatedSpend);
          const map =
            mechanic.category === 'on_invoice_discount'
              ? onInvoiceMap
              : offInvoiceMap;

          if (!map.has(mechanic.code)) {
            map.set(mechanic.code, {
              amount: 0,
              planCount: 0,
              totalRoi: 0,
              roiCount: 0,
            });
          }

          const entry = map.get(mechanic.code)!;
          entry.amount += spend;
          if (spend > 0) {
            entry.planCount += 1;
          }

          // Add ROI if available
          if (planFu.gpRoi) {
            entry.totalRoi += Number(planFu.gpRoi);
            entry.roiCount += 1;
          }
        }
      }
    }

    const totalOnInvoice = Array.from(onInvoiceMap.values()).reduce(
      (sum, e) => sum + e.amount,
      0,
    );
    const totalOffInvoice = Array.from(offInvoiceMap.values()).reduce(
      (sum, e) => sum + e.amount,
      0,
    );

    const onInvoice: CompositionSlice[] = Array.from(
      onInvoiceMap.entries(),
    ).map(([code, data]) => ({
      mechanicCode: code,
      mechanicName: code, // Will be resolved from mechanic entity
      amount: data.amount,
      percentage: totalOnInvoice > 0 ? (data.amount / totalOnInvoice) * 100 : 0,
      planCount: data.planCount,
      avgRoi: data.roiCount > 0 ? data.totalRoi / data.roiCount : undefined,
    }));

    const offInvoice: CompositionSlice[] = Array.from(
      offInvoiceMap.entries(),
    ).map(([code, data]) => ({
      mechanicCode: code,
      mechanicName: code,
      amount: data.amount,
      percentage:
        totalOffInvoice > 0 ? (data.amount / totalOffInvoice) * 100 : 0,
      planCount: data.planCount,
      avgRoi: data.roiCount > 0 ? data.totalRoi / data.roiCount : undefined,
    }));

    return {
      onInvoice,
      offInvoice,
      totalOnInvoice,
      totalOffInvoice,
    };
  }

  /**
   * Get plan performance report
   */
  async getPlanPerformance(
    tenantId: string,
    filters: ReportFilters,
    pagination: PaginationParams,
  ): Promise<PaginatedPlanReport> {
    const query = this.planRepository
      .createQueryBuilder('plan')
      .where('plan.tenantId = :tenantId', { tenantId })
      .leftJoinAndSelect('plan.cpl', 'cpl')
      .leftJoinAndSelect('plan.channel', 'channel')
      .leftJoinAndSelect('plan.category', 'category');

    // Apply filters
    if (filters.startDate) {
      query.andWhere('plan.startDate >= :startDate', {
        startDate: filters.startDate,
      });
    }
    if (filters.endDate) {
      query.andWhere('plan.endDate <= :endDate', { endDate: filters.endDate });
    }
    if (filters.cplIds && filters.cplIds.length > 0) {
      query.andWhere('plan.cplId IN (:...cplIds)', { cplIds: filters.cplIds });
    }
    if (filters.channels && filters.channels.length > 0) {
      query.andWhere('plan.channel.code IN (:...channels)', {
        channels: filters.channels,
      });
    }
    if (filters.categories && filters.categories.length > 0) {
      query.andWhere('plan.category.code IN (:...categories)', {
        categories: filters.categories,
      });
    }
    if (filters.planStatuses && filters.planStatuses.length > 0) {
      query.andWhere('plan.status IN (:...statuses)', {
        statuses: filters.planStatuses,
      });
    }
    if (filters.ragStatuses && filters.ragStatuses.length > 0) {
      query.andWhere('plan.ragStatus IN (:...ragStatuses)', {
        ragStatuses: filters.ragStatuses,
      });
    }

    // Sorting
    if (pagination.sortBy) {
      const sortField =
        pagination.sortBy === 'planName'
          ? 'plan.planName'
          : `plan.${pagination.sortBy}`;
      query.orderBy(sortField, pagination.sortOrder || 'DESC');
    } else {
      query.orderBy('plan.createdAt', 'DESC');
    }

    // Pagination
    const page = pagination.page || 1;
    const limit = pagination.limit || 50;
    const skip = (page - 1) * limit;

    const [plans, total] = await query.skip(skip).take(limit).getManyAndCount();

    // Build rows
    const rows: PlanPerformanceRow[] = await Promise.all(
      plans.map(async (plan) => {
        const planFus = await this.planFuRepository.find({
          where: { planId: plan.id },
          relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
        });

        let totalSpend = 0;
        let onInvoiceSpend = 0;
        let offInvoiceSpend = 0;

        for (const planFu of planFus) {
          for (const pmv of planFu.planMechanicValues || []) {
            const spend = spendOf(pmv.calculatedSpend);
            totalSpend += spend;
            if (pmv.mechanic?.category === 'on_invoice_discount') {
              onInvoiceSpend += spend;
            } else {
              offInvoiceSpend += spend;
            }
          }
        }

        const onInvoicePercent =
          totalSpend > 0 ? (onInvoiceSpend / totalSpend) * 100 : 0;
        const offInvoicePercent =
          totalSpend > 0 ? (offInvoiceSpend / totalSpend) * 100 : 0;

        return {
          planId: plan.id,
          planName: plan.planName,
          planCode: plan.planCode,
          cplName: plan.cpl?.name || 'N/A',
          channel: plan.channel?.name || 'N/A',
          category: plan.category?.name || 'N/A',
          totalSpend,
          onInvoiceSpend,
          offInvoiceSpend,
          onInvoicePercent,
          offInvoicePercent,
          // T-172: `null` ROI bir İŞ YARGISINA çökmez. `|| 0` "hesaplanamadı"yı
          // "%0, hedefin altında" diye gösteriyordu — INV-N-004 ailesi.
          gpRoi: plan.overallRoi ?? null,
          // T-215 / INV-N-004 / K-2.4.22c: a null ragStatus is the engine's
          // deliberate "coverage was not full, no colour is safe to show"
          // signal (kpi-engine.service.ts fullCoverage guard, T-177). Coercing
          // it to 'GREEN' here falsified that signal on a live route — with
          // today's data (COGS 4/170) this was the majority case, not an edge
          // one. The carrier stays `null`; no `GRAY` value is introduced
          // (K-2.4.22a1 — meaning is read from coverage ratio, not the enum).
          ragStatus: plan.ragStatus ?? null,
          // T-216b / INV-N-004 / K-2.4.22c: plans.coverage_ratio (T-218) —
          // explicit-null discipline, same reasoning as ragStatus above.
          // Domain B here (shared/finance-reporting, money-float-domain-a.txt),
          // plain Number() is the established parse for this field elsewhere
          // (plan.service.ts's overallRoi reads).
          coverageRatio:
            plan.coverageRatio !== null && plan.coverageRatio !== undefined
              ? Number(plan.coverageRatio)
              : null,
          status: plan.status,
          startDate: plan.startDate.toISOString().split('T')[0],
          endDate: plan.endDate.toISOString().split('T')[0],
        };
      }),
    );

    return {
      rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get budget at risk analysis
   */
  async getBudgetAtRisk(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<RiskReport> {
    const plans = await this.getFilteredPlans(tenantId, {
      ...filters,
      ragStatuses: ['RED', 'AMBER'],
    });

    const redPlans: RiskPlan[] = [];
    const amberPlans: RiskPlan[] = [];
    let redPlansSpend = 0;
    let amberPlansSpend = 0;

    for (const plan of plans) {
      const planFus = await this.planFuRepository.find({
        where: { planId: plan.id },
        relations: ['planMechanicValues'],
      });

      let totalSpend = 0;
      for (const planFu of planFus) {
        for (const pmv of planFu.planMechanicValues || []) {
          totalSpend += spendOf(pmv.calculatedSpend);
        }
      }

      const riskPlan: RiskPlan = {
        planId: plan.id,
        planName: plan.planName,
        // T-215 / INV-N-004 / K-2.4.22c: same fix as getPlanPerformance —
        // see the comment there. `getFilteredPlans` above already restricts
        // this query to `ragStatuses: ['RED', 'AMBER']`, so a `null` value
        // cannot reach this line today (a plan with partial coverage never
        // matches that filter); the fallback is removed anyway so the
        // falsification does not silently return if that filter is ever
        // loosened.
        ragStatus: plan.ragStatus ?? null,
        // T-216b / INV-N-004 / K-2.4.22c: same field/rationale as
        // getPlanPerformance above.
        coverageRatio:
          plan.coverageRatio !== null && plan.coverageRatio !== undefined
            ? Number(plan.coverageRatio)
            : null,
        totalSpend,
        // T-172: `null` ROI bir İŞ YARGISINA çökmez. `|| 0` "hesaplanamadı"yı
        // "%0, hedefin altında" diye gösteriyordu — INV-N-004 ailesi.
        gpRoi: plan.overallRoi ?? null,
        riskLevel: plan.ragStatus === 'RED' ? 'HIGH' : 'MEDIUM',
      };

      if (plan.ragStatus === 'RED') {
        redPlans.push(riskPlan);
        redPlansSpend += totalSpend;
      } else if (plan.ragStatus === 'AMBER') {
        amberPlans.push(riskPlan);
        amberPlansSpend += totalSpend;
      }
    }

    const totalAtRisk = redPlansSpend + amberPlansSpend;

    // Get total budget for risk percentage. T-270/Z21: calls the
    // non-throwing `computeBudgetUtilization` directly (not the public
    // `getBudgetUtilization`) — this report's own zero-budget handling
    // (`totalBudget > 0 ? ... : 0` below) already predates A1/A2 and is
    // unrelated to the dashboard's false-GREEN defect this task closes;
    // routing it through the new throw would newly break a live route
    // (`GET /finance-reporting/budget-at-risk`) that never rendered a color
    // off this figure in the first place.
    const { report: budgetReport } = await this.computeBudgetUtilization(
      tenantId,
      filters,
    );
    const totalBudget = budgetReport.total.allocated;
    const riskPercentage =
      totalBudget > 0 ? (totalAtRisk / totalBudget) * 100 : 0;

    const recommendations: string[] = [];
    if (redPlans.length > 0) {
      recommendations.push(
        `${redPlans.length} RED status plans should be reviewed and potentially revised`,
      );
    }
    if (amberPlans.length > 0) {
      recommendations.push(
        `${amberPlans.length} AMBER status plans should be monitored closely`,
      );
    }

    return {
      redPlansSpend,
      amberPlansSpend,
      totalAtRisk,
      riskPercentage,
      redPlans,
      amberPlans,
      recommendations,
    };
  }

  /**
   * Get mechanic effectiveness report
   */
  async getMechanicEffectiveness(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<MechanicReport> {
    const composition = await this.getSpendComposition(tenantId, filters);

    const allMechanics = [...composition.onInvoice, ...composition.offInvoice];

    const mechanics: MechanicEffectiveness[] = allMechanics.map((slice) => {
      const efficiencyScore = slice.avgRoi
        ? slice.avgRoi *
          (slice.amount / composition.totalOnInvoice +
            composition.totalOffInvoice)
        : 0;

      return {
        mechanicCode: slice.mechanicCode,
        mechanicName: slice.mechanicName,
        totalSpend: slice.amount,
        planCount: slice.planCount,
        avgGpRoi: slice.avgRoi || 0,
        avgToRoi: 0, // TODO: Calculate TO ROI
        totalIncrementalGp: 0, // TODO: Calculate from plan data
        efficiencyScore,
        insights: slice.avgRoi
          ? [
              `Average GP ROI: ${slice.avgRoi.toFixed(1)}%`,
              `Used in ${slice.planCount} plans`,
            ]
          : undefined,
      };
    });

    // Sort by efficiency score
    mechanics.sort((a, b) => b.efficiencyScore - a.efficiencyScore);

    return {
      mechanics,
      totalSpend: composition.totalOnInvoice + composition.totalOffInvoice,
      mostEfficient: mechanics.length > 0 ? mechanics[0].mechanicCode : '',
      leastEfficient:
        mechanics.length > 0
          ? mechanics[mechanics.length - 1].mechanicCode
          : '',
    };
  }

  /**
   * Get variance analysis report
   */
  async getVarianceAnalysis(
    tenantId: string,
    filters: ReportFilters,
    comparisonType: ComparisonType,
  ): Promise<VarianceReport> {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();

    // Get actual spends
    const actualTrend = await this.getSpendTrend(
      tenantId,
      filters,
      ReportGranularity.MONTHLY,
    );
    const actualOnInvoice = actualTrend.totalOnInvoice;
    const actualOffInvoice = actualTrend.totalOffInvoice;
    const actualTotal = actualOnInvoice + actualOffInvoice;

    let plannedOnInvoice = 0;
    let plannedOffInvoice = 0;
    let plannedTotal = 0;

    if (comparisonType === ComparisonType.BUDGET_VS_ACTUAL) {
      // T-270/Z21: `computeBudgetUtilization` directly (see the comment on
      // `getBudgetAtRisk`'s identical call, above) — and `plannedTotal` is
      // read from `total.allocated`, NOT `onInvoice.allocated +
      // offInvoice.allocated`: an UNSPLIT envelope's amount is counted in
      // `total` but deliberately NOT split into either bucket (see the
      // "UNSPLIT On/Off" comment in `computeBudgetUtilization`), so the sum
      // of the two buckets alone would silently drop it.
      const { report: budgetReport } = await this.computeBudgetUtilization(
        tenantId,
        filters,
      );
      plannedOnInvoice = budgetReport.onInvoice.allocated;
      plannedOffInvoice = budgetReport.offInvoice.allocated;
      plannedTotal = budgetReport.total.allocated;
    } else if (comparisonType === ComparisonType.PREVIOUS_PERIOD) {
      // Calculate previous period
      const periodDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const prevStartDate = new Date(startDate);
      prevStartDate.setDate(prevStartDate.getDate() - periodDays);
      const prevEndDate = new Date(startDate);

      const prevTrend = await this.getSpendTrend(
        tenantId,
        {
          ...filters,
          startDate: prevStartDate.toISOString().split('T')[0],
          endDate: prevEndDate.toISOString().split('T')[0],
        },
        ReportGranularity.MONTHLY,
      );
      plannedOnInvoice = prevTrend.totalOnInvoice;
      plannedOffInvoice = prevTrend.totalOffInvoice;
      plannedTotal = plannedOnInvoice + plannedOffInvoice;
    } else {
      // ⛔ §2.5 — "if yazıp else bırakmamak" YASAK, ve bu vaka onun BİREBİR metni.
      //
      // `ComparisonType` ÜÇ değer taşıyor; burada YALNIZ İKİSİNİN dalı var.
      // `FORECAST_VS_ACTUAL` bu `else` olmadan sessizce düşüyordu ve
      // `planned* = 0` KALIYORDU — yani uç `200` dönüp PLANLANAN BÜTÇEYİ
      // SIFIR gösteriyordu (ölçüldü: budget_vs_actual 1.600.000 ↔
      // forecast_vs_actual 0).
      //
      // ⚠️ VE YOL BU TURDA AÇILDI: `T-296` öncesi `?comparisonType=...`
      // whitelist'e takılıp `400` alıyordu, yani yalnız JS varsayılanı
      // (`budget_vs_actual`) koşuyordu. Çıplak `@Query`'yi DTO'ya taşımak
      // üç enum değerinin ÜÇÜNÜ DE açtı — bir örtü kalktı ve altındaki
      // sessiz sıfır göründü (`DISIPLIN`: "bir örtü kaldırılırken altındaki
      // AYNI COMMIT'te kapanır").
      throw new BadRequestException(
        `comparisonType='${comparisonType}' desteklenmiyor: bu karşılaştırma ` +
          `için planlanan tutar hesaplanamıyor. Desteklenenler: ` +
          `${ComparisonType.BUDGET_VS_ACTUAL}, ${ComparisonType.PREVIOUS_PERIOD}.`,
      );
    }

    const variances: VarianceItem[] = [
      {
        category: 'On-Invoice',
        planned: plannedOnInvoice,
        actual: actualOnInvoice,
        variance: actualOnInvoice - plannedOnInvoice,
        variancePercent:
          plannedOnInvoice > 0
            ? ((actualOnInvoice - plannedOnInvoice) / plannedOnInvoice) * 100
            : 0,
      },
      {
        category: 'Off-Invoice',
        planned: plannedOffInvoice,
        actual: actualOffInvoice,
        variance: actualOffInvoice - plannedOffInvoice,
        variancePercent:
          plannedOffInvoice > 0
            ? ((actualOffInvoice - plannedOffInvoice) / plannedOffInvoice) * 100
            : 0,
      },
      {
        category: 'Total',
        planned: plannedTotal,
        actual: actualTotal,
        variance: actualTotal - plannedTotal,
        variancePercent:
          plannedTotal > 0
            ? ((actualTotal - plannedTotal) / plannedTotal) * 100
            : 0,
      },
    ];

    return {
      comparisonType,
      periodStart: startDate.toISOString().split('T')[0],
      periodEnd: endDate.toISOString().split('T')[0],
      variances,
      totalVariance: actualTotal - plannedTotal,
      totalVariancePercent:
        plannedTotal > 0
          ? ((actualTotal - plannedTotal) / plannedTotal) * 100
          : 0,
    };
  }

  /**
   * Get cash flow projection
   */
  async getCashFlowProjection(
    tenantId: string,
    filters: ReportFilters,
    months: number,
  ): Promise<CashFlowReport> {
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : new Date();
    // [[T-328]] `endDate.setMonth(getMonth() + months)` idi ve GÜN TAŞMASI
    // yaşıyordu: hedef ayda o gün yoksa `setMonth` sessizce SONRAKİ aya taşar
    // (`2026-01-31 + 1 ay` -> `2026-03-03`, yani istenen pencerenin İKİ KATI).
    // Yön tehlikeliydi — pencere GENİŞLİYOR, uyarı yok, ve daha uzun bir
    // tahsilat penceresi nakit akışını olduğundan iyi gösterebiliyordu.
    // Kural ve ölçümler: `common/date/add-months.ts`.
    const endDate = addMonthsClamped(startDate, months);

    const plans = await this.getFilteredPlans(tenantId, {
      ...filters,
      endDate: endDate.toISOString().split('T')[0],
    });

    const projectionsMap = new Map<string, CashFlowProjection>();

    for (const plan of plans) {
      const planFus = await this.planFuRepository.find({
        where: { planId: plan.id },
        relations: ['planMechanicValues', 'planMechanicValues.mechanic'],
      });

      let onInvoiceSpend = 0;
      let offInvoiceSpend = 0;

      for (const planFu of planFus) {
        for (const pmv of planFu.planMechanicValues || []) {
          const spend = spendOf(pmv.calculatedSpend);
          if (pmv.mechanic?.category === 'on_invoice_discount') {
            onInvoiceSpend += spend;
          } else {
            offInvoiceSpend += spend;
          }
        }
      }

      // On-Invoice: Payment date = Promotion period start (immediate)
      const onInvoiceMonth = new Date(plan.startDate).toISOString().slice(0, 7); // YYYY-MM

      // Off-Invoice: Payment date = Period end + payment terms (assume 30 days)
      const paymentDate = new Date(plan.endDate);
      paymentDate.setDate(paymentDate.getDate() + 30);
      const offInvoiceMonth = paymentDate.toISOString().slice(0, 7);

      // Add to projections
      if (!projectionsMap.has(onInvoiceMonth)) {
        projectionsMap.set(onInvoiceMonth, {
          month: onInvoiceMonth,
          onInvoiceOutflow: 0,
          offInvoiceOutflow: 0,
          totalOutflow: 0,
          planBreakdown: [],
        });
      }

      if (!projectionsMap.has(offInvoiceMonth)) {
        projectionsMap.set(offInvoiceMonth, {
          month: offInvoiceMonth,
          onInvoiceOutflow: 0,
          offInvoiceOutflow: 0,
          totalOutflow: 0,
          planBreakdown: [],
        });
      }

      const onInvoiceProj = projectionsMap.get(onInvoiceMonth)!;
      onInvoiceProj.onInvoiceOutflow += onInvoiceSpend;
      onInvoiceProj.totalOutflow += onInvoiceSpend;
      onInvoiceProj.planBreakdown?.push({
        planId: plan.id,
        planName: plan.planName,
        onInvoice: onInvoiceSpend,
        offInvoice: 0,
        paymentDate: plan.startDate.toISOString().split('T')[0],
      });

      const offInvoiceProj = projectionsMap.get(offInvoiceMonth)!;
      offInvoiceProj.offInvoiceOutflow += offInvoiceSpend;
      offInvoiceProj.totalOutflow += offInvoiceSpend;
      offInvoiceProj.planBreakdown?.push({
        planId: plan.id,
        planName: plan.planName,
        onInvoice: 0,
        offInvoice: offInvoiceSpend,
        paymentDate: paymentDate.toISOString().split('T')[0],
      });
    }

    const projections = Array.from(projectionsMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month),
    );

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      projections,
      totalOnInvoiceOutflow: projections.reduce(
        (sum, p) => sum + p.onInvoiceOutflow,
        0,
      ),
      totalOffInvoiceOutflow: projections.reduce(
        (sum, p) => sum + p.offInvoiceOutflow,
        0,
      ),
      totalOutflow: projections.reduce((sum, p) => sum + p.totalOutflow, 0),
    };
  }

  /**
   * T-023 — Bütçe varyansı raporu: allocated (tahsis) vs consumed (GERÇEKLEŞEN)
   * karşılaştırması, kanal/kategori/dönem kırılımıyla.
   *
   * Kapsam (ürün sahibi, 2026-08-01): hacim/KPI varyansı (plan vs gerçek satış)
   * KAPSAM DIŞI. Yalnızca bütçe zarfı (budget_envelopes) bazında tahsis vs
   * gerçekleşen.
   *
   * Doğruluk ilkeleri:
   *   - `v_budget_summary` (BudgetSummaryView) tek doğruluk kaynağı — reserved
   *     (RESERVE+COMMIT-RELEASE) ve consumed (ledger DEBIT-CREDIT) burada
   *     YENİDEN HESAPLANMAZ, view'dan okunur (no-recompute, T-005 ilkesi).
   *   - Varyans SADECE consumed'dan hesaplanır (BRD "Actual vs. budget").
   *     `reserved` ayrı gösterilir, karıştırılmaz.
   *   - allocated=0 → variancePercent/utilizationPercent/status = null
   *     (division-by-zero guard; Infinity/NaN/0 DEĞİL).
   *   - Eşik durumu (`status`) BudgetThresholdService'ten (tenant-scoped,
   *     config-driven %80/%95/%100+) — hardcode YOK.
   *   - Scope: AccessScopeService (CM yalnız kendi kategorisini görür;
   *     ADMIN/FINANCE_MANAGER/READONLY tenant-wide). BudgetEnvelope'ta cplId
   *     kolonu yok — yalnızca categoryId boyutunda scope uygulanır (CM zaten
   *     yalnızca kategori boyutunda scope'lu; PLANNER bu rapora erişemez).
   */
  async getBudgetVarianceReport(
    tenantId: string,
    userId: string,
    userRole: UserRole,
    filters: BudgetVarianceQueryDto,
  ): Promise<BudgetVarianceReport> {
    const scope = await this.accessScopeService.resolveScope(
      tenantId,
      userId,
      userRole,
    );

    const qb = this.budgetEnvelopeRepository
      .createQueryBuilder('envelope')
      .where('envelope.tenantId = :tenantId', { tenantId })
      .andWhere('envelope.status = :status', {
        status: filters.status || BudgetEnvelopeStatus.ACTIVE,
      });

    // Scope kısıtı — UNRESTRICTED ise no-op; SCOPED (CM) ise categoryId
    // OR-grubu; scope satırı yoksa fail-closed (1=0).
    this.accessScopeService.applyToQueryBuilder(qb, 'envelope', scope);

    if (filters.fiscalYear) {
      qb.andWhere('envelope.fiscalYear = :fiscalYear', {
        fiscalYear: filters.fiscalYear,
      });
    }
    if (filters.periods && filters.periods.length > 0) {
      qb.andWhere('envelope.period IN (:...periods)', {
        periods: filters.periods,
      });
    }
    if (filters.channels && filters.channels.length > 0) {
      qb.andWhere('envelope.channel IN (:...channels)', {
        channels: filters.channels,
      });
    }
    if (filters.categories && filters.categories.length > 0) {
      qb.andWhere('envelope.category IN (:...categories)', {
        categories: filters.categories,
      });
    }

    const envelopes = await qb.getMany();

    if (envelopes.length === 0) {
      const emptyGroup = this.toVarianceGroup('ALL', []);
      return {
        items: [],
        byChannel: [],
        byCategory: [],
        byPeriod: [],
        total: emptyGroup,
      };
    }

    const thresholds =
      await this.budgetThresholdService.getThresholds(tenantId);

    // v_budget_summary tek doğruluk kaynağı — no-recompute (T-005 ilkesi).
    // Tenant için tüm summary'ler bir kerede çekilir, envelopeId ile eşlenir
    // (N+1 önlenir); yalnızca scope+filter'dan geçen zarfların satırları
    // rapora dahil edilir.
    const allSummaries =
      await this.budgetRepository.getAllBudgetSummaries(tenantId);
    const summaryByEnvelopeId = new Map(
      allSummaries.map((s) => [s.envelopeId, s]),
    );

    const items: BudgetVarianceItem[] = [];
    for (const envelope of envelopes) {
      const summary = summaryByEnvelopeId.get(envelope.id);
      if (!summary) {
        this.logger.warn(
          `Envelope ${envelope.id} (${envelope.code}) has no v_budget_summary row — skipping from variance report`,
        );
        continue;
      }

      const allocated = Number(summary.allocatedAmount) || 0;
      // ⛔ `|| 0` KALDIRILDI (`Z47` review 🟡-6, `T-291` sınıfı) — ve
      // `Number()` de: `BudgetSummaryView` bu alanları `DecimalTransformer`
      // ile ZATEN `number` döndürür. `Number(x) || 0` iki ayrı sessiz sıfır
      // üretiyordu: `null` girdide (transformer `null`'ı olduğu gibi geçirir)
      // ve GERÇEK `0`'ı ayırt edemeden. Burası bir VARYANS RAPORU — sessiz
      // sıfır, "sapma yok" diye okunur (`§2.5`).
      const reserved = summary.reservedAmount;
      const consumed = summary.consumedAmount;
      const available = summary.availableAmount;
      if (
        !Number.isFinite(reserved) ||
        !Number.isFinite(consumed) ||
        !Number.isFinite(available)
      ) {
        throw new Error(
          `INV-B-009 ailesi: v_budget_summary satırı sonlu olmayan değer ` +
            `taşıyor (envelope=${summary.envelopeId}) — varyans raporu ` +
            `sessizce 0'a düşmez.`,
        );
      }

      const variance = consumed - allocated;
      const variancePercent =
        allocated > 0 ? (variance / allocated) * 100 : null;
      const utilizationPercent =
        allocated > 0 ? ((reserved + consumed) / allocated) * 100 : null;
      const status =
        utilizationPercent === null
          ? null
          : this.budgetThresholdService.toStatus(
              utilizationPercent,
              thresholds,
            );

      items.push({
        envelopeId: envelope.id,
        code: envelope.code,
        name: envelope.name,
        fiscalYear: envelope.fiscalYear,
        period: envelope.period,
        channel: envelope.channel ?? null,
        category: envelope.category ?? null,
        allocated,
        reserved,
        consumed,
        available,
        variance,
        variancePercent,
        utilizationPercent,
        status,
      });
    }

    const byChannel = this.groupBy(
      items,
      (i) => i.channel ?? 'UNSPECIFIED',
      thresholds,
    );
    const byCategory = this.groupBy(
      items,
      (i) => i.category ?? 'UNSPECIFIED',
      thresholds,
    );
    const byPeriod = this.groupBy(
      items,
      (i) => `${i.fiscalYear}/${i.period}`,
      thresholds,
    );
    const total = this.toVarianceGroup('ALL', items, thresholds);

    return { items, byChannel, byCategory, byPeriod, total };
  }

  private groupBy(
    items: BudgetVarianceItem[],
    keyFn: (item: BudgetVarianceItem) => string,
    thresholds: BudgetThresholds,
  ): BudgetVarianceGroup[] {
    const map = new Map<string, BudgetVarianceItem[]>();
    for (const item of items) {
      const key = keyFn(item);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([key, groupItems]) =>
      this.toVarianceGroup(key, groupItems, thresholds),
    );
  }

  private toVarianceGroup(
    key: string,
    items: BudgetVarianceItem[],
    thresholds?: BudgetThresholds,
  ): BudgetVarianceGroup {
    const allocated = items.reduce((sum, i) => sum + i.allocated, 0);
    const reserved = items.reduce((sum, i) => sum + i.reserved, 0);
    const consumed = items.reduce((sum, i) => sum + i.consumed, 0);
    const available = items.reduce((sum, i) => sum + i.available, 0);
    const variance = consumed - allocated;
    const variancePercent = allocated > 0 ? (variance / allocated) * 100 : null;
    const utilizationPercent =
      allocated > 0 ? ((reserved + consumed) / allocated) * 100 : null;
    const status =
      utilizationPercent === null || !thresholds
        ? null
        : this.budgetThresholdService.toStatus(utilizationPercent, thresholds);

    return {
      key,
      envelopeCount: items.length,
      allocated,
      reserved,
      consumed,
      available,
      variance,
      variancePercent,
      utilizationPercent,
      status,
    };
  }

  // Helper methods

  private async getFilteredPlans(
    tenantId: string,
    filters: ReportFilters,
  ): Promise<Plan[]> {
    const query = this.planRepository
      .createQueryBuilder('plan')
      .where('plan.tenantId = :tenantId', { tenantId })
      .andWhere('plan.status IN (:...statuses)', {
        statuses: ['APPROVED', 'PENDING_APPROVAL'], // Only approved or pending plans
      });

    if (filters.startDate) {
      query.andWhere('plan.startDate >= :startDate', {
        startDate: filters.startDate,
      });
    }
    if (filters.endDate) {
      query.andWhere('plan.endDate <= :endDate', { endDate: filters.endDate });
    }
    if (filters.cplIds && filters.cplIds.length > 0) {
      query.andWhere('plan.cplId IN (:...cplIds)', { cplIds: filters.cplIds });
    }
    if (filters.channels && filters.channels.length > 0) {
      query.andWhere('plan.channel.code IN (:...channels)', {
        channels: filters.channels,
      });
    }
    if (filters.categories && filters.categories.length > 0) {
      query.andWhere('plan.category.code IN (:...categories)', {
        categories: filters.categories,
      });
    }
    if (filters.planStatuses && filters.planStatuses.length > 0) {
      query.andWhere('plan.status IN (:...statuses)', {
        statuses: filters.planStatuses,
      });
    }
    if (filters.ragStatuses && filters.ragStatuses.length > 0) {
      query.andWhere('plan.ragStatus IN (:...ragStatuses)', {
        ragStatuses: filters.ragStatuses,
      });
    }

    return query.getMany();
  }

  private getUtilizationStatus(
    percent: number,
    thresholds: BudgetThresholds,
  ): UtilizationStatus {
    return this.budgetThresholdService.toStatus(percent, thresholds);
  }

  /**
   * T-270/Z21: single shared aggregation for BudgetEnvelope-based breakdowns
   * (byChannel/byCategory) — the ORIGINAL `aggregateByCpl/Channel/Category`
   * trio copy-pasted this logic three times ("Similar to X but by Y"). One
   * function, keyed by a caller-supplied dimension accessor.
   *
   * UNSPLIT envelopes (`spendType IS NULL`) are excluded here — see the
   * "UNSPLIT On/Off" comment in `computeBudgetUtilization` for why an
   * on/off split cannot be honestly fabricated for them. Their money is
   * still visible in the TOP-LEVEL `total` (Z21 pin #1); only this
   * per-dimension on/off breakdown is degraded for envelopes that were
   * never typed. Measured 2026-08-23: 4/4 seeded envelopes are UNSPLIT, so
   * `byChannel`/`byCategory` are empty arrays today — an honest "nothing
   * typed yet", not a fabricated split.
   */
  private aggregateEnvelopesByDimension(
    envelopes: BudgetEnvelope[],
    summaryByEnvelopeId: Map<string, BudgetSummaryView>,
    thresholds: BudgetThresholds,
    keyOf: (envelope: BudgetEnvelope) => string | undefined,
  ): Array<{
    key: string;
    onInvoice: BudgetSummary;
    offInvoice: BudgetSummary;
  }> {
    const map = new Map<
      string,
      {
        onAllocated: number;
        onUtilized: number;
        onReserved: number;
        offAllocated: number;
        offUtilized: number;
        offReserved: number;
      }
    >();

    for (const envelope of envelopes) {
      if (envelope.spendType == null) continue;

      const key = keyOf(envelope);
      if (!key) continue;

      const summary = summaryByEnvelopeId.get(envelope.id);
      if (!summary) continue;

      if (!map.has(key)) {
        map.set(key, {
          onAllocated: 0,
          onUtilized: 0,
          onReserved: 0,
          offAllocated: 0,
          offUtilized: 0,
          offReserved: 0,
        });
      }
      const entry = map.get(key)!;
      const allocated = Number(summary.allocatedAmount) || 0;
      const reserved = Number(summary.reservedAmount) || 0;
      const consumed = Number(summary.consumedAmount) || 0;

      if (envelope.spendType === BudgetSpendType.ON_INVOICE) {
        entry.onAllocated += allocated;
        entry.onUtilized += consumed;
        entry.onReserved += reserved;
      } else {
        entry.offAllocated += allocated;
        entry.offUtilized += consumed;
        entry.offReserved += reserved;
      }
    }

    return Array.from(map.entries()).map(([key, d]) => {
      const onAvailable = d.onAllocated - d.onUtilized - d.onReserved;
      const offAvailable = d.offAllocated - d.offUtilized - d.offReserved;
      const onPercent =
        d.onAllocated > 0
          ? ((d.onUtilized + d.onReserved) / d.onAllocated) * 100
          : 0;
      const offPercent =
        d.offAllocated > 0
          ? ((d.offUtilized + d.offReserved) / d.offAllocated) * 100
          : 0;

      return {
        key,
        onInvoice: {
          allocated: d.onAllocated,
          utilized: d.onUtilized,
          reserved: d.onReserved,
          available: onAvailable,
          utilizationPercent: onPercent,
          status: this.getUtilizationStatus(onPercent, thresholds),
        },
        offInvoice: {
          allocated: d.offAllocated,
          utilized: d.offUtilized,
          reserved: d.offReserved,
          available: offAvailable,
          utilizationPercent: offPercent,
          status: this.getUtilizationStatus(offPercent, thresholds),
        },
      };
    });
  }
}

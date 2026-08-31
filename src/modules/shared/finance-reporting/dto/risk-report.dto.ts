import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsArray,
  IsObject,
  IsOptional,
  IsEnum,
} from 'class-validator';

export class RiskPlan {
  @ApiProperty({ description: 'Plan ID' })
  @IsString()
  planId!: string;

  @ApiProperty({ description: 'Plan name' })
  @IsString()
  planName!: string;

  // T-215 / INV-N-004 / K-2.4.22a1: `null` means "coverage was not full —
  // no colour is safe to show" (kpi-engine.service.ts fullCoverage guard).
  // See plan-performance.dto.ts PlanPerformanceRow.ragStatus for the same
  // fix and rationale.
  @ApiProperty({
    description:
      'RAG status. null = partial/zero KPI coverage — no full-coverage colour may be shown (K-2.4.22c)',
    enum: ['RED', 'AMBER', 'GREEN'],
    nullable: true,
  })
  @IsOptional()
  @IsEnum(['RED', 'AMBER', 'GREEN'])
  ragStatus!: string | null;

  /**
   * `T-342` / `Z68 §2` — TANIMLI-YOKLUK. `ragStatus === null` iki ayrı
   * gerçeği anlatır ve bu alan onları ayırır:
   * ```
   * null        "değerlendirilemedi"  → eksik/kısmi veri (bkz. coverageRatio)
   * 'LTA_ONLY'  "değerlendirme DIŞI"  → plan bir promosyon değerlendirmesi değil
   * ```
   * ⛔ **BU UÇTA BUGÜN YAPISAL OLARAK `null`** (`T-343` review `S2`):
   * `getBudgetAtRisk` planları `ragStatus IN ('RED','AMBER','GREEN')` ile
   * çekiyor ve **SQL `IN` `NULL`'ı DIŞLAR** ⇒ dışlanmış bir plan bu
   * rapora giremez. Alan doldurulmaya devam ediyor (filtre değişirse
   * kendiliğinden canlanır) ama *"okuyucu bu alanla ayırt eder"* iddiası
   * **bu uç için doğru değildi**. Ayrım `PlanPerformanceRow`'da CANLI.
   */
  @ApiProperty({
    description:
      'Reason a RAG colour is legitimately absent. NOTE: structurally null on this endpoint today — the RAG filter excludes NULL-status plans (see field docs). Live on /plan-performance.',
    enum: ['LTA_ONLY'],
    nullable: true,
  })
  @IsOptional()
  @IsEnum(['LTA_ONLY'])
  ragExclusionReason!: string | null;

  // T-216b / INV-N-004 / K-2.4.22c: same field/rationale as
  // PlanPerformanceRow.coverageRatio (plan-performance.dto.ts) — plans.
  // coverage_ratio (T-218), null = nothing to aggregate.
  @ApiProperty({
    description:
      'Fraction of FUs whose GP_ROI_PCT resolved into gpRoi (0-1). null = nothing to aggregate.',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  coverageRatio!: number | null;

  @ApiProperty({ description: 'Total spend' })
  @IsNumber()
  totalSpend!: number;

  @ApiProperty({ description: 'GP ROI' })
  @IsNumber()
  // T-172: `null` = hesaplanamadı. `0` DEĞİL — sıfır bir iş yargısıdır.
  gpRoi!: number | null;

  /**
   * ⚠️ **HAM DİZGE, KULLANICI METNİ DEĞİL** (`T-343` review nit).
   * `BudgetAtRiskWidget` ve `export.ts` bu alanı olduğu gibi basıyor ⇒
   * kullanıcı bugün ekranda **`BELOW_TARGET`** görür. `HIGH`/`MEDIUM` de
   * aynı sınıftaydı (pre-existing) ama yeni üye yeni bir dize getiriyor.
   * ⛔ Sunum metnine çevirme kararı **bu turun kapsamı değil** — kayıt
   * `T-343` kapanış raporunda, Team Lead'e bildirildi.
   */
  @ApiProperty({ description: 'Risk level' })
  @IsString()
  riskLevel!: string; // 'HIGH', 'MEDIUM', 'BELOW_TARGET'

  /**
   * `Z71 §1` — TARGET-ROI ekseni. `GREEN` bir plan **hedefin altında**
   * olabilir; bu bir çelişki değil, **iki eksenin ayrı konuşmasıdır**.
   * `null` = bu eksende yargı yok (ROI ya da hedef okunamadı).
   */
  @ApiPropertyOptional({
    description:
      'Configured Target-ROI threshold this plan was compared against. null = not evaluable.',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  targetRoiThreshold!: number | null;
}

export class RiskReport {
  @ApiProperty({ description: 'RED status plans spend total' })
  @IsNumber()
  redPlansSpend!: number;

  @ApiProperty({ description: 'AMBER status plans spend total' })
  @IsNumber()
  amberPlansSpend!: number;

  /**
   * `Z71 §1a` — **KADRAN İNİŞİNİN SESSİZLEŞTİRECEĞİ İKİ DİLİM.**
   * Ölçülmüş geçiş matrisi (`green=20 · amber=10`):
   * ```
   * 0 < ROI < 10    ÖNCE RED    → SONRA GREEN    ⇒ risk raporundan DÜŞERDİ
   * 10 ≤ ROI < 20   ÖNCE AMBER  → SONRA GREEN    ⇒ risk raporundan DÜŞERDİ
   * ```
   * ⇒ Finance'ın evreni **küçülmedi, daha doğru adlandı**.
   */
  @ApiProperty({
    description:
      'Spend total of GREEN plans whose GP ROI is below the configured Target-ROI threshold (Z71 §1).',
  })
  @IsNumber()
  belowTargetRoiPlansSpend!: number;

  @ApiProperty({ description: 'Total at-risk spend' })
  @IsNumber()
  totalAtRisk!: number;

  @ApiProperty({ description: 'Percentage of total budget at risk' })
  @IsNumber()
  riskPercentage!: number;

  @ApiProperty({ description: 'RED status plans', type: [RiskPlan] })
  @IsArray()
  redPlans!: RiskPlan[];

  @ApiProperty({ description: 'AMBER status plans', type: [RiskPlan] })
  @IsArray()
  amberPlans!: RiskPlan[];

  /** `Z71 §1` — `GREEN` ama hedefin altında. Bkz. `belowTargetRoiPlansSpend`. */
  @ApiProperty({
    description:
      'GREEN plans below the configured Target-ROI threshold (Z71 §1)',
    type: [RiskPlan],
  })
  @IsArray()
  belowTargetRoiPlans!: RiskPlan[];

  @ApiPropertyOptional({ description: 'Recommendations', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  recommendations?: string[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { UtilizationStatus } from './budget-utilization.dto';

/**
 * T-023 — Bütçe varyansı raporu (finance-reporting).
 *
 * Kapsam kararı (ürün sahibi, 2026-08-01): "Bütçe varyansı" = tahsis edilen
 * bütçe (allocated) ile GERÇEKLEŞEN harcama (consumed) karşılaştırması.
 * Hacim/KPI varyansı (plan vs gerçek satış) KAPSAM DIŞI — bkz. class header
 * budget-variance-report.service kısmı / T-023 task notu.
 *
 * TERİM SÖZLÜĞÜ (karıştırma YASAK — bu alan bu oturumda 7 kez karıştırıldı):
 *   - `reserved`  = encumbrance: budget_transactions üzerinden RESERVE+COMMIT-RELEASE
 *                   (plan onaylandı/rezerve edildi ama henüz fatura/ledger'a düşmedi).
 *   - `consumed`  = GERÇEKLEŞEN: ledger_entries üzerinden DEBIT-CREDIT (fiilen
 *                   fatura edilmiş/settled harcama). BRD "Actual vs. budget" ölçüm
 *                   yöntemi TAM OLARAK bu alanı referans alır.
 *   - `variance`  = consumed - allocated (BRD "Actual vs budget"). `reserved` İLE
 *                   HESAPLANMAZ; rapor `reserved`'i ayrı bilgi amaçlı gösterir.
 *
 * `allocated`, `reserved`, `consumed`, `available` alanları `v_budget_summary`
 * view'ından (no-recompute — T-005 ilkesi) okunur; bu serviste ham ledger/
 * transaction satırları YENİDEN toplanmaz.
 */
export class BudgetVarianceItem {
  @ApiProperty({ description: 'Budget envelope ID' })
  @IsString()
  envelopeId!: string;

  @ApiProperty({ description: 'Envelope code (e.g. ENV-2026-NKA-Q1)' })
  @IsString()
  code!: string;

  @ApiProperty({ description: 'Envelope name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Fiscal year' })
  @IsString()
  fiscalYear!: string;

  @ApiProperty({ description: 'Period (e.g. 2026-01, Q1)' })
  @IsString()
  period!: string;

  @ApiPropertyOptional({ description: 'Channel dimension (nullable)' })
  @IsOptional()
  @IsString()
  channel?: string | null;

  @ApiPropertyOptional({ description: 'Category dimension (nullable)' })
  @IsOptional()
  @IsString()
  category?: string | null;

  @ApiProperty({ description: 'Allocated budget amount' })
  allocated!: number;

  @ApiProperty({
    description:
      'Reserved/encumbered amount (RESERVE+COMMIT-RELEASE, budget_transactions) — bilgi amaçlı, varyans bundan HESAPLANMAZ',
  })
  reserved!: number;

  @ApiProperty({
    description:
      'Consumed (GERÇEKLEŞEN) amount — ledger DEBIT-CREDIT. BRD "Actual vs. budget" bu alanı referans alır.',
  })
  consumed!: number;

  @ApiProperty({
    description: 'Available amount (allocated - reserved - consumed)',
  })
  available!: number;

  @ApiProperty({
    description:
      'Variance amount = consumed - allocated (positive = over budget)',
  })
  variance!: number;

  @ApiProperty({
    description:
      'Variance percent = (consumed - allocated) / allocated * 100. allocated=0 ise null (division-by-zero guard, BRD KPI edge-case kuralı) — Infinity/NaN DEĞİL.',
    nullable: true,
  })
  variancePercent!: number | null;

  @ApiProperty({
    description:
      'Utilization percent = (reserved + consumed) / allocated * 100 — eşik (threshold) durumu bu alandan türetilir. allocated=0 ise null.',
    nullable: true,
  })
  utilizationPercent!: number | null;

  @ApiProperty({
    description:
      'Threshold status (BudgetThresholdService, tenant-scoped config: %80/%95/%100+). allocated=0 ise null.',
    enum: UtilizationStatus,
    nullable: true,
  })
  status!: UtilizationStatus | null;
}

export class BudgetVarianceGroup {
  @ApiProperty({ description: 'Group key (channel/category/period value)' })
  key!: string;

  @ApiProperty({
    description: 'Number of envelopes aggregated into this group',
  })
  envelopeCount!: number;

  @ApiProperty() allocated!: number;
  @ApiProperty() reserved!: number;
  @ApiProperty() consumed!: number;
  @ApiProperty() available!: number;
  @ApiProperty() variance!: number;

  @ApiProperty({ nullable: true })
  variancePercent!: number | null;

  @ApiProperty({ nullable: true })
  utilizationPercent!: number | null;

  @ApiProperty({ enum: UtilizationStatus, nullable: true })
  status!: UtilizationStatus | null;
}

export class BudgetVarianceReport {
  @ApiProperty({
    description: 'Per-envelope rows (channel x category x period granularity)',
    type: [BudgetVarianceItem],
  })
  @IsArray()
  items!: BudgetVarianceItem[];

  @ApiProperty({
    description: 'Breakdown by channel',
    type: [BudgetVarianceGroup],
  })
  @IsArray()
  byChannel!: BudgetVarianceGroup[];

  @ApiProperty({
    description: 'Breakdown by category',
    type: [BudgetVarianceGroup],
  })
  @IsArray()
  byCategory!: BudgetVarianceGroup[];

  @ApiProperty({
    description: 'Breakdown by period (fiscalYear + period)',
    type: [BudgetVarianceGroup],
  })
  @IsArray()
  byPeriod!: BudgetVarianceGroup[];

  @ApiProperty({
    description: 'Tenant-wide (scope-filtered) total',
    type: BudgetVarianceGroup,
  })
  total!: BudgetVarianceGroup;
}

export class BudgetVarianceQueryDto {
  @ApiPropertyOptional({ description: 'Fiscal year filter (e.g. 2026)' })
  @IsOptional()
  @IsString()
  fiscalYear?: string;

  @ApiPropertyOptional({
    description: 'Period filter (e.g. 2026-01)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  periods?: string[];

  @ApiPropertyOptional({ description: 'Channel filter', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];

  @ApiPropertyOptional({ description: 'Category filter', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional({
    description: 'Envelope status filter (default ACTIVE)',
  })
  @IsOptional()
  @IsString()
  status?: string;
}

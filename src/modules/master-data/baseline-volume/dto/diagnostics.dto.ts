import {
  ImportBatchRowReason,
  ImportBatchRowStatus,
} from '../../../../database/entities/baseline-volume-import-batch-row.entity';

/**
 * `BL-4 §4` (`docs/process/BL4_YUZEY_BRIEF.md`) — teşhis ekranının satır
 * şekli: `batch → satırlar → NEDEN`. Kaynak `baseline_volume_import_batch_
 * rows` (`BL-3 ADIM 4`), CÜMLE sözlüğü `baseline-volume-remediation.ts`
 * (`Z87 §F12`'nin YEDİ üyesi — ÇAĞRILIR, yeniden yazılmaz).
 */
export interface BaselineVolumeDiagnosticRowDto {
  rowNo: number;
  status: ImportBatchRowStatus;
  reason: ImportBatchRowReason | null;
  /** Yalnız `status === REJECTED` iken dolu — `BASELINE_VOLUME_REMEDIATION`'dan. */
  remediation: string | null;
  resolvedSkuId: string | null;
  resolvedCplId: string | null;
  raw: Record<string, unknown>;
}

/**
 * `BL-4 §5`/`§5a` — batch BAŞLIĞI: `sourceMatchRatio` burada yaşar,
 * `coverageRatio` (KAPI) burada YAŞAMAZ — iki metrik ekranda da karışmaz.
 */
export interface BaselineVolumeSourceMatchDto {
  matchedCount: number;
  totalCount: number;
  /** `null` YALNIZ `totalCount === 0` iken (boş batch, oran tanımsız). */
  sourceMatchRatio: number | null;
}

export interface ApprovalFilters {
  status?: string[];
  categoryId?: string;
  channelId?: string;
  cplId?: string;
  periodMonth?: string;
  minSpend?: number;
  maxSpend?: number;
  ragStatus?: string[];
}

export interface PendingPlan {
  id: string;
  planCode: string;
  planName: string;
  status: string;
  category: {
    id: string;
    name: string;
    code: string;
  };
  channel: {
    id: string;
    name: string;
    code: string;
  };
  cpl: {
    id: string;
    name: string;
    code: string;
  };
  periodMonth: string;
  totalSpend: number;
  onInvoiceSpend: number;
  offInvoiceSpend: number;
  overallRoi?: number;
  ragStatus?: string;
  /**
   * `T-342`/`Z71 §2` — TANIMLI-YOKLUK, onay kuyruğunda.
   * `ragStatus` yokken: `'LTA_ONLY'` = *"değerlendirme DIŞI"*,
   * `undefined` = *"değerlendirilemedi"*.
   *
   * ⛔ `T-343` review `S6`: `Z71 §2`'nin yüzey listesi `approval-workflow`'u
   * **açıkça sayıyordu** ama `GET /plans/approval-queue` (canlı rota)
   * yalnız `ragStatus`'u eşliyordu ⇒ onaycı, renksiz bir planın **neden**
   * renksiz olduğunu göremiyordu. Tam `T-323` dersinin bu yüzeydeki hâli:
   * *"kötü değil" ≠ "değerlendirilmedi"*.
   */
  ragExclusionReason?: string;
  submittedAt: Date;
  submittedBy: {
    id: string;
    name: string;
    email: string;
  };
  daysInQueue: number;
  pendingFinanceReview: boolean;
}

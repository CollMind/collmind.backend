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
  submittedAt: Date;
  submittedBy: {
    id: string;
    name: string;
    email: string;
  };
  daysInQueue: number;
  pendingFinanceReview: boolean;
}

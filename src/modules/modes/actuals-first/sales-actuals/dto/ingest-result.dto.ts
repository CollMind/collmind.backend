export interface RowValidationIssue {
  rowNumber: number;
  code: string;
  field?: string;
  message: string;
}

export type BatchIngestStatus = 'CREATED' | 'REPLACED' | 'IDEMPOTENT_DUPLICATE';

export interface BatchIngestResultDto {
  batchId: string;
  status: BatchIngestStatus;
  fiscalPeriod: string;
  cplId: string;
  categoryId: string;
  channelId: string;
  cplCode: string;
  categoryName: string;
  channelCode: string;
  rowCount: number;
  grossTotal: number;
  netTotal: number;
  discountTotal: number;
  replacedBatchId?: string;
}

export interface IngestSalesActualsResultDto {
  fileHash: string;
  fiscalPeriod: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  batches: BatchIngestResultDto[];
  errors: RowValidationIssue[];
  warnings: RowValidationIssue[];
}

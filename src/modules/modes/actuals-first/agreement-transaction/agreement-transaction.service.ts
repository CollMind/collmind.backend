import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { AgreementTransactionRepository } from './agreement-transaction.repository';
import { CreateAgreementTransactionDto, BatchImportDto, BatchImportResultDto } from './dto';
import { AgreementTransaction } from '../../../../database/entities/agreement-transaction.entity';
import { LedgerService } from '../ledger/ledger.service';
import { AgreementService } from '../agreement/agreement.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import { AgreementStatus } from '../../../../database/entities/agreement.entity';
import { randomUUID } from 'crypto';

@Injectable()
export class AgreementTransactionService {
  constructor(
    private readonly txRepo: AgreementTransactionRepository,
    private readonly ledgerService: LedgerService,
    private readonly agreementService: AgreementService,
    private readonly budgetService: BudgetService,
  ) {}

  /**
   * Create single off-invoice transaction
   * Also creates corresponding ledger entry
   */
  async create(
    dto: CreateAgreementTransactionDto,
    tenantId: string,
    userId: string,
    batchId?: string,
    rowNumber?: number,
  ): Promise<AgreementTransaction> {
    // Validate agreement exists and is in correct status
    const agreement = await this.agreementService.findById(dto.agreementId, tenantId);
    
    if (!agreement) {
      throw new NotFoundException(`Agreement with ID ${dto.agreementId} not found`);
    }
    
    if (![AgreementStatus.APPROVED, AgreementStatus.ACTIVE].includes(agreement.status)) {
      throw new BadRequestException(
        'Off-invoice entries can only be added to APPROVED or ACTIVE agreements',
      );
    }

    // Validate invoice date within agreement period
    const invoiceDate = new Date(dto.invoiceDate);
    if (invoiceDate < new Date(agreement.startDate) || invoiceDate > new Date(agreement.endDate)) {
      throw new BadRequestException(
        `Invoice date must be within agreement period (${agreement.startDate.toISOString().split('T')[0]} to ${agreement.endDate.toISOString().split('T')[0]})`,
      );
    }

    // Format invoice date for idempotency key (YYYY-MM-DD)
    const invoiceDateStr = invoiceDate.toISOString().split('T')[0];
    
    // Generate idempotency key: {agreement_id}|{invoice_no}|{invoice_date}
    const idempotencyKey = `${dto.agreementId}|${dto.invoiceNo}|${invoiceDateStr}`;

    // Check if already exists (idempotency)
    const existing = await this.txRepo.findByIdempotencyKey(idempotencyKey, tenantId);
    if (existing) {
      return existing; // Idempotent: return existing
    }

    // Validate cap not exceeded
    const currentTotal = await this.txRepo.sumByAgreementId(dto.agreementId, tenantId);
    if (currentTotal + dto.amount > Number(agreement.capTotalAmount)) {
      throw new BadRequestException(
        `Transaction would exceed agreement cap. Cap: ${agreement.capTotalAmount}, Current: ${currentTotal}, Requested: ${dto.amount}`,
      );
    }

    // Determine fiscal period for budget deduction
    // Priority: 1) DTO fiscalPeriod, 2) Agreement periodMonth, 3) Invoice date period
    let fiscalPeriod = dto.fiscalPeriod;
    if (!fiscalPeriod) {
      // Fallback to agreement period month
      fiscalPeriod = agreement.periodMonth;
    }
    if (!fiscalPeriod) {
      // Last fallback: derive from invoice date
      const invoiceYear = invoiceDate.getFullYear();
      const invoiceMonth = String(invoiceDate.getMonth() + 1).padStart(2, '0');
      fiscalPeriod = `${invoiceYear}-${invoiceMonth}`;
    }

    // Create transaction
    // Note: agreement_transactions.cpl_id refers to customers table, not cpls table
    // agreement.cplId is a CPL ID (references cpls table), not a Customer ID
    // We must explicitly omit cplId to avoid foreign key constraint violation
    const transaction = await this.txRepo.create({
      agreementId: dto.agreementId,
      invoiceNo: dto.invoiceNo,
      invoiceDate,
      fiscalPeriod, // Store fiscal period for budget deduction (already calculated above)
      amount: dto.amount,
      currency: dto.currency || 'TRY',
      notes: dto.notes,
      tenantId,
      idempotencyKey,
      createdBy: userId,
      batchId,
      rowNumber,
      // cplId is omitted - it refers to customers table, not cpls (agreement.cplId is a CPL ID, not Customer ID)
      // TypeORM will set it to null automatically since it's nullable
    });

    // Find budget envelope for this agreement
    // Note: findEnvelopeByDimensions expects channel as string (channel code), not channelId
    // We need to get the channel code from the relation
    if (!agreement.channel) {
      throw new BadRequestException('Agreement channel relation is not loaded');
    }
    const channelCode = agreement.channel.code;
    
    // Use fiscal period for envelope matching (as per BRD: "Bütçe buradan düşülür")
    const envelope = await this.budgetService.findEnvelopeByDimensions(
      tenantId,
      channelCode,
      fiscalPeriod, // Use transaction fiscal period, not agreement period
    );

    if (envelope) {
      // Create corresponding ledger entry
      // Use fiscal period for budget deduction (as specified in BRD)
      await this.ledgerService.createFromAgreementTransaction(
        agreement.id,
        transaction.id,
        dto.amount,
        invoiceDate,
        fiscalPeriod, // Use transaction fiscal period for budget deduction
        envelope.id,
        {
          channel: channelCode,
          cplId: agreement.cplId,
          fuId: agreement.fuId,
          tacticId: agreement.tacticId,
          mechanicId: agreement.mechanicId,
        },
        tenantId,
        userId,
      );
    }

    return transaction;
  }

  /**
   * Batch import off-invoice transactions
   * Partial success: valid rows imported, invalid rows returned with errors
   */
  async batchImport(
    dto: BatchImportDto,
    tenantId: string,
    userId: string,
  ): Promise<BatchImportResultDto> {
    const batchId = dto.batchId || randomUUID();
    const result: BatchImportResultDto = {
      batchId,
      totalRows: dto.transactions.length,
      successCount: 0,
      errorCount: 0,
      errors: [],
      createdTransactions: [],
    };

    for (let i = 0; i < dto.transactions.length; i++) {
      const txDto = dto.transactions[i];
      const rowNumber = i + 1;

      try {
        // Create transaction (includes validation) with batch info
        const transaction = await this.create(txDto, tenantId, userId, batchId, rowNumber);

        result.successCount++;
        result.createdTransactions.push(transaction.id);
      } catch (error) {
        result.errorCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({
          rowNumber,
          invoiceNo: txDto.invoiceNo,
          error: errorMessage,
        });
      }
    }

    return result;
  }

  async findById(id: string, tenantId: string): Promise<AgreementTransaction> {
    const tx = await this.txRepo.findById(id, tenantId);
    if (!tx) {
      throw new NotFoundException('Agreement transaction not found');
    }
    return tx;
  }

  async findByAgreementId(agreementId: string, tenantId: string): Promise<AgreementTransaction[]> {
    return this.txRepo.findByAgreementId(agreementId, tenantId);
  }

  async findByBatchId(batchId: string, tenantId: string): Promise<AgreementTransaction[]> {
    return this.txRepo.findByBatchId(batchId, tenantId);
  }

  async findAll(tenantId: string, filters?: {
    agreementId?: string;
    batchId?: string;
    invoiceDateFrom?: Date;
    invoiceDateTo?: Date;
    cplId?: string;
  }): Promise<AgreementTransaction[]> {
    return this.txRepo.findAll(tenantId, filters);
  }

  async getTotalByAgreement(agreementId: string, tenantId: string): Promise<number> {
    return this.txRepo.sumByAgreementId(agreementId, tenantId);
  }

  async getCount(tenantId: string): Promise<number> {
    return this.txRepo.count(tenantId);
  }
}


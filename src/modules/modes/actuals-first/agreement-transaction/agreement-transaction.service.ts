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

    // Create transaction
    const transaction = await this.txRepo.create({
      ...dto,
      tenantId,
      idempotencyKey,
      invoiceDate,
      currency: dto.currency || 'TRY',
      cplId: agreement.cplId,
      createdBy: userId,
      batchId,
      rowNumber,
    });

    // Find budget envelope for this agreement
    // Note: findEnvelopeByDimensions expects channel as string (channel code), not channelId
    // We need to get the channel code from the relation
    if (!agreement.channel) {
      throw new BadRequestException('Agreement channel relation is not loaded');
    }
    const channelCode = agreement.channel.code;
    const envelope = await this.budgetService.findEnvelopeByDimensions(
      tenantId,
      channelCode,
      agreement.periodMonth,
    );

    if (envelope) {
      // Create corresponding ledger entry
      // Use agreement.periodMonth to match the envelope period, not invoiceDate period
      // This ensures budget reconciliation aligns with the agreement's budget period
      await this.ledgerService.createFromAgreementTransaction(
        agreement.id,
        transaction.id,
        dto.amount,
        invoiceDate,
        agreement.periodMonth, // Use agreement period, not invoice date period
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
  }): Promise<AgreementTransaction[]> {
    return this.txRepo.findAll(tenantId, filters);
  }

  async getTotalByAgreement(agreementId: string, tenantId: string): Promise<number> {
    return this.txRepo.sumByAgreementId(agreementId, tenantId);
  }
}


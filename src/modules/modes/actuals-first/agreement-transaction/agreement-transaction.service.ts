import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AgreementTransactionRepository } from './agreement-transaction.repository';
import {
  CreateAgreementTransactionDto,
  BatchImportDto,
  BatchImportResultDto,
} from './dto';
import { AgreementTransaction } from '../../../../database/entities/agreement-transaction.entity';
import { toPeriodMonthUtc } from '../../../../common/date/period-month';
import { LedgerService } from '../ledger/ledger.service';
import { AgreementService } from '../agreement/agreement.service';
import {
  BudgetService,
  isSplitDimensionGuardError,
} from '../../../shared/budget/budget.service';
import {
  AgreementStatus,
  SpendType as AgreementSpendType,
} from '../../../../database/entities/agreement.entity';
import {
  BudgetEnvelope,
  BudgetSpendType,
} from '../../../../database/entities/budget-envelope.entity';
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
    const agreement = await this.agreementService.findById(
      dto.agreementId,
      tenantId,
    );

    if (!agreement) {
      throw new NotFoundException(
        `Agreement with ID ${dto.agreementId} not found`,
      );
    }

    if (
      ![AgreementStatus.APPROVED, AgreementStatus.ACTIVE].includes(
        agreement.status,
      )
    ) {
      throw new BadRequestException(
        'Off-invoice entries can only be added to APPROVED or ACTIVE agreements',
      );
    }

    // Validate invoice date within agreement period
    const invoiceDate = new Date(dto.invoiceDate);
    if (
      invoiceDate < new Date(agreement.startDate) ||
      invoiceDate > new Date(agreement.endDate)
    ) {
      throw new BadRequestException(
        `Invoice date must be within agreement period (${agreement.startDate.toISOString().split('T')[0]} to ${agreement.endDate.toISOString().split('T')[0]})`,
      );
    }

    // Format invoice date for idempotency key (YYYY-MM-DD)
    const invoiceDateStr = invoiceDate.toISOString().split('T')[0];

    // Generate idempotency key: {agreement_id}|{invoice_no}|{invoice_date}
    const idempotencyKey = `${dto.agreementId}|${dto.invoiceNo}|${invoiceDateStr}`;

    // Check if already exists (idempotency)
    const existing = await this.txRepo.findByIdempotencyKey(
      idempotencyKey,
      tenantId,
    );
    if (existing) {
      return existing; // Idempotent: return existing
    }

    // Validate cap not exceeded
    const currentTotal = await this.txRepo.sumByAgreementId(
      dto.agreementId,
      tenantId,
    );
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
      // T-333 (Z81 §3): AYNI yardımcı (`common/date/period-month.ts`) —
      // bu, bir bütçe düşüm zarfı seçen ANAHTAR üretimidir (§2.5 sınıfı),
      // periodMonth/fiscalPeriod ile AYNI format ve AYNI katman: pakette.
      fiscalPeriod = toPeriodMonthUtc(invoiceDate);
    }

    // Find budget envelope for this agreement
    // Note: findEnvelopeByDimensions expects channel as string (channel code), not channelId
    // We need to get the channel code from the relation
    if (!agreement.channel) {
      throw new BadRequestException('Agreement channel relation is not loaded');
    }
    const channelCode = agreement.channel.code;

    // T-057 madde 3 (docs/analysis/0008 §5.7, ADR 0004 Karar 3): this is
    // the ledger-posting envelope lookup (distinct from `BudgetService
    // #reserveForAgreement`'s RESERVE-time lookup, which already applies
    // this same rule). Use fiscal period for envelope matching (as per BRD:
    // "Bütçe buradan düşülür").
    //
    // Team Lead bağımsız doğrulama (2026-08-03): İLK teslim, agreement.spendType
    // ne olursa olsun HER ZAMAN tipli çözümü tercih ediyordu. Bu, canlı bir
    // regresyon üretti — `findEnvelopeByDimensions`'ın tipli-eşleşme sırası
    // (§5.1: "tipli eşleşme UNSPLIT'i HER ZAMAN yener") EŞDEĞER dönemi
    // GEREKTİRMEZ, yalnızca AYNI YIL + AYNI KANAL + doğru spend_type yeter —
    // yani channel=NKA üzerinde TAMAMEN alakasız bir dönemde (ör. rol
    // yolculuğu e2e'sinin A19 fixture'ı, 2026-09) test amaçlı yaratılmış bir
    // tipli zarf, bu agreement'ın GERÇEK döneminden (2026-02) bağımsız olarak
    // "kazanıyor" ve gerçek NKA-Q2 zarfının yerine geçiyordu (role-journey
    // C9c'de canlı olarak "Insufficient budget" 400'üne yol açtı — SQL kanıtı
    // T-057 teslim notlarında). UNSPLIT boyutta bugünkü davranış (unqualified
    // çağrı, dönem-öncelikli sıralama) BİREBİR korunmalıydı; ilk tasarım bunu
    // ihlal ediyordu.
    //
    // Düzeltme: T-056 adım 6 deseni artık HER İKİ dala da uygulanıyor —
    // ÖNCE unqualified çağrı (bugünkü davranışın ta kendisi, UNSPLIT'te
    // BYTE-FOR-BYTE aynı sonuç). Yalnızca bu çağrı GERÇEKTEN split edilmiş
    // bir boyuta çarpıp guard fırlatırsa (yani BAŞKA bir alakasız dönem değil,
    // TAM OLARAK bu (channel, fiscalPeriod) boyutu split edilmişse — guard'ın
    // kendi dar kapsamlı "winner'ın kendi boyutu" kontrolü, budget.repository
    // .ts'teki yanlış-pozitif düzeltmesi sayesinde), agreement.spendType'a
    // göre tipli çözüme geçilir. İkinci/bağımsız bir "split mi?" sorgusu
    // YAZILMAZ.
    //
    // T-057 B2 (code-reviewer, 2026-08-04): bu çözüm — ve özellikle
    // AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED reddi — `txRepo.create()`'ten
    // (gerçek bir DB `save`) ÖNCE yapılmalı. Aksi halde 400 dönse bile satır
    // DB'ye yazılmış olur ve bir sonraki çağrının `sumByAgreementId` cap
    // kontrolü bu "yarım durum" satırını tüketir — ADR 0004 Karar 2'nin
    // kaçınmaya çalıştığı sınıfın ta kendisi. Envelope çözümü artık
    // side-effect'siz (yalnız okuma + olası throw); DB'ye ilk yazma bu
    // bloktan SONRA, envelope kesinleşmiş haldeyken olur.
    let envelope: BudgetEnvelope | null;
    let splitDimension = false;
    try {
      envelope = await this.budgetService.findEnvelopeByDimensions(
        tenantId,
        channelCode,
        fiscalPeriod, // Use transaction fiscal period, not agreement period
      );
    } catch (err) {
      if (isSplitDimensionGuardError(err)) {
        splitDimension = true;
        envelope = null;
      } else {
        throw err;
      }
    }

    if (splitDimension) {
      if (
        agreement.spendType === AgreementSpendType.ON_INVOICE ||
        agreement.spendType === AgreementSpendType.OFF_INVOICE
      ) {
        // Typed agreement, GENUINELY split dimension — typed lookup now
        // resolves the correct twin (no ambiguity: this dimension really
        // does have ON/OFF twins).
        envelope = await this.budgetService.findEnvelopeByDimensions(
          tenantId,
          channelCode,
          fiscalPeriod,
          undefined,
          agreement.spendType as unknown as BudgetSpendType,
        );
      } else {
        // BOTH or NULL on a genuinely split dimension — cap's on/off split
        // is unknown (BRD has no evidence for how BOTH divides, §5.7);
        // reject rather than silently mis-attributing to one arbitrary twin.
        // No transaction row has been written yet — clean, no-op reject.
        throw new BadRequestException({
          statusCode: 400,
          code: 'AGREEMENT_SPEND_TYPE_SPLIT_REQUIRED',
          message:
            'This budget dimension has been split into ON_INVOICE/OFF_INVOICE envelopes; agreement.spend_type must be ON_INVOICE or OFF_INVOICE (BOTH/NULL is not allowed here).',
        });
      }
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
        const transaction = await this.create(
          txDto,
          tenantId,
          userId,
          batchId,
          rowNumber,
        );

        result.successCount++;
        result.createdTransactions.push(transaction.id);
      } catch (error) {
        result.errorCount++;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
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

  async findByAgreementId(
    agreementId: string,
    tenantId: string,
  ): Promise<AgreementTransaction[]> {
    return this.txRepo.findByAgreementId(agreementId, tenantId);
  }

  async findByBatchId(
    batchId: string,
    tenantId: string,
  ): Promise<AgreementTransaction[]> {
    return this.txRepo.findByBatchId(batchId, tenantId);
  }

  async findAll(
    tenantId: string,
    filters?: {
      agreementId?: string;
      batchId?: string;
      invoiceDateFrom?: Date;
      invoiceDateTo?: Date;
      cplId?: string;
    },
  ): Promise<AgreementTransaction[]> {
    return this.txRepo.findAll(tenantId, filters);
  }

  async getTotalByAgreement(
    agreementId: string,
    tenantId: string,
  ): Promise<number> {
    return this.txRepo.sumByAgreementId(agreementId, tenantId);
  }

  async getCount(tenantId: string): Promise<number> {
    return this.txRepo.count(tenantId);
  }
}

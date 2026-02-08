import { Injectable, NotFoundException } from '@nestjs/common';
import { LedgerRepository } from './ledger.repository';
import { CreateLedgerEntryDto, LedgerSourceType } from './dto';
import { LedgerEntry, LedgerEntryDirection, SpendType } from '../../../../database/entities/ledger-entry.entity';

@Injectable()
export class LedgerService {
  constructor(
    private readonly ledgerRepo: LedgerRepository,
  ) {}

  /**
   * Create ledger entry with idempotency check
   * Called when off-invoice transaction is posted
   */
  async createEntry(
    dto: CreateLedgerEntryDto,
    tenantId: string,
    userId: string,
    idempotencyKey: string,
  ): Promise<LedgerEntry> {
    // Check idempotency - return existing if already processed
    const existing = await this.ledgerRepo.findByIdempotencyKey(idempotencyKey, tenantId);
    if (existing) {
      return existing; // Idempotent: return existing entry
    }

    // Create new ledger entry
    const entry = await this.ledgerRepo.create({
      ...dto,
      tenantId,
      idempotencyKey,
      entryDirection: LedgerEntryDirection.DEBIT, // Default for spend
      currency: dto.currency || 'TRY',
      createdBy: userId,
      postingDate: new Date(dto.postingDate),
    });

    return entry;
  }

  /**
   * Create ledger entry from agreement transaction (off-invoice)
   * Idempotency key format: LEDGER|AGREEMENT|{agreement_id}|{transaction_id}
   */
  async createFromAgreementTransaction(
    agreementId: string,
    transactionId: string,
    amount: number,
    postingDate: Date,
    periodMonth: string,
    budgetEnvelopeId: string,
    dimensions: {
      channel?: string;
      cplId?: string;
      fuId?: string;
      tacticId?: string;
      mechanicId?: string;
    },
    tenantId: string,
    userId: string,
  ): Promise<LedgerEntry> {
    const idempotencyKey = `LEDGER|AGREEMENT|${agreementId}|${transactionId}`;

    return this.createEntry(
      {
        sourceType: LedgerSourceType.AGREEMENT,
        sourceId: agreementId,
        agreementId,
        spendType: SpendType.OFF_INVOICE,
        amount,
        periodMonth,
        postingDate: postingDate.toISOString().split('T')[0],
        budgetEnvelopeId,
        ...dimensions,
      },
      tenantId,
      userId,
      idempotencyKey,
    );
  }

  async findById(id: string, tenantId: string): Promise<LedgerEntry> {
    const entry = await this.ledgerRepo.findById(id, tenantId);
    if (!entry) {
      throw new NotFoundException('Ledger entry not found');
    }
    return entry;
  }

  async findByAgreementId(agreementId: string, tenantId: string): Promise<LedgerEntry[]> {
    return this.ledgerRepo.findByAgreementId(agreementId, tenantId);
  }

  async findByEnvelopeId(envelopeId: string, tenantId: string): Promise<LedgerEntry[]> {
    return this.ledgerRepo.findByEnvelopeId(envelopeId, tenantId);
  }

  async findAll(tenantId: string, filters?: {
    agreementId?: string;
    budgetEnvelopeId?: string;
    periodMonth?: string;
    spendType?: string;
  }): Promise<LedgerEntry[]> {
    return this.ledgerRepo.findAll(tenantId, filters);
  }

  /**
   * Get total consumed amount for an agreement
   */
  async getConsumedByAgreement(agreementId: string, tenantId: string): Promise<number> {
    return this.ledgerRepo.sumByAgreementId(agreementId, tenantId);
  }

  /**
   * Get total consumed amount for a budget envelope
   */
  async getConsumedByEnvelope(envelopeId: string, tenantId: string): Promise<number> {
    return this.ledgerRepo.sumByEnvelopeId(envelopeId, tenantId);
  }
}


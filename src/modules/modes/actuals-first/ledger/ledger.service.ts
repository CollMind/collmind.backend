import { Injectable, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { LedgerRepository } from './ledger.repository';
import { CreateLedgerEntryDto, LedgerSourceType } from './dto';
import {
  LedgerEntry,
  LedgerEntryDirection,
  SpendType,
} from '../../../../database/entities/ledger-entry.entity';

@Injectable()
export class LedgerService {
  constructor(private readonly ledgerRepo: LedgerRepository) {}

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
    const existing = await this.ledgerRepo.findByIdempotencyKey(
      idempotencyKey,
      tenantId,
    );
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

  /**
   * Create a reversal (credit) entry for the given original DEBIT ledger entry.
   *
   * Rules:
   *  - direction = opposite of original (DEBIT → CREDIT)
   *  - amount = abs(original.amount)
   *  - copies dimensions / envelope / periodMonth / spendType from original
   *  - reversesEntryId = original.id
   *  - idempotencyKey = 'REVERSAL|LEDGER|{originalId}' (NOT NULL unique guaranteed)
   *
   * Must be called inside an active QueryRunner transaction.
   */
  async createReversalEntry(
    originalEntryId: string,
    tenantId: string,
    userId: string,
    queryRunner: QueryRunner,
  ): Promise<LedgerEntry> {
    const original = await this.ledgerRepo.findById(originalEntryId, tenantId);
    if (!original) {
      throw new NotFoundException(
        `Original ledger entry ${originalEntryId} not found`,
      );
    }

    const idempotencyKey = `REVERSAL|LEDGER|${originalEntryId}`;
    const reversalDirection =
      original.entryDirection === LedgerEntryDirection.DEBIT
        ? LedgerEntryDirection.CREDIT
        : LedgerEntryDirection.DEBIT;

    const entry = queryRunner.manager.create(LedgerEntry, {
      tenantId,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      agreementId: original.agreementId,
      spendType: original.spendType,
      entryDirection: reversalDirection,
      amount: Math.abs(Number(original.amount)),
      currency: original.currency,
      periodMonth: original.periodMonth,
      postingDate: new Date(),
      channel: original.channel,
      cplId: original.cplId,
      fuId: original.fuId,
      tacticId: original.tacticId,
      mechanicId: original.mechanicId,
      budgetEnvelopeId: original.budgetEnvelopeId,
      idempotencyKey,
      reversesEntryId: original.id,
      isReversed: false,
      description: `Reversal of ledger entry ${originalEntryId}`,
      createdBy: userId,
    });

    return queryRunner.manager.save(LedgerEntry, entry);
  }

  /**
   * Find the unreversed DEBIT entry for an agreement (source for reversal).
   *
   * @deprecated Use findDebitEntryByTransactionIdempotencyKey for transaction-specific
   * reversal lookup. This method is ambiguous for agreements with multiple transactions.
   */
  async findDebitEntryByAgreementId(
    agreementId: string,
    tenantId: string,
  ): Promise<LedgerEntry | null> {
    return this.ledgerRepo.findDebitEntryByAgreementId(agreementId, tenantId);
  }

  /**
   * Find the unreversed DEBIT ledger entry that was created for a specific
   * agreement transaction.
   *
   * Reconstructs the idempotency key written by createFromAgreementTransaction:
   *   'LEDGER|AGREEMENT|{agreementId}|{transactionId}'
   *
   * This is the correct lookup to use during reversal: it targets exactly the
   * entry tied to the transaction being reversed, regardless of how many other
   * transactions exist on the same agreement.
   */
  async findDebitEntryByTransactionIdempotencyKey(
    agreementId: string,
    transactionId: string,
    tenantId: string,
  ): Promise<LedgerEntry | null> {
    const idempotencyKey = `LEDGER|AGREEMENT|${agreementId}|${transactionId}`;
    return this.ledgerRepo.findDebitEntryByIdempotencyKey(
      idempotencyKey,
      tenantId,
    );
  }

  /**
   * Check if a reversal already exists for a ledger entry (app-layer guard).
   */
  async findReversalByOriginalId(
    originalEntryId: string,
    tenantId: string,
  ): Promise<LedgerEntry | null> {
    return this.ledgerRepo.findReversalByOriginalId(originalEntryId, tenantId);
  }

  async findById(id: string, tenantId: string): Promise<LedgerEntry> {
    const entry = await this.ledgerRepo.findById(id, tenantId);
    if (!entry) {
      throw new NotFoundException('Ledger entry not found');
    }
    return entry;
  }

  async findByAgreementId(
    agreementId: string,
    tenantId: string,
  ): Promise<LedgerEntry[]> {
    return this.ledgerRepo.findByAgreementId(agreementId, tenantId);
  }

  async findByEnvelopeId(
    envelopeId: string,
    tenantId: string,
  ): Promise<LedgerEntry[]> {
    return this.ledgerRepo.findByEnvelopeId(envelopeId, tenantId);
  }

  async findAll(
    tenantId: string,
    filters?: {
      agreementId?: string;
      budgetEnvelopeId?: string;
      periodMonth?: string;
      spendType?: string;
    },
  ): Promise<LedgerEntry[]> {
    return this.ledgerRepo.findAll(tenantId, filters);
  }

  /**
   * Get total consumed amount for an agreement
   */
  async getConsumedByAgreement(
    agreementId: string,
    tenantId: string,
  ): Promise<number> {
    return this.ledgerRepo.sumByAgreementId(agreementId, tenantId);
  }

  /**
   * Get total consumed amount for a budget envelope
   */
  async getConsumedByEnvelope(
    envelopeId: string,
    tenantId: string,
  ): Promise<number> {
    return this.ledgerRepo.sumByEnvelopeId(envelopeId, tenantId);
  }
}

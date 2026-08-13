import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LedgerEntry,
  LedgerEntryDirection,
} from '../../../../database/entities/ledger-entry.entity';

@Injectable()
export class LedgerRepository {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly repo: Repository<LedgerEntry>,
  ) {}

  async create(data: Partial<LedgerEntry>): Promise<LedgerEntry> {
    const entry = this.repo.create(data);
    return this.repo.save(entry);
  }

  // B dalgası / R1 (K-2.3.4): `ledger_entries.deleted_at` KALDIRILDI — defter kayıtları
  // asla soft-delete edilmez (immutability invariant). `deletedAt: IsNull()` filtreleri
  // aşağıda ÇIKARILDI; entity artık bu alanı taşımıyor (ImmutableBaseEntity).
  async findById(id: string, tenantId: string): Promise<LedgerEntry | null> {
    return this.repo.findOne({
      where: { id, tenantId },
    });
  }

  async findByIdempotencyKey(
    key: string,
    tenantId: string,
  ): Promise<LedgerEntry | null> {
    return this.repo.findOne({
      where: { idempotencyKey: key, tenantId },
    });
  }

  async findByAgreementId(
    agreementId: string,
    tenantId: string,
  ): Promise<LedgerEntry[]> {
    return this.repo.find({
      where: { agreementId, tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByEnvelopeId(
    envelopeId: string,
    tenantId: string,
  ): Promise<LedgerEntry[]> {
    return this.repo.find({
      where: { budgetEnvelopeId: envelopeId, tenantId },
      order: { createdAt: 'DESC' },
    });
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
    const query = this.repo
      .createQueryBuilder('ledger')
      .where('ledger.tenantId = :tenantId', { tenantId });

    if (filters?.agreementId) {
      query.andWhere('ledger.agreementId = :agreementId', {
        agreementId: filters.agreementId,
      });
    }
    if (filters?.budgetEnvelopeId) {
      query.andWhere('ledger.budgetEnvelopeId = :budgetEnvelopeId', {
        budgetEnvelopeId: filters.budgetEnvelopeId,
      });
    }
    if (filters?.periodMonth) {
      query.andWhere('ledger.periodMonth = :periodMonth', {
        periodMonth: filters.periodMonth,
      });
    }
    if (filters?.spendType) {
      query.andWhere('ledger.spendType = :spendType', {
        spendType: filters.spendType,
      });
    }

    return query.orderBy('ledger.createdAt', 'DESC').getMany();
  }

  /**
   * Sum net spend for an agreement.
   *
   * DEBIT entries increase spend (normal transactions).
   * CREDIT entries decrease spend (reversals).
   *
   * Formula: SUM(DEBIT amounts) - SUM(CREDIT amounts)
   *
   * REGRESYON NOTU: Bu metodu tüketen yerler:
   *   - LedgerService.getConsumedByAgreement → AgreementTransactionService (cap check dahil)
   *   - FinanceReportingService (varsa)
   * Reversal öncesinde bu metod yalnızca DEBIT topladığı için
   * credit entry eklenir eklenmez net sonuç azalacak — istenen davranış budur.
   */
  async sumByAgreementId(
    agreementId: string,
    tenantId: string,
  ): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('ledger')
      .select(
        `COALESCE(SUM(CASE WHEN ledger.entryDirection = '${LedgerEntryDirection.DEBIT}' THEN ledger.amount ELSE 0 END), 0)` +
          ` - COALESCE(SUM(CASE WHEN ledger.entryDirection = '${LedgerEntryDirection.CREDIT}' THEN ledger.amount ELSE 0 END), 0)`,
        'total',
      )
      .where('ledger.agreementId = :agreementId', { agreementId })
      .andWhere('ledger.tenantId = :tenantId', { tenantId })
      .getRawOne();
    return parseFloat(result.total) || 0;
  }

  /**
   * Sum net spend for a budget envelope.
   *
   * Same DEBIT-minus-CREDIT direction logic as sumByAgreementId.
   *
   * REGRESYON NOTU: Bu metodu tüketen yerler:
   *   - LedgerService.getConsumedByEnvelope → BudgetSummaryView ile birlikte kullanılabilir
   * Mevcut tüketiciler bu değeri "consumed" olarak raporluyor; reversal ile azalması beklenen davranış.
   */
  async sumByEnvelopeId(envelopeId: string, tenantId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('ledger')
      .select(
        `COALESCE(SUM(CASE WHEN ledger.entryDirection = '${LedgerEntryDirection.DEBIT}' THEN ledger.amount ELSE 0 END), 0)` +
          ` - COALESCE(SUM(CASE WHEN ledger.entryDirection = '${LedgerEntryDirection.CREDIT}' THEN ledger.amount ELSE 0 END), 0)`,
        'total',
      )
      .where('ledger.budgetEnvelopeId = :envelopeId', { envelopeId })
      .andWhere('ledger.tenantId = :tenantId', { tenantId })
      .getRawOne();
    return parseFloat(result.total) || 0;
  }

  /**
   * Find the original (non-reversed, DEBIT) ledger entry for an agreement.
   * Used by reversal service to locate the source entry.
   *
   * @deprecated Prefer findDebitEntryByIdempotencyKey for transaction-specific lookup.
   * This method returns the oldest unreversed DEBIT for the agreement which is
   * ambiguous when an agreement has multiple transactions (batch import).
   */
  async findDebitEntryByAgreementId(
    agreementId: string,
    tenantId: string,
  ): Promise<LedgerEntry | null> {
    return this.repo.findOne({
      where: {
        agreementId,
        tenantId,
        entryDirection: LedgerEntryDirection.DEBIT,
        isReversed: false,
      },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Find a specific DEBIT ledger entry by its idempotency key.
   *
   * Idempotency key format written by LedgerService.createFromAgreementTransaction:
   *   'LEDGER|AGREEMENT|{agreementId}|{transactionId}'
   *
   * This is the correct method to use during reversal because it pinpoints the
   * exact entry that was created for the transaction being reversed, avoiding
   * the ambiguity of findDebitEntryByAgreementId when multiple transactions
   * exist on the same agreement (batch import scenarios).
   *
   * Filters: DEBIT direction + isReversed=false for safety (matching original entry).
   */
  async findDebitEntryByIdempotencyKey(
    idempotencyKey: string,
    tenantId: string,
  ): Promise<LedgerEntry | null> {
    return this.repo.findOne({
      where: {
        idempotencyKey,
        tenantId,
        entryDirection: LedgerEntryDirection.DEBIT,
        isReversed: false,
      },
    });
  }

  /**
   * Check if a reversal entry already exists for a given original entry.
   * Used for app-layer double-reversal guard (in addition to DB unique index).
   */
  async findReversalByOriginalId(
    originalEntryId: string,
    tenantId: string,
  ): Promise<LedgerEntry | null> {
    return this.repo.findOne({
      where: {
        reversesEntryId: originalEntryId,
        tenantId,
      },
    });
  }

  /**
   * Mark a ledger entry as reversed.
   * Called inside a QueryRunner transaction — uses the runner's manager.
   */
  async markAsReversed(
    id: string,
    queryRunner: import('typeorm').QueryRunner,
  ): Promise<void> {
    await queryRunner.manager.update(LedgerEntry, { id }, { isReversed: true });
  }
}

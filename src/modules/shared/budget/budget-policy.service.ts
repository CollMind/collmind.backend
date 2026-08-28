import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { BudgetPolicy } from '../../../database/entities/budget-policy.entity';
import { parseFiniteOnRead } from '../../../database/transformers/decimal.transformer';

/**
 * `warning_threshold_pct` / `finance_review_threshold_pct` / `block_threshold_pct`
 * are driver-string `numeric` columns without a column `transformer` (`Alan B`,
 * ADR 0007 Karar 1/2 — bkz. `budget-policy.entity.ts`, cataloged by `T-228`).
 * `parseFiniteOnRead` (same finite/NaN/Infinity guard `DecimalTransformer.from`
 * uses) reads them at THIS boundary instead of a bare `Number()` here — see
 * that function's doc for why.
 */
function readPct(raw: number, columnName: string): number {
  const parsed = parseFiniteOnRead(raw as unknown as string);
  if (parsed === null || parsed === undefined) {
    // NOT NULL sütun — sürücü null döndürürse bu bir okunamama durumudur,
    // §2.5: varsayılan atanmaz, açık hata.
    throw new InternalServerErrorException(
      `BudgetPolicy.${columnName} okunamadı (null/undefined) — beklenmeyen sürücü değeri`,
    );
  }
  return parsed;
}

/**
 * T-316 (`Z57 §1`): `budget_policies` canlanır — DAVRANIŞ merdiveni
 * (`K-2.2.7a`: %80 uyarı / %90 finans-inceleme / %100 blok).
 *
 * ⛔ Bu servis `BudgetThresholdService` (RENK/RAG merdiveni,
 * `budget_alert_configurations`) ile BİRLEŞTİRİLMEZ — `K-2.2.8`'in bilerek
 * ayırdığı iki farklı olgudur (bkz. `budget-policy.entity.ts` doc). Bu
 * dosya yalnız `budget_policies`'i okur.
 *
 * ⚠️ `%100 BLOCKED` kademesinin UYGULANMASI (bloklama davranışı) bu task'ın
 * kapsamı DIŞINDADIR — `T-321`, hüküm bekliyor. Bu servis yalnız
 * `blockPct` değerini KONFIGÜRASYONDAN okuyup döndürür; onu bir kontrole
 * bağlamak ayrı bir task'ın işi.
 */

export const BUDGET_POLICY_NOT_CONFIGURED_CODE = 'BUDGET_POLICY_NOT_CONFIGURED';
export const BUDGET_POLICY_AMBIGUOUS_CODE = 'BUDGET_POLICY_AMBIGUOUS';

export interface BudgetPolicySource {
  readonly policyId: string;
  readonly channelId: string | null;
  readonly categoryId: string | null;
}

export interface ResolvedBudgetPolicy {
  readonly warningPct: number;
  readonly financeReviewPct: number;
  readonly blockPct: number;
  readonly financeReviewMode: 'NOTIFY' | 'APPROVE';
  readonly source: BudgetPolicySource;
}

@Injectable()
export class BudgetPolicyService {
  private readonly logger = new Logger(BudgetPolicyService.name);

  constructor(
    @InjectRepository(BudgetPolicy)
    private readonly policyRepo: Repository<BudgetPolicy>,
  ) {}

  /**
   * `K-2.2.8a`–`c` çözümlemesi: iki boyut (kanal · kategori), en spesifik
   * kayıt kazanır. `channelId`/`categoryId` verilmezse (`undefined`/`null`),
   * o boyutta yalnız joker (`IS NULL`) satırlar aday olur — belirtilmeyen
   * bir boyut için o boyuma özel bir politika ASLA uygulanmaz (aksi hâlde
   * kanalı bilinmeyen bir çağrı, rastgele bir kanalın politikasına düşebilir).
   *
   * `§2.5` sessiz sıfır yasağı: eşik okunamıyorsa (sıfır aday veya belirsiz
   * çözümleme) varsayılan atanmaz — açık hata fırlatılır.
   */
  async resolvePolicy(
    tenantId: string,
    channelId?: string | null,
    categoryId?: string | null,
  ): Promise<ResolvedBudgetPolicy> {
    if (!tenantId) {
      throw new BadRequestException(
        'BudgetPolicyService#resolvePolicy: tenantId zorunlu',
      );
    }

    const channelConds: Array<string | ReturnType<typeof IsNull>> = channelId
      ? [channelId, IsNull()]
      : [IsNull()];
    const categoryConds: Array<string | ReturnType<typeof IsNull>> = categoryId
      ? [categoryId, IsNull()]
      : [IsNull()];

    const whereClauses: Array<FindOptionsWhere<BudgetPolicy>> = [];
    for (const channelCond of channelConds) {
      for (const categoryCond of categoryConds) {
        whereClauses.push({
          tenantId,
          channelId: channelCond as string,
          categoryId: categoryCond as string,
        });
      }
    }

    const candidates = await this.policyRepo.find({ where: whereClauses });

    if (candidates.length === 0) {
      // K-2.2.8d: her kiracıda bir joker satır ZORUNLUDUR. Sıfır sonuç bir
      // veri eksikliğidir, bir "eşiksiz" durum değil — varsayılan atamak
      // §2.5'i ihlal eder.
      this.logger.error(
        `BudgetPolicy resolution: ZERO rows for tenant=${tenantId} ` +
          `channel=${channelId ?? 'null'} category=${categoryId ?? 'null'} ` +
          `— K-2.2.8d joker satırı eksik`,
      );
      throw new InternalServerErrorException({
        code: BUDGET_POLICY_NOT_CONFIGURED_CODE,
        message:
          `Bütçe politikası yapılandırılmamış (tenant=${tenantId}). ` +
          `K-2.2.8d joker satırı bekleniyordu, bulunamadı.`,
      });
    }

    const specificity = (row: BudgetPolicy): number =>
      (row.channelId ? 1 : 0) + (row.categoryId ? 1 : 0);

    const maxSpecificity = Math.max(...candidates.map(specificity));
    const winners = candidates.filter(
      (candidate) => specificity(candidate) === maxSpecificity,
    );

    if (winners.length > 1) {
      // K-2.2.8c iddiası: "eşit spesifiklik mümkün değildir". DB tekillik
      // kısıtı (UNIQUE NULLS NOT DISTINCT (tenant,channel,category)) AYNI
      // tuple'ı engeller — ama bir kanal-only satır (channel=X,
      // category=NULL) ile bir kategori-only satır (channel=NULL,
      // category=Y) FARKLI tuple'lardır ve kısıt bunları engellemez.
      // İkisi de tam bu sorguda specificity=1 ile eşit ağırlıkta çıkabilir.
      // §2.5 gizli tie-break yasağı: sessizce biri seçilmez — açık hata.
      // (Bu, K-2.2.8c'nin BRD'deki iddiasıyla ölçülmüş bir sapmadır; kod
      // bilerek daha katı davranıyor — bkz. task raporu.)
      this.logger.error(
        `BudgetPolicy AMBIGUOUS resolution for tenant=${tenantId} ` +
          `channel=${channelId ?? 'null'} category=${categoryId ?? 'null'}: ` +
          `${winners.length} eşit-spesifiklikte satır ` +
          `(${winners.map((w) => w.id).join(', ')})`,
      );
      throw new InternalServerErrorException({
        code: BUDGET_POLICY_AMBIGUOUS_CODE,
        message:
          `Bütçe politikası çözümlemesi belirsiz (tenant=${tenantId}): ` +
          `${winners.length} eşit-spesifiklikte kayıt bulundu.`,
      });
    }

    const winner = winners[0];
    return {
      warningPct: readPct(winner.warningThresholdPct, 'warningThresholdPct'),
      financeReviewPct: readPct(
        winner.financeReviewThresholdPct,
        'financeReviewThresholdPct',
      ),
      blockPct: readPct(winner.blockThresholdPct, 'blockThresholdPct'),
      financeReviewMode: winner.financeReviewMode,
      source: {
        policyId: winner.id,
        channelId: winner.channelId ?? null,
        categoryId: winner.categoryId ?? null,
      },
    };
  }
}

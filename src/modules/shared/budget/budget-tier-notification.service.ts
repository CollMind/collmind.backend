import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  BudgetEnvelope,
  BudgetEnvelopeNotifiedTier,
} from '../../../database/entities/budget-envelope.entity';
import { BudgetSummaryView } from '../../../database/entities/budget-summary.view-entity';
import {
  BudgetPolicyService,
  ResolvedBudgetPolicy,
} from './budget-policy.service';
import { NotificationService } from '../../notification/notification.service';
import {
  NotificationChannel,
  NotificationType,
} from '../../../database/entities/notification.entity';
import { UserRepository } from '../../user/user.repository';
import { UserRole } from '../../../database/entities/user.entity';

/**
 * `T-318` (`Z57 §3`): olay üretimi — `K-2.2.7a` davranış merdiveninin
 * `WARNING` (%80) ve `FINANCE_REVIEW` (%90) kademeleri için bildirim.
 *
 * ⛔ `BLOCKED` (%100) BİLEREK DIŞARIDA — `T-321`, hüküm bekliyor (`Z57 §3b`).
 * Bu servis `policy.blockPct`'i hiç OKUMAZ ve `BudgetEnvelopeNotifiedTier
 * .BLOCKED`'ı hiçbir zaman YAZMAZ; enum değeri `T-317`'de tanımlı ama bu
 * servisin ulaşabileceği en yüksek kademe `FINANCE_REVIEW`'dir.
 *
 * ⛔ `K-2.2.7c`: eşikler yalnız PLAN/TAAHHÜT tarafına uygulanır (gerçekleşen
 * bir ledger/hakediş bütçe eşiğine takılmaz). Bu yüzden bu servis YALNIZ
 * `budget_transactions` (RESERVE/COMMIT/RELEASE) yazıldığında çağrılır —
 * `BudgetService#writeTransaction` / `BudgetReservationService` TEK yazma
 * yolundan (`§7`: ölçüldü, `budgetRepository.createTransaction`'ı çağıran
 * İKİ dosya var, üçüncüsü yok). `ledger_entries` yazan yollar (settlement/
 * on-invoice/reversal) bu servisi ÇAĞIRMAZ — bilerek.
 *
 * `P3` tekrar-bastırma: `envelope.lastNotifiedTier` TEK durum değişkenidir
 * (tarihçe değil, `T-317` doc'u). Bu metod her çağrıda GÜNCEL yüzdeden
 * `finalTier`'i YENİDEN türetir ve saklanan tier'la karşılaştırır — hem
 * yukarı (bildirim üretir) hem aşağı (sessizce durum günceller, gelecekteki
 * bir yukarı-geçişin yeniden bildirim üretebilmesi için) geçişleri kapsar.
 *
 * `Z59` (`04_KARAR_KAYDI.md`) — bu dosyanın ilk hâli `budget_owner_id` boşsa
 * `WARNING` yolunda hard-throw yapıyordu (canlı 4/4 NULL zarfın SONRAKİ her
 * RESERVE/COMMIT/RELEASE çağrısını 500 ile kesiyordu). `Z59` bunu `K-2.2.7c`'
 * nin ("aşımda bile süreç durmaz") bildirim katmanına genellenmesi olarak
 * hükme bağladı: `WARNING` yolunda owner çözümlenemezse `FINANCE`'e GÖRÜNÜR
 * bir fallback yapılır (`notifyWarningFallbackToFinance`), `FINANCE_REVIEW`
 * yolunda boş küme hâlâ AÇIK HATADIR (o bir kurulum hatasıdır, `Z59 §4`).
 * Seed backfill (`budget-envelope.seed.ts#backfillBudgetEnvelopeOwners`,
 * `Z59 §3b`) mevcut zarflara kanonik bir owner atar; ama `budgetOwnerId`
 * create/split akışında opsiyonel KALIR (`Z59 §3`) — "owner'sız zarf" meşru
 * bir durumdur ve bu servisin hard-throw ETMEMESİ o yüzden gereklidir.
 */
@Injectable()
export class BudgetTierNotificationService {
  private readonly logger = new Logger(BudgetTierNotificationService.name);

  private static readonly TIER_RANK: Record<
    BudgetEnvelopeNotifiedTier,
    number
  > = {
    [BudgetEnvelopeNotifiedTier.NONE]: 0,
    [BudgetEnvelopeNotifiedTier.WARNING]: 1,
    [BudgetEnvelopeNotifiedTier.FINANCE_REVIEW]: 2,
    [BudgetEnvelopeNotifiedTier.BLOCKED]: 3,
  };

  constructor(
    @InjectRepository(BudgetEnvelope)
    private readonly envelopeRepository: Repository<BudgetEnvelope>,
    private readonly dataSource: DataSource,
    private readonly budgetPolicyService: BudgetPolicyService,
    private readonly notificationService: NotificationService,
    private readonly userRepository: UserRepository,
  ) {}

  /**
   * `manager` verilirse (çağıran hâlâ açık bir QueryRunner transaction'ı
   * içindeyse) hem envelope hem `v_budget_summary` okuması O manager
   * üzerinden yapılır — aksi hâlde henüz commit edilmemiş RESERVE/COMMIT/
   * RELEASE satırı görünmez kalır ve yüzde YANLIŞ hesaplanır.
   */
  async evaluateAndNotify(
    tenantId: string,
    envelopeId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const envelopeRepo = manager
      ? manager.getRepository(BudgetEnvelope)
      : this.envelopeRepository;

    const envelope = await envelopeRepo.findOne({
      where: { tenantId, id: envelopeId },
    });
    if (!envelope) {
      // Bu metod her zaman az önce yazılmış bir budget_transaction'ın
      // envelopeId'siyle çağrılır — bulunamaması bir veri tutarsızlığıdır.
      throw new InternalServerErrorException(
        `BudgetTierNotificationService: envelope bulunamadı (envelope=${envelopeId}, tenant=${tenantId})`,
      );
    }

    const summaryRepo = manager
      ? manager.getRepository(BudgetSummaryView)
      : this.dataSource.getRepository(BudgetSummaryView);
    const summary = await summaryRepo.findOne({
      where: { envelopeId, tenantId },
    });
    if (!summary) {
      throw new InternalServerErrorException(
        `BudgetTierNotificationService: v_budget_summary satırı yok (envelope=${envelopeId}, tenant=${tenantId})`,
      );
    }

    // `summary.utilizationPct` is already a number at this boundary — the
    // ViewColumn's `DecimalTransformer` converts driver-string -> number on
    // read (see that transformer's doc). No re-parse here (ADR 0007 Karar
    // 3b: a bare `Number()`/`parseFloat` on a Domain A path is itself a
    // ratcheted finding, even when — as here — the value is already safe).
    const percent = summary.utilizationPct;
    if (!Number.isFinite(percent)) {
      throw new InternalServerErrorException(
        `BudgetTierNotificationService: utilizationPct okunamadı/finite değil (envelope=${envelopeId})`,
      );
    }

    // `K-2.2.8`: konfigürasyondan — AMBIGUOUS/NOT_CONFIGURED hataları
    // burada YUTULMAZ, çağırana taşınır (§2.5).
    const policy = await this.budgetPolicyService.resolvePolicy(
      tenantId,
      envelope.channelId ?? null,
      envelope.categoryId ?? null,
    );

    const finalTier: BudgetEnvelopeNotifiedTier =
      percent >= policy.financeReviewPct
        ? BudgetEnvelopeNotifiedTier.FINANCE_REVIEW
        : percent >= policy.warningPct
          ? BudgetEnvelopeNotifiedTier.WARNING
          : BudgetEnvelopeNotifiedTier.NONE;

    const originalTier = envelope.lastNotifiedTier;
    const rank = BudgetTierNotificationService.TIER_RANK;
    const originalRank = rank[originalTier];
    const finalRank = rank[finalTier];

    if (finalRank > originalRank) {
      if (
        finalRank >= rank[BudgetEnvelopeNotifiedTier.WARNING] &&
        originalRank < rank[BudgetEnvelopeNotifiedTier.WARNING]
      ) {
        await this.notifyWarning(tenantId, envelope, summary, percent, manager);
      }
      if (
        finalRank >= rank[BudgetEnvelopeNotifiedTier.FINANCE_REVIEW] &&
        originalRank < rank[BudgetEnvelopeNotifiedTier.FINANCE_REVIEW]
      ) {
        await this.notifyFinanceReview(
          tenantId,
          envelope,
          summary,
          percent,
          policy,
          manager,
        );
      }
    }

    if (finalTier !== originalTier) {
      await envelopeRepo.update(
        { id: envelopeId, tenantId },
        { lastNotifiedTier: finalTier },
      );
    }
  }

  /**
   * `WARNING` (%80) alıcısı: zarfın `budget_owner_id`si — `getBudgetAlert80Template`
   * (`notification.service.ts`, T-249 öncesinden yaşıyor) zaten bu alanı
   * bekliyordu (`§7` araması: şablon var, üretici hiç yoktu).
   *
   * `Z59 §2`/`§4`: owner çözümlenemezse (ne hiç atanmamış ne de var olan bir
   * kullanıcıya işaret ediyor) hard-throw YAPILMAZ — bu, `WARNING` yolunun
   * `FINANCE` yolundan (§4 tablosu) FARKLI hükmüdür: `FINANCE` boş kümesi
   * kurulum hatasıdır (hâlâ açık hata, bkz. `notifyFinanceReview`); `WARNING`
   * boş kümesi görünür bir fallback'e düşer (`notifyWarningFallbackToFinance`).
   */
  private async notifyWarning(
    tenantId: string,
    envelope: BudgetEnvelope,
    summary: BudgetSummaryView,
    percent: number,
    manager?: EntityManager,
  ): Promise<void> {
    const owner = envelope.budgetOwnerId
      ? await this.userRepository.findById(tenantId, envelope.budgetOwnerId)
      : null;

    if (!owner) {
      const reason: 'OWNER_UNSET' | 'OWNER_NOT_FOUND' = envelope.budgetOwnerId
        ? 'OWNER_NOT_FOUND'
        : 'OWNER_UNSET';
      await this.notifyWarningFallbackToFinance(
        tenantId,
        envelope,
        summary,
        percent,
        reason,
        manager,
      );
      return;
    }

    this.logger.warn(
      `Budget envelope ${envelope.code} (${envelope.id}) reached WARNING tier ` +
        `(${percent}%) — notifying owner ${owner.email}`,
    );

    await this.notificationService.createNotification(
      tenantId,
      NotificationType.BUDGET_ALERT_80,
      owner.id,
      owner.email,
      owner.fullName,
      this.buildMetadata(envelope, summary, percent),
      [NotificationChannel.IN_APP],
      manager,
    );
  }

  /**
   * `Z59 §2` — GÖRÜNÜR FALLBACK, üç katman:
   *   (a) bildirim GÖVDESİNE: FINANCE'e giden mesaj "bütçe sahibine (tanımsız)
   *       yönlendirilemedi" bilgisini taşır (`buildMetadata`'nın
   *       `fallbackRecipient`/`fallbackReason` alanları → şablon, bkz.
   *       `notification.service.ts#getBudgetAlert80Template`). **Asıl satır
   *       budur** — bir log satırı kullanıcıya ulaşmaz.
   *   (b) log'a yapılandırılmış uyarı (taranabilir/sayılabilir)
   *   (c) `last_notified_tier` bu metoddan ETKİLENMEZ — çağıran
   *       (`evaluateAndNotify`) fallback'ten SONRA normal şekilde günceller;
   *       fallback tekrar-bastırmayı BOZMAZ.
   *
   * `FINANCE` de boşsa (§4: bu artık bir KURULUM hatasıdır — sistem zaten
   * çalışamaz) açık hata kalır; owner-boşluğu bunu ÖRTMEZ.
   */
  private async notifyWarningFallbackToFinance(
    tenantId: string,
    envelope: BudgetEnvelope,
    summary: BudgetSummaryView,
    percent: number,
    reason: 'OWNER_UNSET' | 'OWNER_NOT_FOUND',
    manager?: EntityManager,
  ): Promise<void> {
    const financeUsers = await this.userRepository.findByRole(
      tenantId,
      UserRole.FINANCE,
    );
    if (financeUsers.length === 0) {
      throw new InternalServerErrorException({
        code: 'BUDGET_TIER_RECIPIENT_EMPTY',
        message:
          `WARNING (%80) bildirimi için zarf ${envelope.code} (${envelope.id}) ` +
          `sahibi çözümlenemedi (${reason}) VE tenant ${tenantId} içinde ` +
          `FINANCE rolünde kullanıcı da yok — §2.5: alıcı kümesi boş, ` +
          `sessiz atlanmaz.`,
      });
    }

    // (b) log — yapılandırılmış, taranabilir/sayılabilir.
    this.logger.warn(
      `BUDGET_TIER_WARNING_FALLBACK envelope=${envelope.code} (${envelope.id}) ` +
        `tenant=${tenantId} reason=${reason} percent=${percent} ` +
        `fallbackRecipientRole=FINANCE fallbackRecipientCount=${financeUsers.length}`,
    );

    // (a) ürün yüzeyi — asıl satır: alıcı, fallback-alıcısı olduğunu bilir.
    const metadata = {
      ...this.buildMetadata(envelope, summary, percent),
      fallbackRecipient: true,
      fallbackReason: reason,
    };

    for (const user of financeUsers) {
      await this.notificationService.createNotification(
        tenantId,
        NotificationType.BUDGET_ALERT_80,
        user.id,
        user.email,
        user.fullName,
        metadata,
        [NotificationChannel.IN_APP],
        manager,
      );
    }
  }

  /**
   * `FINANCE_REVIEW` (%90) alıcısı: tenant içindeki tüm `FINANCE` rollü
   * kullanıcılar (task talimatı: "Alıcı: %90 → FINANCE kullanıcıları").
   * `K-2.2.7b` Faz 1: bildirim `financeReviewMode` (`notify`/`approve`)
   * değerinden BAĞIMSIZ üretilir — mod, gelecekteki bir onay-kapısı
   * (Faz 2) davranışını konfigüre eder, bu dalganın bildirimini DEĞİL.
   */
  private async notifyFinanceReview(
    tenantId: string,
    envelope: BudgetEnvelope,
    summary: BudgetSummaryView,
    percent: number,
    policy: ResolvedBudgetPolicy,
    manager?: EntityManager,
  ): Promise<void> {
    const financeUsers = await this.userRepository.findByRole(
      tenantId,
      UserRole.FINANCE,
    );
    if (financeUsers.length === 0) {
      throw new InternalServerErrorException({
        code: 'BUDGET_TIER_RECIPIENT_EMPTY',
        message:
          `FINANCE_REVIEW (%90) bildirimi için tenant ${tenantId} içinde ` +
          `FINANCE rolünde kullanıcı yok — §2.5: alıcı kümesi boş, sessiz ` +
          `atlanmaz.`,
      });
    }

    this.logger.warn(
      `Budget envelope ${envelope.code} (${envelope.id}) reached FINANCE_REVIEW ` +
        `tier (${percent}%) — notifying ${financeUsers.length} FINANCE user(s)`,
    );

    const metadata = {
      ...this.buildMetadata(envelope, summary, percent),
      financeReviewThresholdPct: policy.financeReviewPct,
      financeReviewMode: policy.financeReviewMode,
    };

    for (const user of financeUsers) {
      await this.notificationService.createNotification(
        tenantId,
        NotificationType.BUDGET_FINANCE_REVIEW,
        user.id,
        user.email,
        user.fullName,
        metadata,
        [NotificationChannel.IN_APP],
        manager,
      );
    }
  }

  private buildMetadata(
    envelope: BudgetEnvelope,
    summary: BudgetSummaryView,
    percent: number,
  ): Record<string, unknown> {
    // Görüntüleme metadata'sı — `summary.*` alanları zaten `DecimalTransformer`
    // ile sayıya çevrilmiş geliyor (bkz. evaluateAndNotify'daki `percent` notu);
    // burada da yeniden `Number()` SARILMIYOR (ADR 0007 Karar 3b ratchet).
    return {
      budgetEnvelopeId: envelope.id,
      budgetEnvelopeName: envelope.name,
      budgetOwnerName: envelope.budgetOwnerName,
      allocatedAmount: summary.allocatedAmount,
      consumedAmount: summary.consumedAmount,
      reservedAmount: summary.reservedAmount,
      availableAmount: summary.availableAmount,
      consumptionPct: percent,
    };
  }
}

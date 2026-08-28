import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { NotificationRepository } from './notification.repository';
import { EmailService } from './services/email.service';
import {
  Notification,
  NotificationType,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
} from '../../database/entities/notification.entity';

@Injectable()
export class NotificationService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly emailService: EmailService,
  ) {}

  // MC-002: Create notification with template
  //
  // `T-322` (`Z59 §5i`): `manager` opsiyonel — çağıran (ör.
  // `BudgetTierNotificationService`) hâlâ açık bir RESERVE/COMMIT/RELEASE
  // transaction'ı içindeyse verilir, ve yazım O transaction'a bağlanır.
  // Verilmezse davranış öncekiyle BİREBİR (kendi bağlantısı). Desen
  // `NotificationRepository#create`'in aynı parametresi — bkz. o dosyanın
  // JSDoc'u.
  async createNotification(
    tenantId: string,
    type: NotificationType,
    recipientId: string,
    recipientEmail: string,
    recipientName: string,
    metadata: Record<string, any>,
    channels: NotificationChannel[] = [
      NotificationChannel.IN_APP,
      NotificationChannel.EMAIL,
    ],
    manager?: EntityManager,
  ): Promise<Notification[]> {
    const template = this.getTemplate(type, metadata);
    const priority = this.getPriority(type);

    const notifications: Notification[] = [];

    for (const channel of channels) {
      const notification = await this.notificationRepository.create(
        {
          tenantId,
          type,
          recipientId,
          recipientEmail,
          recipientName,
          channel,
          priority,
          subject: template.subject,
          body: template.body,
          metadata,
          status:
            channel === NotificationChannel.IN_APP
              ? NotificationStatus.SENT
              : NotificationStatus.PENDING,
          expiresAt:
            type === NotificationType.APPROVAL_REQUESTED
              ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
              : undefined,
        },
        manager,
      );

      notifications.push(notification);

      // MC-002: Send email if channel is EMAIL
      if (channel === NotificationChannel.EMAIL) {
        const emailSent = await this.emailService.sendEmail(notification);
        if (emailSent) {
          notification.status = NotificationStatus.SENT;
          notification.sentAt = new Date();
          await this.notificationRepository.update(notification, manager);
        } else {
          notification.status = NotificationStatus.FAILED;
          await this.notificationRepository.update(notification, manager);
        }
      }
    }

    return notifications;
  }

  // MC-002: Email templates
  private getTemplate(
    type: NotificationType,
    metadata: Record<string, any>,
  ): { subject: string; body: string } {
    switch (type) {
      case NotificationType.APPROVAL_REQUESTED:
        return {
          subject: `[Action Required] Agreement Approval: ${metadata.agreementName || 'N/A'}`,
          body: this.getApprovalRequestedTemplate(metadata),
        };

      case NotificationType.APPROVAL_GRANTED:
        return {
          subject: `Agreement Approved: ${metadata.agreementName || 'N/A'}`,
          body: this.getApprovalGrantedTemplate(metadata),
        };

      case NotificationType.APPROVAL_REJECTED:
        return {
          subject: `Agreement Rejected: ${metadata.agreementName || 'N/A'}`,
          body: this.getApprovalRejectedTemplate(metadata),
        };

      case NotificationType.BUDGET_ALERT_80:
        return {
          subject: `[Budget Alert] ${metadata.budgetEnvelopeName || 'N/A'} is 80% consumed`,
          body: this.getBudgetAlert80Template(metadata),
        };

      case NotificationType.BUDGET_ALERT_100:
        return {
          subject: `[Budget Alert] ${metadata.budgetEnvelopeName || 'N/A'} is 100% consumed`,
          body: this.getBudgetAlert100Template(metadata),
        };

      // T-318 (Z57 §3): K-2.2.7a FINANCE_REVIEW kademesi (%90).
      case NotificationType.BUDGET_FINANCE_REVIEW:
        return {
          subject: `[Finance Review] ${metadata.budgetEnvelopeName || 'N/A'} reached ${metadata.financeReviewThresholdPct ?? metadata.consumptionPct ?? 'N/A'}% utilization`,
          body: this.getBudgetFinanceReviewTemplate(metadata),
        };

      case NotificationType.AGREEMENT_EXPIRING:
        return {
          subject: `Agreement Expiring Soon: ${metadata.agreementName || 'N/A'}`,
          body: this.getAgreementExpiringTemplate(metadata),
        };

      default:
        return {
          subject: 'Notification',
          body: 'You have a new notification',
        };
    }
  }

  private getApprovalRequestedTemplate(metadata: Record<string, any>): string {
    return `
Hi ${metadata.approverName || 'Approver'},

An agreement requires your approval:

Agreement: ${metadata.agreementName || 'N/A'}
Requester: ${metadata.requesterName || 'N/A'}
Customer: ${metadata.customerName || 'N/A'}
Amount: ${metadata.amount || 0} TL
Budget: ${metadata.budgetEnvelopeName || 'N/A'}

[Approve] [Reject] [View Details]

This request will expire in 7 days if not actioned.
    `.trim();
  }

  private getApprovalGrantedTemplate(metadata: Record<string, any>): string {
    return `
Hi ${metadata.requesterName || 'User'},

Your agreement has been approved:

Agreement: ${metadata.agreementName || 'N/A'}
Approved by: ${metadata.approverName || 'N/A'}
Amount: ${metadata.amount || 0} TL

[View Details]
    `.trim();
  }

  private getApprovalRejectedTemplate(metadata: Record<string, any>): string {
    return `
Hi ${metadata.requesterName || 'User'},

Your agreement has been rejected:

Agreement: ${metadata.agreementName || 'N/A'}
Rejected by: ${metadata.approverName || 'N/A'}
Reason: ${metadata.rejectionReason || 'No reason provided'}

[View Details]
    `.trim();
  }

  // `Z59 §2(a)`: owner çözümlenemediğinde bu şablon `FINANCE`'e gider — ve
  // gövde alıcının FALLBACK-ALICISI OLDUĞUNU açıkça söylemek ZORUNDA
  // (`Z59`: "sessiz-fallback'i görünür-fallback yapan şey log değil, ÜRÜN
  // YÜZEYİNDE görünürlüktür"). `metadata.fallbackRecipient` bunu taşır —
  // `BudgetTierNotificationService#notifyWarningFallbackToFinance`'in tek
  // üreticisi.
  private getBudgetAlert80Template(metadata: Record<string, any>): string {
    const fallbackNotice = metadata.fallbackRecipient
      ? `\n⚠️ Bu bildirim size bütçe sahibine (${
          metadata.fallbackReason === 'OWNER_NOT_FOUND'
            ? 'tanımlı ama bulunamadı'
            : 'tanımsız'
        }) yönlendirilemediği için, FINANCE fallback alıcısı olarak ulaştı.\n`
      : '';

    return `
Hi ${metadata.fallbackRecipient ? 'Finance' : metadata.budgetOwnerName || 'Budget Owner'},
${fallbackNotice}
Budget envelope "${metadata.budgetEnvelopeName || 'N/A'}" has reached 80% utilization:

Allocated: ${metadata.allocatedAmount || 0} TL
Consumed: ${metadata.consumedAmount || 0} TL (${metadata.consumptionPct || 0}%)
Available: ${metadata.availableAmount || 0} TL

Recent reservations:
${metadata.recentReservations?.map((r: any) => `- ${r.name || r.agreementName || 'N/A'}`).join('\n') || '- No recent reservations'}

[View Budget Details]
    `.trim();
  }

  private getBudgetAlert100Template(metadata: Record<string, any>): string {
    return `
Hi ${metadata.budgetOwnerName || 'Budget Owner'},

Budget envelope "${metadata.budgetEnvelopeName || 'N/A'}" has reached 100% utilization:

Allocated: ${metadata.allocatedAmount || 0} TL
Consumed: ${metadata.consumedAmount || 0} TL (100%)
Available: 0 TL

⚠️ No budget available for new reservations.

[View Budget Details]
    `.trim();
  }

  // T-318 (Z57 §3): K-2.2.7a FINANCE_REVIEW (%90) — recipient is the FINANCE
  // role, not a single budget owner (see BudgetTierNotificationService).
  // `Record<string, unknown>` (not `any`, unlike this file's older sibling
  // templates — lint-ratchet: a NEW `any` finding in this file is a
  // regression, not a style match) — `any` is assignable into it at the one
  // call site (getTemplate's `metadata: Record<string, any>`), so no cast
  // is needed there.
  private getBudgetFinanceReviewTemplate(
    metadata: Record<string, unknown>,
  ): string {
    return `
Hi Finance,

Budget envelope "${metadata.budgetEnvelopeName || 'N/A'}" has reached the finance-review threshold (${metadata.financeReviewThresholdPct ?? 'N/A'}%):

Allocated: ${metadata.allocatedAmount || 0} TL
Reserved: ${metadata.reservedAmount || 0} TL
Consumed: ${metadata.consumedAmount || 0} TL
Available: ${metadata.availableAmount || 0} TL
Utilization: ${metadata.consumptionPct || 0}%

This is an informational notice (K-2.2.7b mode: ${metadata.financeReviewMode || 'N/A'}); no action is required unless your policy configures otherwise.

[View Budget Details]
    `.trim();
  }

  private getAgreementExpiringTemplate(metadata: Record<string, any>): string {
    return `
Hi ${metadata.agreementOwnerName || 'User'},

Your agreement is expiring soon:

Agreement: ${metadata.agreementName || 'N/A'}
Expires on: ${metadata.expiryDate || 'N/A'}
Days remaining: ${metadata.daysRemaining || 0}

[View Details] [Renew Agreement]
    `.trim();
  }

  private getPriority(type: NotificationType): NotificationPriority {
    switch (type) {
      case NotificationType.APPROVAL_REQUESTED:
      case NotificationType.APPROVAL_REJECTED:
      case NotificationType.BUDGET_ALERT_100:
        return NotificationPriority.HIGH;
      case NotificationType.APPROVAL_GRANTED:
      case NotificationType.BUDGET_ALERT_80:
        return NotificationPriority.MEDIUM;
      case NotificationType.BUDGET_FINANCE_REVIEW:
        return NotificationPriority.HIGH;
      case NotificationType.AGREEMENT_EXPIRING:
        return NotificationPriority.LOW;
      default:
        return NotificationPriority.MEDIUM;
    }
  }

  // T-275: `recipientId` ZORUNLU — WHERE'e girmezse tenant içindeki HERHANGİ bir
  // kullanıcının bildirimi okundu işaretlenebilir ve yanıt gövdesi onun içeriğini
  // (subject/body/recipientEmail) sızdırır. `404` bilerek: kayıt "var ama senin
  // değil" ile "hiç yok" AYNI yanıtı verir — varlığın kendisi sızdırılmaz.
  async markAsRead(
    tenantId: string,
    recipientId: string,
    notificationId: string,
  ): Promise<Notification> {
    const notification = await this.notificationRepository.findById(
      tenantId,
      recipientId,
      notificationId,
    );
    if (!notification) {
      throw new NotFoundException(
        `Notification with ID ${notificationId} not found`,
      );
    }

    notification.status = NotificationStatus.READ;
    notification.readAt = new Date();

    return this.notificationRepository.update(notification);
  }

  async getUnreadNotifications(
    tenantId: string,
    userId: string,
  ): Promise<Notification[]> {
    return this.notificationRepository.findUnreadByRecipient(tenantId, userId);
  }

  async getAllNotifications(
    tenantId: string,
    userId: string,
    limit = 30,
  ): Promise<Notification[]> {
    return this.notificationRepository.findByRecipient(tenantId, userId, limit);
  }
}

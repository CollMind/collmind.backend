import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  AdminAuditLog,
  AuditLogResult,
} from '../../database/entities/admin-audit-log.entity';

/**
 * T-014: opsiyonel transaction bağlamı.
 *
 * `manager` verildiğinde audit satırı çağıranın `queryRunner.manager`'ı
 * üzerinden yazılır — yani çağıranın açık transaction'ının bir parçası olur
 * (commit/rollback ile atomik). `manager` verilmezse davranış eskisiyle
 * birebir aynıdır: `auditLogRepository` (default connection) üzerinden anında
 * commit olur.
 *
 * Bilerek 12. pozisyonel argüman EKLENMEDİ (13 mevcut çağrı yerinde sessiz
 * kayma riski) — bunun yerine tek bir options-object parametresi, sadece bu
 * yeni kullanım için overload ile tanımlandı. Var olan 11-argümanlı çağrılar
 * hiç değişmeden derlenir ve çalışır.
 */
export interface LogAdminActionOptions {
  /**
   * Sağlanırsa audit satırı bu manager (queryRunner.manager) üzerinden
   * yazılır — çağıranın transaction'ının içinde, atomik olarak.
   */
  manager: EntityManager;
}

/**
 * EA-001: Admin Audit Service
 *
 * Logs all admin actions for accountability:
 * - Timestamp
 * - Admin user ID + email
 * - Action type (CREATE, UPDATE, DELETE, APPROVE, etc.)
 * - Entity affected
 * - Before/after values (for updates)
 * - IP address
 * - Result (SUCCESS, FAILURE)
 */
@Injectable()
export class AdminAuditService {
  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
  ) {}

  /** Geriye uyumlu imza — mevcut 13 çağrı yeri bu overload'a düşer. */
  async logAdminAction(
    tenantId: string,
    adminId: string,
    adminEmail: string,
    actionType: string,
    entityType: string,
    entityId: string | undefined,
    ipAddress: string | undefined,
    result: 'SUCCESS' | 'FAILURE',
    beforeValues?: Record<string, unknown>,
    afterValues?: Record<string, unknown>,
    justification?: string,
  ): Promise<AdminAuditLog>;
  /**
   * T-014: transaction-aware imza. `options.manager` sağlanan queryRunner'ın
   * manager'ıdır — audit satırı bu manager üzerinden yazılır, dolayısıyla
   * çağıranın commit/rollback sınırını paylaşır.
   *
   * ÖNEMLİ (high-risk alarm sırası): bu modda, satır henüz commit OLMADAN
   * alarm tetiklenmesini önlemek için `triggerAlert` burada ÇAĞRILMAZ.
   * Çağıran, kendi `queryRunner.commitTransaction()` başarıyla bittikten
   * SONRA dönen log ile `flushPendingAlert(log)` çağırmalıdır. Aksi halde
   * rollback olan bir işlem için "high-risk aksiyon oldu" alarmı gitmiş
   * olurdu — audit-gerçeklik tutarsızlığını çözerken daha kötüsünü
   * yaratmamak için bilinçli tasarım kararı.
   */
  async logAdminAction(
    tenantId: string,
    adminId: string,
    adminEmail: string,
    actionType: string,
    entityType: string,
    entityId: string | undefined,
    ipAddress: string | undefined,
    result: 'SUCCESS' | 'FAILURE',
    beforeValues: Record<string, unknown> | undefined,
    afterValues: Record<string, unknown> | undefined,
    justification: string | undefined,
    options: LogAdminActionOptions,
  ): Promise<AdminAuditLog>;
  /**
   * T-314/B (K1a review S7, Z52 §2) — PLATFORM-SEVİYESİ EYLEM imzası.
   * `Z52 §2` `tenant_id`'yi nullable yaptı ("NULL burada bilgi-eksikliği
   * DEĞİL, katman bilgisidir") ama ÜÇ overload'ın da `tenantId: string`
   * (nullable OLMAYAN) parametre taşıması bu yeteneği MEKANİK OLARAK
   * erişilemez bırakıyordu — `null` hiçbir çağrı yerinden GEÇİRİLEMİYORDU.
   * Bu overload `tenantId: null`'ı AÇIKÇA kabul eder (üçüncü, ayrı bir imza
   * — mevcut iki overload'a SESSİZCE `| null` eklemek TS'te `tenantId`'nin
   * her çağrı yerinde `string | null` görünmesine yol açar ve derleyici o
   * belirsizliği HER ÇAĞRI YERİNDE zorlardı; ayrı imza yerine bunun
   * yapılmaması bilinçli — mevcut 13+ çağrı yeri DEĞİŞMEDEN derlenir).
   */
  async logAdminAction(
    tenantId: null,
    adminId: string,
    adminEmail: string,
    actionType: string,
    entityType: string,
    entityId: string | undefined,
    ipAddress: string | undefined,
    result: 'SUCCESS' | 'FAILURE',
    beforeValues?: Record<string, unknown>,
    afterValues?: Record<string, unknown>,
    justification?: string,
    options?: LogAdminActionOptions,
  ): Promise<AdminAuditLog>;
  async logAdminAction(
    tenantId: string | null,
    adminId: string,
    adminEmail: string,
    actionType: string,
    entityType: string,
    entityId: string | undefined,
    ipAddress: string | undefined,
    result: 'SUCCESS' | 'FAILURE',
    beforeValues?: Record<string, unknown>,
    afterValues?: Record<string, unknown>,
    justification?: string,
    options?: LogAdminActionOptions,
  ): Promise<AdminAuditLog> {
    const isHighRisk = this.isHighRiskAction(actionType, entityType);

    const repo = options?.manager
      ? options.manager.getRepository(AdminAuditLog)
      : this.auditLogRepository;

    const auditLog = repo.create({
      tenantId,
      adminId,
      adminEmail,
      actionType,
      entityType,
      entityId,
      ipAddress,
      result: result as AuditLogResult,
      beforeValues,
      afterValues,
      justification,
      isHighRisk,
      alertSent: false,
    });

    const savedLog = await repo.save(auditLog);

    // EA-001: High-risk admin actions trigger alerts.
    // Transaction modunda (options.manager verildi) burada ALARM
    // TETİKLENMEZ — satır henüz çağıranın transaction'ı içinde, commit
    // olmamış olabilir. Çağıran commit'ten sonra flushPendingAlert(savedLog)
    // çağırmalıdır (bkz. yukarıdaki overload dokümantasyonu).
    if (isHighRisk && !options?.manager) {
      await this.triggerAlert(
        actionType,
        entityType,
        adminEmail,
        entityId,
        savedLog.id,
      );
    }

    return savedLog;
  }

  /**
   * T-014: transaction-aware `logAdminAction` çağrısından dönen log için,
   * çağıranın `queryRunner.commitTransaction()` BAŞARIYLA bittikten sonra
   * çağrılmalıdır. High-risk değilse veya alarm zaten gönderilmişse no-op'tur.
   */
  async flushPendingAlert(log: AdminAuditLog): Promise<void> {
    if (!log.isHighRisk || log.alertSent) {
      return;
    }
    await this.triggerAlert(
      log.actionType,
      log.entityType,
      log.adminEmail,
      log.entityId,
      log.id,
    );

    // `triggerAlert` `alertSent` işaretini DB'de kendi çektiği ayrı bir obje
    // üzerinde günceller; çağıranın elindeki referans bayat kalırdı. Aynı log
    // ikinci kez flush edilirse (retry vb.) alarm tekrar giderdi — idempotency
    // yalnız DB satırı için değil, bu referans için de geçerli olmalı.
    log.alertSent = true;
  }

  private isHighRiskAction(actionType: string, entityType: string): boolean {
    // EA-001: High-risk actions
    const highRiskActions = [
      { action: 'UPDATE', entity: 'user', field: 'role' }, // Role permission changes
      { action: 'DELETE', entity: 'user' }, // Bulk user deactivations
      { action: 'DELETE', entity: 'budget_envelope' }, // Budget envelope deletions
      { action: 'REVERSE', entity: 'AGREEMENT_TRANSACTION' }, // Financial reversal (BRD: high-risk)
      { action: 'CLOSE', entity: 'AGREEMENT' }, // Settlement close — irreversible state (T-013 pending)
      // T-032: agreement lifecycle audit gap fix. APPROVE commits budget
      // (RESERVE -> approvalService.approve -> status=APPROVED) — same
      // financial-exposure class as CLOSE. CANCEL is a terminal,
      // irreversible state transition that releases the outstanding
      // reservation — same class as CLOSE/REVERSE. REJECT is deliberately
      // NOT flagged high-risk: it is a normal negative workflow decision at
      // the PENDING stage where, per agreement.service.ts#reject's own
      // comment, there is typically no budget reservation yet to unwind
      // (agreement approve() is what reserves budget, not submit()) — lower
      // financial stakes than APPROVE/CANCEL/CLOSE/REVERSE.
      { action: 'APPROVE', entity: 'AGREEMENT' },
      { action: 'CANCEL', entity: 'AGREEMENT' },
      // m2 (T-242a code-review, ürün sahibi kararı 2026-08-20): bir
      // kullanıcının erişimini TÜMÜYLE kaldırmak (`SCOPE_REVOKE_ALL`,
      // `docs/process/DENETIM_SOZLUGU.md` Madde 1) `{DELETE, user}` ile
      // AYNI ağırlıkta — o kullanıcıyı silmek de erişimini kaldırmak da
      // aynı soruyu doğurur: "neden hiçbir şey göremiyor". SCOPE_REVOKE_ALL'ı
      // T-244'te AYRI bir olay türü yapmamızın gerekçesi tam buydu; alarm
      // üretmezse o soru hiç sorulmadan kalır. `SCOPE_UPDATE` BİLEREK
      // eklenmedi — olağan bir kapsam değişikliği, DELETE/REVOKE_ALL
      // sınıfının yıkıcılığında değil.
      { action: 'SCOPE_REVOKE_ALL', entity: 'user' },
    ];

    return highRiskActions.some(
      (risk) => risk.action === actionType && risk.entity === entityType,
    );
  }

  private async triggerAlert(
    actionType: string,
    entityType: string,
    adminEmail: string,
    entityId: string | undefined,
    logId: string,
  ): Promise<void> {
    // TODO: Send alerts to Security team, Product Owner, or Finance Director
    // This could integrate with notification service or external alerting system
    console.warn('HIGH-RISK ADMIN ACTION:', {
      logId,
      actionType,
      entityType,
      adminEmail,
      entityId,
      timestamp: new Date().toISOString(),
    });

    // Mark alert as sent
    const log = await this.auditLogRepository.findOne({ where: { id: logId } });
    if (log) {
      log.alertSent = true;
      await this.auditLogRepository.save(log);
    }
  }

  async getAuditLogs(
    tenantId: string,
    adminId?: string,
    limit = 100,
  ): Promise<AdminAuditLog[]> {
    const query = this.auditLogRepository
      .createQueryBuilder('log')
      .where('log.tenantId = :tenantId', { tenantId })
      .orderBy('log.createdAt', 'DESC')
      .limit(limit);

    if (adminId) {
      query.andWhere('log.adminId = :adminId', { adminId });
    }

    return query.getMany();
  }

  /**
   * T-314/B (K1a review S7) — platform-seviyesi (`tenant_id IS NULL`) satırlar
   * için OKUMA TARAFI. `getAuditLogs`'un `.where('log.tenantId = :tenantId')`
   * ifadesi SQL NULL semantiği gereği `tenant_id = NULL`'ı ASLA eşleştirmez —
   * bu satırlar o metottan HİÇBİR PARAMETREYLE görünmez (kırılmıyor,
   * GÖRÜNMÜYOR). Ayrı bir metot: sessizce `tenantId` parametresini nullable
   * yapıp aynı `=` operatörüyle "çalışıyor gibi" bırakmak §2.5'in yasakladığı
   * sessiz-boş-dönüş sınıfına girerdi.
   *
   * ⚠️ HTTP yüzeyi BİLEREK YOK — bu yeteneği tenant-scoped bir admin
   * endpoint'ine (`@TenantId()` bağlamlı `AdminAuditController`) bağlamak
   * "platform-seviyesi eylemi kim görebilir" sorusuna (bugünkü RBAC'te
   * tanımsız bir platform/süper-admin rolü ister) sessizce cevap üretirdi.
   * `T-314` AC'sinin izin verdiği açık devir: K1b/RLS-aktivasyon dalgasının
   * rol tasarımı bu HTTP yolunu açar.
   */
  async getPlatformAuditLogs(
    adminId?: string,
    limit = 100,
  ): Promise<AdminAuditLog[]> {
    const query = this.auditLogRepository
      .createQueryBuilder('log')
      .where('log.tenantId IS NULL')
      .orderBy('log.createdAt', 'DESC')
      .limit(limit);

    if (adminId) {
      query.andWhere('log.adminId = :adminId', { adminId });
    }

    return query.getMany();
  }

  async getHighRiskActions(
    tenantId: string,
    limit = 50,
  ): Promise<AdminAuditLog[]> {
    return this.auditLogRepository.find({
      where: { tenantId, isHighRisk: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}

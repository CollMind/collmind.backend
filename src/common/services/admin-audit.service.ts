import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdminAuditLog,
  AuditLogResult,
} from '../../database/entities/admin-audit-log.entity';

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

  async logAdminAction(
    tenantId: string,
    adminId: string,
    adminEmail: string,
    actionType: string,
    entityType: string,
    entityId: string | undefined,
    ipAddress: string | undefined,
    result: 'SUCCESS' | 'FAILURE',
    beforeValues?: Record<string, any>,
    afterValues?: Record<string, any>,
    justification?: string,
  ): Promise<AdminAuditLog> {
    const isHighRisk = this.isHighRiskAction(actionType, entityType);

    const auditLog = this.auditLogRepository.create({
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

    const savedLog = await this.auditLogRepository.save(auditLog);

    // EA-001: High-risk admin actions trigger alerts
    if (isHighRisk) {
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

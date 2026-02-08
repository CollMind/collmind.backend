import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApprovalRepository } from './approval.repository';
import { CreateApprovalRequestDto, ApproveRequestDto, RejectRequestDto } from './dto';
import {
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRequestType,
} from '../../../database/entities/approval-request.entity';

@Injectable()
export class ApprovalService {
  constructor(private readonly approvalRepo: ApprovalRepository) {}

  /**
   * Create a new approval request
   * Called when Agreement is submitted for approval
   */
  async createRequest(
    dto: CreateApprovalRequestDto,
    tenantId: string,
    requesterId: string,
  ): Promise<ApprovalRequest> {
    // Check if approval request already exists for this entity
    const existing = await this.approvalRepo.findByEntityId(
      dto.entityType,
      dto.entityId,
      tenantId,
    );

    if (existing && existing.status === ApprovalRequestStatus.PENDING) {
      throw new BadRequestException('An approval request already exists for this entity');
    }

    // Default approval levels (single level for Sprint 1)
    const defaultLevel = {
      order: 1,
      role: 'APPROVER',
      status: 'PENDING' as const,
    };
    
    const approvalLevels: Array<{
      order: number;
      role: string;
      userId?: string;
      status: 'PENDING' | 'APPROVED' | 'REJECTED';
      approvedAt?: Date;
      approvedById?: string;
      rejectionReason?: string;
    }> = dto.approvalLevels
      ? dto.approvalLevels.map((level) => ({
          ...level,
          status: (level.status || 'PENDING') as 'PENDING' | 'APPROVED' | 'REJECTED',
        }))
      : [defaultLevel];

    const request = await this.approvalRepo.create({
      tenantId,
      requestType: dto.requestType,
      entityType: dto.entityType,
      entityId: dto.entityId,
      requestedById: requesterId,
      requestedAt: new Date(),
      approvalLevels,
      currentLevel: 1,
      status: ApprovalRequestStatus.PENDING,
      createdBy: requesterId,
    });

    return request;
  }

  /**
   * Approve an approval request
   * Updates approval levels and overall status
   */
  async approve(
    id: string,
    tenantId: string,
    approverId: string,
    dto?: ApproveRequestDto,
  ): Promise<ApprovalRequest> {
    const request = await this.findById(id, tenantId);

    if (request.status !== ApprovalRequestStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be approved');
    }

    // Self-approval prevention (BRD EA-001)
    if (request.requestedById === approverId) {
      throw new ForbiddenException('You cannot approve your own request');
    }

    // Update current approval level
    const levels = [...(request.approvalLevels || [])];
    const currentLevelIndex = request.currentLevel - 1;

    if (levels[currentLevelIndex]) {
      const updatedLevel: any = {
        ...levels[currentLevelIndex],
        status: 'APPROVED' as const,
        approvedAt: new Date(),
        approvedById: approverId,
      };
      // Store comments if provided (JSONB allows additional fields)
      if (dto?.comments) {
        updatedLevel.comments = dto.comments;
      }
      levels[currentLevelIndex] = updatedLevel;
    }

    // Check if all levels are approved
    const allApproved = levels.every((level) => level.status === 'APPROVED');
    const nextLevel = request.currentLevel + 1;
    const hasMoreLevels = nextLevel <= levels.length && !allApproved;

    // Determine new status
    const newStatus = allApproved
      ? ApprovalRequestStatus.APPROVED
      : ApprovalRequestStatus.PENDING;

    return this.approvalRepo.updateStatus(id, tenantId, newStatus, {
      approvalLevels: levels,
      currentLevel: hasMoreLevels ? nextLevel : request.currentLevel,
      approvedAt: allApproved ? new Date() : undefined,
      approvedById: allApproved ? approverId : undefined,
      updatedBy: approverId,
    });
  }

  /**
   * Reject an approval request
   * Any rejection stops the workflow
   */
  async reject(
    id: string,
    tenantId: string,
    rejectorId: string,
    dto: RejectRequestDto,
  ): Promise<ApprovalRequest> {
    const request = await this.findById(id, tenantId);

    if (request.status !== ApprovalRequestStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be rejected');
    }

    // Self-rejection prevention
    if (request.requestedById === rejectorId) {
      throw new ForbiddenException('You cannot reject your own request');
    }

    // Update current approval level
    const levels = [...(request.approvalLevels || [])];
    const currentLevelIndex = request.currentLevel - 1;

    if (levels[currentLevelIndex]) {
      levels[currentLevelIndex] = {
        ...levels[currentLevelIndex],
        status: 'REJECTED' as const,
        approvedAt: new Date(),
        approvedById: rejectorId,
        rejectionReason: dto.reason,
      };
    }

    return this.approvalRepo.updateStatus(id, tenantId, ApprovalRequestStatus.REJECTED, {
      approvalLevels: levels,
      rejectedAt: new Date(),
      rejectedById: rejectorId,
      rejectionReason: dto.reason,
      updatedBy: rejectorId,
    });
  }

  /**
   * Cancel an approval request
   * Only requester can cancel their own pending request
   */
  async cancel(id: string, tenantId: string, userId: string): Promise<ApprovalRequest> {
    const request = await this.findById(id, tenantId);

    if (request.status !== ApprovalRequestStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be cancelled');
    }

    if (request.requestedById !== userId) {
      throw new ForbiddenException('Only the requester can cancel the request');
    }

    return this.approvalRepo.updateStatus(id, tenantId, ApprovalRequestStatus.CANCELLED, {
      cancelledAt: new Date(),
      cancelledById: userId,
      updatedBy: userId,
    });
  }

  async findById(id: string, tenantId: string): Promise<ApprovalRequest> {
    const request = await this.approvalRepo.findById(id, tenantId);
    if (!request) {
      throw new NotFoundException('Approval request not found');
    }
    return request;
  }

  async findByEntityId(
    entityType: string,
    entityId: string,
    tenantId: string,
  ): Promise<ApprovalRequest | null> {
    return this.approvalRepo.findByEntityId(entityType, entityId, tenantId);
  }

  async findPendingForUser(userId: string, tenantId: string): Promise<ApprovalRequest[]> {
    return this.approvalRepo.findPendingForUser(userId, tenantId);
  }

  async findMyRequests(userId: string, tenantId: string): Promise<ApprovalRequest[]> {
    return this.approvalRepo.findByRequesterId(userId, tenantId);
  }

  async findAll(tenantId: string, filters?: any): Promise<ApprovalRequest[]> {
    return this.approvalRepo.findAll(tenantId, filters);
  }
}


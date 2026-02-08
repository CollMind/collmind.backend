import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import {
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRequestType,
} from '../../../database/entities/approval-request.entity';

@Injectable()
export class ApprovalRepository {
  constructor(
    @InjectRepository(ApprovalRequest)
    private readonly repo: Repository<ApprovalRequest>,
  ) {}

  async create(data: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
    const request = this.repo.create(data);
    return this.repo.save(request);
  }

  async findById(id: string, tenantId: string): Promise<ApprovalRequest | null> {
    return this.repo.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
  }

  async findByEntityId(
    entityType: string,
    entityId: string,
    tenantId: string,
  ): Promise<ApprovalRequest | null> {
    return this.repo.findOne({
      where: { entityType, entityId, tenantId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async findPendingByApproverRole(
    approverRole: string,
    tenantId: string,
  ): Promise<ApprovalRequest[]> {
    // Find requests where current level requires this role
    return this.repo
      .createQueryBuilder('ar')
      .where('ar.tenantId = :tenantId', { tenantId })
      .andWhere('ar.status = :status', { status: ApprovalRequestStatus.PENDING })
      .andWhere('ar.deletedAt IS NULL')
      .orderBy('ar.createdAt', 'ASC')
      .getMany();
  }

  async findPendingForUser(userId: string, tenantId: string): Promise<ApprovalRequest[]> {
    return this.repo.find({
      where: {
        tenantId,
        status: ApprovalRequestStatus.PENDING,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async findByRequesterId(requesterId: string, tenantId: string): Promise<ApprovalRequest[]> {
    return this.repo.find({
      where: {
        requestedById: requesterId,
        tenantId,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(
    tenantId: string,
    filters?: {
      status?: ApprovalRequestStatus;
      requestType?: ApprovalRequestType;
      entityType?: string;
      requestedById?: string;
    },
  ): Promise<ApprovalRequest[]> {
    const query = this.repo
      .createQueryBuilder('ar')
      .where('ar.tenantId = :tenantId', { tenantId })
      .andWhere('ar.deletedAt IS NULL');

    if (filters?.status) {
      query.andWhere('ar.status = :status', { status: filters.status });
    }
    if (filters?.requestType) {
      query.andWhere('ar.requestType = :requestType', { requestType: filters.requestType });
    }
    if (filters?.entityType) {
      query.andWhere('ar.entityType = :entityType', { entityType: filters.entityType });
    }
    if (filters?.requestedById) {
      query.andWhere('ar.requestedById = :requestedById', {
        requestedById: filters.requestedById,
      });
    }

    return query.orderBy('ar.createdAt', 'DESC').getMany();
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<ApprovalRequest>,
  ): Promise<ApprovalRequest> {
    await this.repo.update({ id, tenantId }, data);
    const updated = await this.findById(id, tenantId);
    if (!updated) {
      throw new Error('Approval request not found after update');
    }
    return updated;
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: ApprovalRequestStatus,
    additionalData?: Partial<ApprovalRequest>,
  ): Promise<ApprovalRequest> {
    const updateData = { status, ...additionalData };
    return this.update(id, tenantId, updateData);
  }
}


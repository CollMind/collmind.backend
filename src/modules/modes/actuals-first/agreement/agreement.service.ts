import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { AgreementRepository } from './agreement.repository';
import { CreateAgreementDto, UpdateAgreementDto } from './dto';
import {
  Agreement,
  AgreementStatus,
  AgreementType,
} from '../../../../database/entities/agreement.entity';
import {
  BudgetTransactionType,
  BudgetTransactionStatus,
  BudgetTransactionSourceType,
} from '../../../../database/entities/budget-transaction.entity';
import { BudgetService } from '../../../shared/budget/budget.service';
import { ApprovalService } from '../../../shared/approval/approval.service';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';

@Injectable()
export class AgreementService {
  constructor(
    private readonly agreementRepo: AgreementRepository,
    private readonly budgetService: BudgetService,
    private readonly approvalService: ApprovalService,
  ) {}

  async create(
    dto: CreateAgreementDto,
    tenantId: string,
    userId: string,
  ): Promise<Agreement> {
    // Validate STA/LTA duration rules
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    const durationDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (dto.agreementType === AgreementType.STA && durationDays > 30) {
      throw new BadRequestException('STA agreements must be 30 days or less');
    }
    if (dto.agreementType === AgreementType.LTA && durationDays <= 30) {
      throw new BadRequestException('LTA agreements must be more than 30 days');
    }

    // Generate agreement code
    const agreementCode = await this.agreementRepo.generateAgreementCode(
      tenantId,
      dto.agreementType,
    );

    // Check if code already exists (shouldn't happen, but safety check)
    const existing = await this.agreementRepo.findByCode(agreementCode, tenantId);
    if (existing) {
      throw new ConflictException(`Agreement code ${agreementCode} already exists`);
    }

    // Calculate period month from start date
    const periodMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;

    // Convert string dates to Date objects
    const agreement = await this.agreementRepo.create({
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      agreementCode,
      periodMonth,
      tenantId,
      status: AgreementStatus.DRAFT,
      createdBy: userId,
      consumedAmount: 0,
      currency: dto.currency || 'TRY',
      skuScope: dto.skuScope || 'FU',
    });

    return agreement;
  }

  async findById(id: string, tenantId: string): Promise<Agreement> {
    const agreement = await this.agreementRepo.findById(id, tenantId);
    if (!agreement) {
      throw new NotFoundException(`Agreement with ID ${id} not found`);
    }
    return agreement;
  }

  async findAll(tenantId: string, filters?: {
    status?: AgreementStatus;
    cplId?: string;
    channel?: string;
  }): Promise<Agreement[]> {
    return this.agreementRepo.findAll(tenantId, filters);
  }

  async update(
    id: string,
    dto: UpdateAgreementDto,
    tenantId: string,
    userId: string,
  ): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId);

    // Only DRAFT agreements can be edited
    if (agreement.status !== AgreementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT agreements can be edited');
    }

    // If dates are being updated, validate STA/LTA rules
    if (dto.startDate || dto.endDate) {
      const startDate = new Date(dto.startDate || agreement.startDate);
      const endDate = new Date(dto.endDate || agreement.endDate);
      const durationDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (agreement.agreementType === AgreementType.STA && durationDays > 30) {
        throw new BadRequestException('STA agreements must be 30 days or less');
      }
      if (agreement.agreementType === AgreementType.LTA && durationDays <= 30) {
        throw new BadRequestException('LTA agreements must be more than 30 days');
      }
    }

    // Update period month if start date changed
    // Exclude date fields from spread to convert them separately
    const { startDate: dtoStartDate, endDate: dtoEndDate, ...dtoWithoutDates } = dto;
    const updateData: Partial<Agreement> = { ...dtoWithoutDates, updatedBy: userId };
    
    if (dtoStartDate) {
      const startDate = new Date(dtoStartDate);
      updateData.periodMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
      updateData.startDate = startDate;
    }
    if (dtoEndDate) {
      updateData.endDate = new Date(dtoEndDate);
    }

    return this.agreementRepo.update(id, tenantId, updateData);
  }

  async submit(id: string, tenantId: string, userId: string): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId);

    if (agreement.status !== AgreementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT agreements can be submitted');
    }

    // Create approval request
    const approvalRequest = await this.approvalService.createRequest(
      {
        requestType: ApprovalRequestType.AGREEMENT,
        entityType: 'AGREEMENT',
        entityId: agreement.id,
      },
      tenantId,
      userId,
    );

    // Update agreement with approval request ID and status
    return this.agreementRepo.updateStatus(id, tenantId, AgreementStatus.PENDING, {
      approvalRequestId: approvalRequest.id,
      updatedBy: userId,
    });
  }

  async approve(id: string, tenantId: string, userId: string, comments?: string): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId);

    if (agreement.status !== AgreementStatus.PENDING) {
      throw new BadRequestException('Only PENDING agreements can be approved');
    }

    // Validate that approval request exists for PENDING agreements
    // PENDING agreements should always have approvalRequestId from submit() flow
    if (!agreement.approvalRequestId) {
      throw new BadRequestException(
        'Approval request not found. PENDING agreements must have an associated approval request.',
      );
    }

    // Create budget reservation FIRST (before updating approval request)
    // This ensures that if budget reservation fails, approval request remains pending
    // Load channel relation if not already loaded
    let agreementWithChannel: Agreement = agreement;
    if (!agreement.channel) {
      const loadedAgreement = await this.agreementRepo.findById(agreement.id, tenantId);
      if (!loadedAgreement || !loadedAgreement.channel) {
        throw new BadRequestException('Agreement channel not found');
      }
      agreementWithChannel = loadedAgreement;
    }
    
    try {
      await this.budgetService.reserveForAgreement(
        agreementWithChannel.id,
        agreementWithChannel.capTotalAmount,
        agreementWithChannel.channel.code,
        agreementWithChannel.periodMonth,
        agreementWithChannel.currency,
        tenantId,
        userId,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(`Budget reservation failed: ${errorMessage}`);
    }

    // Update approval request AFTER successful budget reservation
    // This ensures approval request is only marked approved if budget reservation succeeded
    if (!agreement.approvalRequestId) {
      throw new BadRequestException('Agreement does not have an approval request');
    }
    await this.approvalService.approve(
      agreement.approvalRequestId,
      tenantId,
      userId,
      { comments },
    );

    // Update agreement status
    return this.agreementRepo.updateStatus(id, tenantId, AgreementStatus.APPROVED, {
      approvedAt: new Date(),
      approvedById: userId,
      updatedBy: userId,
    });
  }

  async reject(
    id: string,
    tenantId: string,
    userId: string,
    reason: string,
  ): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId);

    if (agreement.status !== AgreementStatus.PENDING) {
      throw new BadRequestException('Only PENDING agreements can be rejected');
    }

    // Validate that approval request exists for PENDING agreements
    // PENDING agreements should always have approvalRequestId from submit() flow
    if (!agreement.approvalRequestId) {
      throw new BadRequestException(
        'Approval request not found. PENDING agreements must have an associated approval request.',
      );
    }

    // Update approval request
    await this.approvalService.reject(
      agreement.approvalRequestId,
      tenantId,
      userId,
      { reason },
    );

    return this.agreementRepo.updateStatus(id, tenantId, AgreementStatus.REJECTED, {
      rejectedAt: new Date(),
      rejectedById: userId,
      rejectionReason: reason,
      updatedBy: userId,
    });
  }

  async cancel(id: string, tenantId: string, userId: string, reason?: string): Promise<Agreement> {
    const agreement = await this.findById(id, tenantId);

    if (![AgreementStatus.APPROVED, AgreementStatus.ACTIVE].includes(agreement.status)) {
      throw new BadRequestException('Only APPROVED or ACTIVE agreements can be cancelled');
    }

    // Find the RESERVE transaction for this agreement to get the correct envelope
    // This is more reliable than looking up by dimensions, as envelope status might have changed
    const reserveTransactions = await this.budgetService.getTransactionsBySource(
      tenantId,
      BudgetTransactionSourceType.AGREEMENT,
      agreement.id,
    );

    const reserveTx = reserveTransactions.find(
      (tx) =>
        tx.txType === BudgetTransactionType.RESERVE &&
        tx.txStatus === BudgetTransactionStatus.POSTED,
    );

    if (reserveTx) {
      // Release the reserved budget using the envelope from the original RESERVE transaction
      try {
        await this.budgetService.releaseForAgreement(
          agreement.id,
          reserveTx.envelopeId,
          agreement.capTotalAmount,
          agreement.currency,
          tenantId,
          userId,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new BadRequestException(`Budget release failed: ${errorMessage}`);
      }
    } else {
      // If no RESERVE transaction found, this is a data integrity issue
      // Log warning but don't block cancellation
      console.warn(
        `No RESERVE transaction found for agreement ${agreement.id} during cancellation`,
      );
    }

    // Update agreement status
    return this.agreementRepo.updateStatus(id, tenantId, AgreementStatus.CANCELLED, {
      updatedBy: userId,
    });
  }

  async delete(id: string, tenantId: string, userId: string): Promise<void> {
    const agreement = await this.findById(id, tenantId);

    // Only DRAFT agreements can be deleted
    if (agreement.status !== AgreementStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT agreements can be deleted');
    }

    await this.agreementRepo.softDelete(id, tenantId);
  }

  /**
   * Get available tactics for channel and category
   * TODO: This should be replaced with actual tactic master data
   */
  async getAvailableTactics(channel: string, categoryId?: string): Promise<Array<{
    id: string;
    name: string;
    code: string;
    mechanicType: 'PERCENT' | 'AMOUNT' | 'AMOUNT_PER_UNIT';
    spendType: 'ON_INVOICE' | 'OFF_INVOICE' | 'BOTH';
    applicableChannels?: string[];
    applicableCategories?: string[];
  }>> {
    // Mock data - should be replaced with actual tactic master data
    const allTactics = [
      {
        id: 'tactic-1',
        name: 'CPP On-Invoice',
        code: 'CPP_ON_INVOICE',
        mechanicType: 'PERCENT' as const,
        spendType: 'ON_INVOICE' as const,
        applicableChannels: ['NKA', 'TRADITIONAL', 'MT'],
      },
      {
        id: 'tactic-2',
        name: 'Promosyon İndirimi',
        code: 'PROMO_DISCOUNT',
        mechanicType: 'PERCENT' as const,
        spendType: 'ON_INVOICE' as const,
        applicableChannels: ['NKA', 'TRADITIONAL', 'MT', 'WHOLESALE'],
      },
      {
        id: 'tactic-3',
        name: 'CPP Off-Invoice',
        code: 'CPP_OFF_INVOICE',
        mechanicType: 'PERCENT' as const,
        spendType: 'OFF_INVOICE' as const,
        applicableChannels: ['NKA', 'TRADITIONAL'],
      },
      {
        id: 'tactic-4',
        name: 'Ciro Primi',
        code: 'REVENUE_PREMIUM',
        mechanicType: 'PERCENT' as const,
        spendType: 'OFF_INVOICE' as const,
        applicableChannels: ['NKA', 'TRADITIONAL', 'MT'],
      },
    ];

    // Filter by channel
    let filtered = allTactics.filter((t) =>
      !t.applicableChannels || t.applicableChannels.includes(channel)
    );

    // TODO: Filter by category when categoryId is provided

    return filtered;
  }
}



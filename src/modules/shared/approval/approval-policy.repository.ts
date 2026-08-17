import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  ApprovalPolicy,
  ApprovalPolicyTemplate,
} from '../../../database/entities/approval-policy.entity';

@Injectable()
export class ApprovalPolicyRepository {
  constructor(
    @InjectRepository(ApprovalPolicy)
    private readonly repo: Repository<ApprovalPolicy>,
  ) {}

  async findById(id: string, tenantId: string): Promise<ApprovalPolicy | null> {
    return this.repo.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
  }

  /**
   * T-214: TEK yazma yolu — `template` ve `amountThreshold` her zaman
   * BİRLİKTE gelir. `amountThreshold: null` açıkça kabul edilir (THRESHOLD ->
   * STANDARD/TWO_TIER geçişinde `CHK_approval_policies_threshold_template`
   * gereği kolonun NULL'lanması gerekir) — `undefined` bırakıp TypeORM'un
   * "dokunma" davranışına güvenilmiyor.
   */
  async updatePolicySelection(
    id: string,
    tenantId: string,
    data: {
      template: ApprovalPolicyTemplate;
      amountThreshold: number | null;
      updatedBy: string;
    },
  ): Promise<ApprovalPolicy> {
    await this.repo.update(
      { id, tenantId },
      data as unknown as Partial<ApprovalPolicy>,
    );
    const updated = await this.findById(id, tenantId);
    if (!updated) {
      throw new Error('Approval policy not found after update');
    }
    return updated;
  }
}

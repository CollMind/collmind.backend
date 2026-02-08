import { IsString, IsUUID, IsEnum, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalRequestType } from '../../../../database/entities/approval-request.entity';

export class CreateApprovalRequestDto {
  @ApiProperty({ enum: ApprovalRequestType })
  @IsEnum(ApprovalRequestType)
  requestType!: ApprovalRequestType;

  @ApiProperty({ description: 'Entity type: AGREEMENT, BUDGET_TRANSFER, etc.' })
  @IsString()
  entityType!: string;

  @ApiProperty()
  @IsUUID()
  entityId!: string;

  @ApiPropertyOptional({ description: 'Approval levels configuration' })
  @IsOptional()
  @IsArray()
  approvalLevels?: Array<{
    order: number;
    role: string;
    userId?: string;
    status: string;
  }>;
}


import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * PendingApprovalItemDto
 *
 * One agreement awaiting approval in the user's scope.
 */
export class PendingApprovalItemDto {
  @ApiProperty({ description: 'Agreement ID (UUID)', example: 'a1b2c3d4-...' })
  @IsString()
  agreementId!: string;

  @ApiProperty({
    description: 'Human-readable agreement name or code',
    example: 'STA-2026-025',
  })
  @IsString()
  agreementName!: string;

  @ApiProperty({ description: 'Agreement type: STA | LTA', example: 'STA' })
  @IsString()
  agreementType!: string;

  @ApiProperty({ description: 'CPL name', example: 'Migros NKA' })
  @IsString()
  cplName!: string;

  @ApiProperty({ description: 'Channel name or code', example: 'MODERN_TRADE' })
  @IsString()
  channelCode!: string;

  @ApiProperty({ description: 'Period month (YYYY-MM)', example: '2026-06' })
  @IsString()
  period!: string;

  @ApiProperty({ description: 'Agreement status', example: 'PENDING' })
  @IsString()
  status!: string;
}

/**
 * PendingManualClaimItemDto
 *
 * An active agreement with a MANUAL tactic that has no claim yet.
 */
export class PendingManualClaimItemDto {
  @ApiProperty({ description: 'Agreement ID (UUID)' })
  @IsString()
  agreementId!: string;

  @ApiProperty({ description: 'Agreement name or code' })
  @IsString()
  agreementName!: string;

  @ApiProperty({ description: 'Agreement type: STA | LTA' })
  @IsString()
  agreementType!: string;

  @ApiProperty({ description: 'CPL name' })
  @IsString()
  cplName!: string;

  @ApiProperty({ description: 'Channel code' })
  @IsString()
  channelCode!: string;

  @ApiProperty({ description: 'Period month (YYYY-MM)' })
  @IsString()
  period!: string;

  @ApiProperty({
    description: 'Cap (ceiling) amount for this agreement',
    example: 5000,
  })
  @IsNumber()
  capTotalAmount!: number;

  @ApiProperty({
    description: 'Whether this agreement period is in the past',
    example: false,
  })
  @IsBoolean()
  isPastPeriod!: boolean;
}

/**
 * SubmittedClaimItemDto
 *
 * A claim that has been submitted and is awaiting finance review.
 * NOTE: CTPM does not have a separate Claim entity yet — placeholder for future.
 * For now, this maps to an Agreement that has been submitted for approval.
 */
export class SubmittedClaimItemDto {
  @ApiProperty({ description: 'Agreement ID (UUID)' })
  @IsString()
  agreementId!: string;

  @ApiProperty({ description: 'Agreement name or code' })
  @IsString()
  agreementName!: string;

  @ApiProperty({ description: 'Agreement type: STA | LTA' })
  @IsString()
  agreementType!: string;

  @ApiProperty({ description: 'CPL name' })
  @IsString()
  cplName!: string;

  @ApiProperty({ description: 'Channel code' })
  @IsString()
  channelCode!: string;

  @ApiProperty({ description: 'Period month (YYYY-MM)' })
  @IsString()
  period!: string;

  @ApiProperty({ description: 'Consumed amount so far', example: 2500 })
  @IsNumber()
  consumedAmount!: number;
}

/**
 * AwaitingInvoiceClaimItemDto
 *
 * An agreement in APPROVED/ACTIVE state with consumed spend > 0
 * that is awaiting an invoice settlement (i.e., off-invoice claims pending).
 */
export class AwaitingInvoiceClaimItemDto {
  @ApiProperty({ description: 'Agreement ID (UUID)' })
  @IsString()
  agreementId!: string;

  @ApiProperty({ description: 'Agreement name or code' })
  @IsString()
  agreementName!: string;

  @ApiProperty({ description: 'Agreement type: STA | LTA' })
  @IsString()
  agreementType!: string;

  @ApiProperty({ description: 'CPL name' })
  @IsString()
  cplName!: string;

  @ApiProperty({ description: 'Channel code' })
  @IsString()
  channelCode!: string;

  @ApiProperty({ description: 'Period month (YYYY-MM)' })
  @IsString()
  period!: string;

  @ApiProperty({
    description: 'Total consumed (invoiced) amount',
    example: 3200,
  })
  @IsNumber()
  consumedAmount!: number;

  @ApiProperty({ description: 'Whether the period is past', example: false })
  @IsBoolean()
  isPastPeriod!: boolean;

  @ApiPropertyOptional({ description: 'Days since last activity', example: 5 })
  @IsNumber()
  @IsOptional()
  daysWaiting?: number;
}

/**
 * PendingTasksResponseDto
 *
 * GET /dashboard/pending-tasks
 * Lists all actionable items for the current user broken down by category.
 */
export class PendingTasksResponseDto {
  @ApiProperty({
    description: 'Agreements pending approval in user scope',
    type: [PendingApprovalItemDto],
  })
  @IsArray()
  pendingApprovals!: PendingApprovalItemDto[];

  @ApiProperty({
    description: 'Active agreements with unclaimed MANUAL tactics',
    type: [PendingManualClaimItemDto],
  })
  @IsArray()
  pendingManualClaims!: PendingManualClaimItemDto[];

  @ApiProperty({
    description: 'Agreements submitted for approval (pending finance review)',
    type: [SubmittedClaimItemDto],
  })
  @IsArray()
  submittedClaims!: SubmittedClaimItemDto[];

  @ApiProperty({
    description: 'Active/approved agreements with pending invoice settlement',
    type: [AwaitingInvoiceClaimItemDto],
  })
  @IsArray()
  awaitingInvoiceClaims!: AwaitingInvoiceClaimItemDto[];
}

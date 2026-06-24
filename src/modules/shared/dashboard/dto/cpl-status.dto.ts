import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsString } from 'class-validator';

/**
 * CplStatusItemDto
 *
 * Status summary for a single CPL visible to the current user.
 */
export class CplStatusItemDto {
  @ApiProperty({ description: 'CPL ID (UUID)', example: 'c1d2e3f4-...' })
  @IsString()
  cplId!: string;

  @ApiProperty({ description: 'CPL display name', example: 'Migros NKA' })
  @IsString()
  cplName!: string;

  @ApiProperty({ description: 'Channel code', example: 'MODERN_TRADE' })
  @IsString()
  channelCode!: string;

  @ApiProperty({ description: 'Number of active STA agreements', example: 3 })
  @IsNumber()
  staCount!: number;

  @ApiProperty({ description: 'Number of active LTA agreements', example: 1 })
  @IsNumber()
  ltaCount!: number;

  @ApiProperty({
    description: 'Number of agreements pending approval',
    example: 2,
  })
  @IsNumber()
  pendingApproval!: number;

  @ApiProperty({
    description: 'Number of active agreements with unclaimed MANUAL tactics',
    example: 1,
  })
  @IsNumber()
  pendingManual!: number;

  @ApiProperty({
    description: 'Number of agreements awaiting invoice (off-invoice)',
    example: 0,
  })
  @IsNumber()
  awaitingInvoice!: number;

  /**
   * true when all three action counters are zero — CPL has no outstanding actions.
   * Computed: pendingApproval === 0 && pendingManual === 0 && awaitingInvoice === 0
   */
  @ApiProperty({
    description: 'Whether the CPL is fully up-to-date (no pending actions)',
    example: true,
  })
  @IsBoolean()
  isUpToDate!: boolean;
}

/**
 * CplStatusResponseDto
 *
 * GET /dashboard/cpl-status
 * Returns status for each CPL in the user's authorized scope.
 * Planner sees only their assigned CPLs. Admin/Manager see all tenant CPLs.
 */
export class CplStatusResponseDto {
  @ApiProperty({ description: 'CPL status items', type: [CplStatusItemDto] })
  @IsArray()
  items!: CplStatusItemDto[];
}

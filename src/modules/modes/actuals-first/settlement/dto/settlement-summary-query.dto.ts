import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsDateString, IsUUID, IsEnum } from 'class-validator';
import {
  AgreementStatus,
  SpendType,
} from '../../../../../database/entities/agreement.entity';

export class SettlementSummaryQueryDto {
  @ApiPropertyOptional({
    description: 'Period start date (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  periodFrom?: string;

  @ApiPropertyOptional({
    description: 'Period end date (YYYY-MM-DD)',
    example: '2026-12-31',
  })
  @IsOptional()
  @IsDateString()
  periodTo?: string;

  @ApiPropertyOptional({
    description: 'Filter by CPL (Customer Price List) UUID',
  })
  @IsOptional()
  @IsUUID()
  cplId?: string;

  @ApiPropertyOptional({ description: 'Filter by channel UUID' })
  @IsOptional()
  @IsUUID()
  channelId?: string;

  @ApiPropertyOptional({
    description: 'Filter by spend type',
    enum: SpendType,
  })
  @IsOptional()
  @IsEnum(SpendType)
  spendType?: SpendType;

  @ApiPropertyOptional({
    description: 'Filter by agreement status',
    enum: AgreementStatus,
  })
  @IsOptional()
  @IsEnum(AgreementStatus)
  status?: AgreementStatus;
}

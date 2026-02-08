import {
  IsString,
  IsUUID,
  IsEnum,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AgreementType,
  SpendType,
  MechanicType,
  ReconciliationPeriod,
} from '../../../../../database/entities/agreement.entity';

export class CreateAgreementDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  agreementName?: string;

  @ApiPropertyOptional({ description: 'Agreement description and scope details' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: AgreementType, description: 'STA (≤30 days) or LTA (>30 days)' })
  @IsEnum(AgreementType)
  agreementType!: AgreementType;

  @ApiProperty({ description: 'Customer ID (CPL)' })
  @IsUUID()
  @IsNotEmpty()
  cplId!: string;

  @ApiProperty({ description: 'Channel ID (UUID)' })
  @IsUUID()
  @IsNotEmpty()
  channelId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @ApiPropertyOptional({ description: 'Category ID (Hair Care, Skin Care, etc.)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ description: 'Forecasting Unit ID (required)' })
  @IsUUID()
  @IsNotEmpty()
  fuId!: string;

  @ApiPropertyOptional({ description: 'Generic Unit ID (optional)' })
  @IsOptional()
  @IsUUID()
  guId?: string;

  @ApiPropertyOptional({ description: 'SKU scope: GU, FU, SKU, ALL', default: 'FU' })
  @IsOptional()
  @IsString()
  skuScope?: string;

  @ApiProperty({ description: 'Tactic ID' })
  @IsUUID()
  @IsNotEmpty()
  tacticId!: string;

  @ApiProperty({ description: 'Mechanic ID' })
  @IsUUID()
  @IsNotEmpty()
  mechanicId!: string;

  @ApiPropertyOptional({ description: 'Mechanic value (e.g., 15.00 TL per unit or 10.5%)' })
  @IsOptional()
  @IsNumber()
  mechanicValue?: number;

  @ApiPropertyOptional({ enum: MechanicType })
  @IsOptional()
  @IsEnum(MechanicType)
  mechanicType?: MechanicType;

  @ApiProperty({ description: 'Budget ceiling for this agreement' })
  @IsNumber()
  @Min(0.01)
  capTotalAmount!: number;

  @ApiPropertyOptional({ enum: SpendType })
  @IsOptional()
  @IsEnum(SpendType)
  spendType?: SpendType;

  @ApiProperty({ description: 'Start date (YYYY-MM-DD)' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: 'End date (YYYY-MM-DD)' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ enum: ReconciliationPeriod, description: 'Reconciliation period: WEEKLY, MONTHLY, QUARTERLY, YEARLY' })
  @IsOptional()
  @IsEnum(ReconciliationPeriod)
  reconciliationPeriod?: ReconciliationPeriod;

  @ApiProperty({ description: 'Mandatory business rationale' })
  @IsString()
  @IsNotEmpty()
  justification!: string;

  @ApiPropertyOptional({ description: 'Additional notes for approver' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Currency code', default: 'TRY' })
  @IsOptional()
  @IsString()
  currency?: string;
}



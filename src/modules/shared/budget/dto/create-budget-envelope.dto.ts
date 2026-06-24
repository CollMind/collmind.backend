import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
  IsPositive,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetEnvelopeStatus } from '../../../../database/entities/budget-envelope.entity';

export class CreateBudgetEnvelopeDto {
  @ApiPropertyOptional({
    example: 'NKA/Hair/Jan',
    description: 'Budget envelope code (auto-generated if not provided)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  code?: string;

  @ApiPropertyOptional({
    example: 'NKA Hair Care January Budget',
    description: 'Budget envelope name (auto-generated if not provided)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ example: '2024', description: 'Fiscal year' })
  @IsString()
  @MinLength(4)
  @MaxLength(10)
  fiscalYear!: string;

  @ApiProperty({ example: '2024-01', description: 'Period (YYYY-MM format)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  period!: string;

  @ApiPropertyOptional({ example: '01', description: 'Month (01-12)' })
  @IsString()
  @IsOptional()
  @MaxLength(2)
  month?: string;

  @ApiProperty({ example: 100000, description: 'Allocated amount' })
  @IsNumber()
  @IsPositive()
  allocatedAmount!: number;

  @ApiPropertyOptional({
    enum: BudgetEnvelopeStatus,
    default: BudgetEnvelopeStatus.DRAFT,
  })
  @IsEnum(BudgetEnvelopeStatus)
  @IsOptional()
  status?: BudgetEnvelopeStatus;

  @ApiPropertyOptional({
    example: 'user-uuid',
    description: 'Budget owner user ID',
  })
  @IsUUID()
  @IsOptional()
  budgetOwnerId?: string;

  @ApiPropertyOptional({
    example: 'owner@example.com',
    description: 'Budget owner email',
  })
  @IsString()
  @IsOptional()
  budgetOwnerEmail?: string;

  @ApiPropertyOptional({
    example: 'John Doe',
    description: 'Budget owner name',
  })
  @IsString()
  @IsOptional()
  budgetOwnerName?: string;

  @ApiPropertyOptional({
    example: 'NKA',
    description: 'Channel code (NKA, ECOM, DT, TT, etc.)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  channel?: string;

  @ApiPropertyOptional({ example: 'HAIR_CARE', description: 'Category code' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ description: 'Channel entity ID reference' })
  @IsUUID()
  @IsOptional()
  channelId?: string;

  @ApiPropertyOptional({ description: 'Category entity ID reference' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'TRY', default: 'TRY' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, any>;
}

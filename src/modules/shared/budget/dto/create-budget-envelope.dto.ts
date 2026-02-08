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
  @ApiProperty({ example: 'NKA/Hair/Jan', description: 'Budget envelope code' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  code!: string;

  @ApiProperty({ example: 'NKA Hair Care January Budget', description: 'Budget envelope name' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: '2024', description: 'Fiscal year' })
  @IsString()
  @MinLength(4)
  @MaxLength(10)
  fiscalYear!: string;

  @ApiProperty({ example: 'Jan', description: 'Period (Jan, Q1, 2024, etc.)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  period!: string;

  @ApiProperty({ example: 100000, description: 'Allocated amount' })
  @IsNumber()
  @IsPositive()
  allocatedAmount!: number;

  @ApiPropertyOptional({ enum: BudgetEnvelopeStatus, default: BudgetEnvelopeStatus.DRAFT })
  @IsEnum(BudgetEnvelopeStatus)
  @IsOptional()
  status?: BudgetEnvelopeStatus;

  @ApiPropertyOptional({ example: 'user-uuid', description: 'Budget owner user ID' })
  @IsUUID()
  @IsOptional()
  budgetOwnerId?: string;

  @ApiPropertyOptional({ example: 'owner@example.com', description: 'Budget owner email' })
  @IsString()
  @IsOptional()
  budgetOwnerEmail?: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Budget owner name' })
  @IsString()
  @IsOptional()
  budgetOwnerName?: string;

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


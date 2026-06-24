import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsUUID,
} from 'class-validator';

export enum ErrorSeverity {
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

export enum ErrorCategory {
  INPUT_ERROR = 'INPUT_ERROR',
  COMBINATION_ERROR = 'COMBINATION_ERROR',
  BUDGET_ERROR = 'BUDGET_ERROR',
  BUSINESS_RULE_ERROR = 'BUSINESS_RULE_ERROR',
  CALCULATION_ERROR = 'CALCULATION_ERROR',
}

export class ValidationError {
  @ApiProperty({ description: 'Error severity', enum: ErrorSeverity })
  @IsEnum(ErrorSeverity)
  severity!: ErrorSeverity;

  @ApiProperty({ description: 'Error category', enum: ErrorCategory })
  @IsEnum(ErrorCategory)
  category!: ErrorCategory;

  @ApiProperty({ description: 'Error message' })
  @IsString()
  message!: string;

  @ApiPropertyOptional({
    description: 'Field or mechanic code that caused the error',
  })
  @IsString()
  field?: string;

  @ApiPropertyOptional({ description: 'FU ID if applicable' })
  @IsUUID()
  fuId?: string;

  @ApiPropertyOptional({ description: 'SKU ID if applicable' })
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ description: 'Suggested fix' })
  @IsString()
  suggestion?: string;

  @ApiPropertyOptional({ description: 'Additional context' })
  @IsObject()
  context?: Record<string, any>;
}

export class InputValidationResult {
  @ApiProperty({ description: 'Are all inputs valid?' })
  @IsBoolean()
  isValid!: boolean;

  @ApiProperty({
    description: 'List of validation errors',
    type: [ValidationError],
  })
  @IsArray()
  errors!: ValidationError[];

  @ApiProperty({ description: 'Number of errors' })
  @IsNumber()
  errorCount!: number;

  @ApiProperty({ description: 'Number of warnings' })
  @IsNumber()
  warningCount!: number;
}

export class CombinationValidationResult {
  @ApiProperty({ description: 'Are combinations valid?' })
  @IsBoolean()
  isValid!: boolean;

  @ApiProperty({ description: 'Total on-invoice discount percentage' })
  @IsNumber()
  totalOnInvoiceDiscount!: number;

  @ApiProperty({ description: 'Total off-invoice discount percentage' })
  @IsNumber()
  totalOffInvoiceDiscount!: number;

  @ApiProperty({ description: 'Combined discount percentage' })
  @IsNumber()
  combinedDiscount!: number;

  @ApiProperty({ description: 'Validation errors', type: [ValidationError] })
  @IsArray()
  errors!: ValidationError[];

  @ApiProperty({ description: 'Mutually exclusive conflicts found' })
  @IsArray()
  @IsString({ each: true })
  conflicts!: string[];
}

export class BudgetValidationResult {
  @ApiProperty({ description: 'Is budget sufficient?' })
  @IsBoolean()
  isSufficient!: boolean;

  @ApiProperty({ description: 'On-invoice available budget' })
  @IsNumber()
  onInvoiceAvailable!: number;

  @ApiProperty({ description: 'Off-invoice available budget' })
  @IsNumber()
  offInvoiceAvailable!: number;

  @ApiProperty({ description: 'On-invoice shortfall (0 or positive)' })
  @IsNumber()
  onInvoiceShortfall!: number;

  @ApiProperty({ description: 'Off-invoice shortfall (0 or positive)' })
  @IsNumber()
  offInvoiceShortfall!: number;

  @ApiProperty({ description: 'Validation errors', type: [ValidationError] })
  @IsArray()
  errors!: ValidationError[];

  @ApiProperty({ description: 'Suggestions to fit budget', type: [String] })
  @IsArray()
  @IsString({ each: true })
  suggestions!: string[];
}

export class PreSubmissionValidation {
  @ApiProperty({ description: 'Can plan be submitted?' })
  @IsBoolean()
  canSubmit!: boolean;

  @ApiProperty({ description: 'Has blocking errors?' })
  @IsBoolean()
  hasBlockingErrors!: boolean;

  @ApiProperty({ description: 'Input validation result' })
  @IsObject()
  inputValidation!: InputValidationResult;

  @ApiProperty({ description: 'Combination validation result' })
  @IsObject()
  combinationValidation!: CombinationValidationResult;

  @ApiProperty({ description: 'Budget validation result' })
  @IsObject()
  budgetValidation!: BudgetValidationResult;

  @ApiProperty({ description: 'All errors combined', type: [ValidationError] })
  @IsArray()
  allErrors!: ValidationError[];

  @ApiProperty({ description: 'Total error count' })
  @IsNumber()
  totalErrorCount!: number;

  @ApiProperty({ description: 'Total warning count' })
  @IsNumber()
  totalWarningCount!: number;

  @ApiProperty({ description: 'Auto-fix suggestions', type: [String] })
  @IsArray()
  @IsString({ each: true })
  autoFixSuggestions!: string[];
}

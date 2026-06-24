import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsNumber,
  IsEnum,
  MaxLength,
  Matches,
  ValidateIf,
  IsArray,
  ArrayMinSize,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MechanicType,
  SpendingType,
  MechanicCategory,
  InputType,
  BudgetType,
} from '../../../../database/entities/mechanic.entity';

export class CreateMechanicDto {
  @ApiProperty({
    description: 'Mechanic code (uppercase, alphanumeric with underscores)',
    example: 'CPP_ON_INV',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Transform(({ value }) => {
    if (typeof value === 'string' && value.trim()) {
      // Convert to uppercase (validation will check format)
      return value.trim().toUpperCase();
    }
    return value;
  })
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message:
      'Mechanic code must start with uppercase letter and contain only uppercase letters, numbers, and underscores',
  })
  code!: string;

  @ApiProperty({
    description: 'Mechanic display name',
    example: 'CPP On-Invoice %',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'Detailed description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Tactic ID' })
  @IsUUID()
  @IsNotEmpty()
  tacticId!: string;

  @ApiProperty({ description: 'Mechanic type', enum: MechanicType })
  @IsEnum(MechanicType)
  mechanicType!: MechanicType;

  @ApiPropertyOptional({
    description: 'Mechanic category',
    enum: MechanicCategory,
  })
  @IsEnum(MechanicCategory)
  @IsOptional()
  category?: MechanicCategory;

  @ApiPropertyOptional({ description: 'Spending type', enum: SpendingType })
  @IsEnum(SpendingType)
  @IsOptional()
  spendingType?: SpendingType;

  // Input Configuration
  @ApiPropertyOptional({ description: 'Input type', enum: InputType })
  @IsEnum(InputType)
  @IsOptional()
  inputType?: InputType;

  @ApiPropertyOptional({ description: 'Minimum value' })
  @IsNumber()
  @IsOptional()
  minValue?: number;

  @ApiPropertyOptional({ description: 'Maximum value' })
  @IsNumber()
  @IsOptional()
  @ValidateIf((o) => o.minValue !== undefined)
  @Min(0)
  maxValue?: number;

  @ApiPropertyOptional({ description: 'Default value' })
  @IsNumber()
  @IsOptional()
  defaultValue?: number;

  @ApiPropertyOptional({ description: 'Step increment for slider' })
  @IsNumber()
  @IsOptional()
  stepIncrement?: number;

  @ApiPropertyOptional({
    description: 'Decimal places for display',
    minimum: 0,
    maximum: 4,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(4)
  decimalPlaces?: number;

  @ApiPropertyOptional({
    description: 'Unit symbol (%, $, pcs, etc.)',
    example: '%',
  })
  @IsString()
  @IsOptional()
  @MaxLength(10)
  unitSymbol?: string;

  // Calculation Formula
  @ApiPropertyOptional({
    description: 'Calculation formula',
    example: '(PLANNED_GSV - PLANNED_LTA_ON) * VALUE / 100',
  })
  @IsString()
  @IsOptional()
  calculationFormula?: string;

  @ApiPropertyOptional({
    description: 'Available formula variables',
    type: 'object',
  })
  @IsOptional()
  formulaVariables?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Test data for formula validation',
    type: 'object',
  })
  @IsOptional()
  testData?: Record<string, any>;

  // Applicability Rules
  @ApiPropertyOptional({
    description: 'Applicable channels',
    example: ['NKA', 'Traditional Trade', 'E-Commerce'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, {
    message: 'At least one channel must be specified or use ["ALL"]',
  })
  @IsOptional()
  applicableChannels?: string[];

  @ApiPropertyOptional({
    description: 'Applicable categories',
    example: ['Dairy', 'Beverages'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  applicableCategories?: string[];

  @ApiPropertyOptional({ description: 'Applicable CPL IDs', type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  applicableCpls?: string[];

  @ApiPropertyOptional({ description: 'Exclusion rules', type: 'object' })
  @IsOptional()
  exclusionRules?: Record<string, any>;

  // Visibility and Sorting
  @ApiPropertyOptional({ description: 'Show in grid', default: true })
  @IsBoolean()
  @IsOptional()
  showInGrid?: boolean;

  @ApiPropertyOptional({ description: 'Grid column order' })
  @IsNumber()
  @IsOptional()
  gridColumnOrder?: number;

  @ApiPropertyOptional({ description: 'Grid column width in pixels' })
  @IsNumber()
  @IsOptional()
  gridColumnWidth?: number;

  @ApiPropertyOptional({
    description: 'Group header',
    example: 'On-Invoice Discounts',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  groupHeader?: string;

  // Budget and Approval Rules
  @ApiPropertyOptional({ description: 'Track against budget', default: true })
  @IsBoolean()
  @IsOptional()
  trackAgainstBudget?: boolean;

  @ApiPropertyOptional({ description: 'Budget type', enum: BudgetType })
  @IsEnum(BudgetType)
  @IsOptional()
  budgetType?: BudgetType;

  @ApiPropertyOptional({ description: 'Approval threshold amount' })
  @IsNumber()
  @IsOptional()
  requiresApprovalThreshold?: number;

  @ApiPropertyOptional({
    description: 'Approval flow configuration',
    type: 'object',
  })
  @IsOptional()
  approvalFlow?: Record<string, any>;

  // Combination and Constraint Rules
  @ApiPropertyOptional({
    description: 'Mutually exclusive mechanic codes',
    type: [String],
    example: ['CPP_OFF_INV', 'VISIBILITY_MTPH'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  mutuallyExclusiveWith?: string[];

  @ApiPropertyOptional({
    description: 'Max combined discount percentage',
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  maxCombinedDiscountPercentage?: number;

  @ApiPropertyOptional({ description: 'Combination warnings', type: 'object' })
  @IsOptional()
  combinationWarnings?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Additional metadata', type: 'object' })
  @IsOptional()
  metadata?: Record<string, any>;
}

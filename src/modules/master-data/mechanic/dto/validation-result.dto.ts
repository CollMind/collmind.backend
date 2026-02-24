import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FormulaValidationStatus } from '../../../../database/entities/mechanic.entity';

export class ValidationResult {
  @ApiProperty({ description: 'Validation status', enum: FormulaValidationStatus })
  status!: FormulaValidationStatus;

  @ApiProperty({ description: 'Is valid', type: Boolean })
  isValid!: boolean;

  @ApiPropertyOptional({ description: 'Error message if invalid' })
  errorMessage?: string;

  @ApiPropertyOptional({ description: 'Validation details', type: 'object' })
  details?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Calculated result with test data' })
  testResult?: number;
}

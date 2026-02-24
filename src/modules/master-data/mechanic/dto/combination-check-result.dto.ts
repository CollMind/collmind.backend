import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CombinationCheckResult {
  @ApiProperty({ description: 'Is valid combination', type: Boolean })
  isValid!: boolean;

  @ApiPropertyOptional({ description: 'Error message if invalid' })
  errorMessage?: string;

  @ApiPropertyOptional({ description: 'Warnings', type: [String] })
  warnings?: string[];

  @ApiPropertyOptional({ description: 'Conflicting mechanics', type: [String] })
  conflictingMechanics?: string[];

  @ApiPropertyOptional({ description: 'Total discount percentage if applicable' })
  totalDiscountPercentage?: number;
}

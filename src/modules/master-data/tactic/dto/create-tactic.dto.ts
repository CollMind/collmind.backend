import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TacticType } from '../../../../database/entities/tactic.entity';

export class CreateTacticDto {
  @ApiProperty({ description: 'Tactic code', example: 'TAC-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: 'Tactic name', example: 'Discount' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'Tactic description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Tactic type', enum: TacticType })
  @IsEnum(TacticType)
  tacticType!: TacticType;

  @ApiPropertyOptional({
    description: 'Spend type',
    enum: ['ON_INVOICE', 'OFF_INVOICE', 'BOTH'],
  })
  @IsEnum(['ON_INVOICE', 'OFF_INVOICE', 'BOTH'])
  @IsOptional()
  spendType?: 'ON_INVOICE' | 'OFF_INVOICE' | 'BOTH';

  @ApiPropertyOptional({ description: 'Applicable channels', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  applicableChannels?: string[];

  @ApiPropertyOptional({ description: 'Applicable categories', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  applicableCategories?: string[];

  @ApiPropertyOptional({ description: 'Is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, any>;
}

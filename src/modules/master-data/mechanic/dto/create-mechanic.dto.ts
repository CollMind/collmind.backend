import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsUUID, IsNumber, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MechanicType } from '../../../../database/entities/mechanic.entity';

export class CreateMechanicDto {
  @ApiProperty({ description: 'Mechanic code', example: 'MEC-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: 'Mechanic name', example: '10% Discount' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'Mechanic description' })
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

  @ApiPropertyOptional({ description: 'Calculation rules' })
  @IsOptional()
  calculationRules?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Min value' })
  @IsNumber()
  @IsOptional()
  minValue?: number;

  @ApiPropertyOptional({ description: 'Max value' })
  @IsNumber()
  @IsOptional()
  maxValue?: number;

  @ApiPropertyOptional({ description: 'Is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, any>;
}

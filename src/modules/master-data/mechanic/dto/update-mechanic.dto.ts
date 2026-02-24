import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateMechanicDto } from './create-mechanic.dto';
import { FormulaValidationStatus } from '../../../../database/entities/mechanic.entity';

export class UpdateMechanicDto extends PartialType(CreateMechanicDto) {
  @ApiPropertyOptional({ description: 'Formula validation status', enum: FormulaValidationStatus })
  @IsEnum(FormulaValidationStatus)
  @IsOptional()
  formulaValidationStatus?: FormulaValidationStatus;
}

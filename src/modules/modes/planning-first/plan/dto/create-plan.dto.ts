import {
  IsString,
  IsUUID,
  IsDateString,
  IsOptional,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanDto {
  @ApiProperty({ maxLength: 200, description: 'Plan name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  planName!: string;

  @ApiPropertyOptional({ description: 'Plan description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Customer ID (CPL)' })
  @IsUUID()
  @IsNotEmpty()
  cplId!: string;

  @ApiProperty({ description: 'Channel ID (UUID)' })
  @IsUUID()
  @IsNotEmpty()
  channelId!: string;

  @ApiPropertyOptional({ description: 'Region ID' })
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @ApiProperty({ description: 'Category ID' })
  @IsUUID()
  @IsNotEmpty()
  categoryId!: string;

  @ApiProperty({ description: 'Start date (YYYY-MM-DD)' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ description: 'End date (YYYY-MM-DD)' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Planner comments for approver' })
  @IsOptional()
  @IsString()
  comments?: string;
}

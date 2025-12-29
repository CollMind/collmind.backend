import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
  IsObject,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantStatus, TenantPlan } from '../../../database/entities/tenant.entity';

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Corporation', description: 'Tenant name' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'acme.tsp.com', description: 'Custom domain' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  domain?: string;

  @ApiPropertyOptional({ enum: TenantStatus, default: TenantStatus.TRIAL })
  @IsEnum(TenantStatus)
  @IsOptional()
  status?: TenantStatus;

  @ApiPropertyOptional({ enum: TenantPlan, default: TenantPlan.FREE })
  @IsEnum(TenantPlan)
  @IsOptional()
  plan?: TenantPlan;

  @ApiPropertyOptional({ example: 'contact@acme.com' })
  @IsEmail()
  @IsOptional()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+90 555 123 4567' })
  @IsString()
  @IsOptional()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  contactPerson?: string;

  @ApiPropertyOptional({ example: '123 Main Street' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Istanbul' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Turkey' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: '34000' })
  @IsString()
  @IsOptional()
  postalCode?: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @IsString()
  @IsOptional()
  taxNumber?: string;

  @ApiPropertyOptional({ example: 'FMCG' })
  @IsString()
  @IsOptional()
  industry?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  settings?: {
    defaultCurrency?: string;
    fiscalYearStart?: string;
    timezone?: string;
    dateFormat?: string;
    numberFormat?: string;
  };

  @ApiPropertyOptional({ example: 10 })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxUsers?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxStorageGB?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  subscriptionStartDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  subscriptionEndDate?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}


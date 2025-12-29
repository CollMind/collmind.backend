import { ApiProperty } from '@nestjs/swagger';
import { TenantStatus, TenantPlan } from '../../../database/entities/tenant.entity';

export class TenantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  domain?: string;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiProperty({ enum: TenantPlan })
  plan!: TenantPlan;

  @ApiProperty()
  contactEmail?: string;

  @ApiProperty()
  contactPhone?: string;

  @ApiProperty()
  contactPerson?: string;

  @ApiProperty()
  city?: string;

  @ApiProperty()
  country?: string;

  @ApiProperty()
  industry?: string;

  @ApiProperty()
  maxUsers!: number;

  @ApiProperty()
  maxStorageGB!: number;

  @ApiProperty()
  currentStorageGB!: number;

  @ApiProperty()
  subscriptionStartDate?: Date;

  @ApiProperty()
  subscriptionEndDate?: Date;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}


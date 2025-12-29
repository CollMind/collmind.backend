import { ApiProperty } from '@nestjs/swagger';
import {
  CustomerChannel,
  CustomerType,
  CustomerStatus,
} from '../../../database/entities/customer.entity';

export class CustomerResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: CustomerChannel })
  channel!: CustomerChannel;

  @ApiProperty({ enum: CustomerType })
  type!: CustomerType;

  @ApiProperty({ enum: CustomerStatus })
  status!: CustomerStatus;

  @ApiProperty()
  city?: string;

  @ApiProperty()
  district?: string;

  @ApiProperty()
  region?: string;

  @ApiProperty()
  country?: string;

  @ApiProperty()
  contactPerson?: string;

  @ApiProperty()
  contactEmail?: string;

  @ApiProperty()
  contactPhone?: string;

  @ApiProperty()
  customerTier?: string;

  @ApiProperty()
  isVip!: boolean;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}


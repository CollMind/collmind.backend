import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
  IsObject,
  IsNumber,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CustomerChannel,
  CustomerType,
  CustomerStatus,
} from '../../../database/entities/customer.entity';

export class CreateCustomerDto {
  @ApiProperty({ example: 'CUST001', description: 'Customer code' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'Metro Türkiye', description: 'Customer name' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: CustomerChannel, description: 'Customer channel' })
  @IsEnum(CustomerChannel)
  channel!: CustomerChannel;

  @ApiPropertyOptional({ enum: CustomerType, default: CustomerType.DIRECT })
  @IsEnum(CustomerType)
  @IsOptional()
  type?: CustomerType;

  @ApiPropertyOptional({ enum: CustomerStatus, default: CustomerStatus.ACTIVE })
  @IsEnum(CustomerStatus)
  @IsOptional()
  status?: CustomerStatus;

  // Location Information
  @ApiPropertyOptional({ example: 'Istanbul' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'Beşiktaş' })
  @IsString()
  @IsOptional()
  district?: string;

  @ApiPropertyOptional({ example: 'Marmara' })
  @IsString()
  @IsOptional()
  region?: string;

  @ApiPropertyOptional({ example: 'Turkey' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 'Metro Plaza, Beşiktaş' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: '34349' })
  @IsString()
  @IsOptional()
  postalCode?: string;

  // Business Information
  @ApiPropertyOptional({ example: '1234567890' })
  @IsString()
  @IsOptional()
  taxNumber?: string;

  @ApiPropertyOptional({ example: 'Beşiktaş' })
  @IsString()
  @IsOptional()
  taxOffice?: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @IsString()
  @IsOptional()
  companyRegistrationNumber?: string;

  // Contact Information
  @ApiPropertyOptional({ example: 'Ahmet Yılmaz' })
  @IsString()
  @IsOptional()
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'ahmet.yilmaz@metro.com.tr' })
  @IsEmail()
  @IsOptional()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+90 212 555 1234' })
  @IsString()
  @IsOptional()
  contactPhone?: string;

  @ApiPropertyOptional({ example: '+90 555 123 4567' })
  @IsString()
  @IsOptional()
  contactMobile?: string;

  // Business Details
  @ApiPropertyOptional({ example: 'NET30' })
  @IsString()
  @IsOptional()
  paymentTerms?: string;

  @ApiPropertyOptional({ example: 500000 })
  @IsNumber()
  @IsOptional()
  creditLimit?: number;

  @ApiPropertyOptional({ example: 'TRY', default: 'TRY' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  salesRepresentative?: string;

  @ApiPropertyOptional({ example: 'Jane Smith' })
  @IsString()
  @IsOptional()
  accountManager?: string;

  // Classification
  @ApiPropertyOptional({ example: 'Modern Trade' })
  @IsString()
  @IsOptional()
  customerGroup?: string;

  @ApiPropertyOptional({ example: 'Hypermarket' })
  @IsString()
  @IsOptional()
  customerSegment?: string;

  @ApiPropertyOptional({ example: 'A' })
  @IsString()
  @IsOptional()
  customerTier?: string;

  @ApiPropertyOptional({ example: 'Large' })
  @IsString()
  @IsOptional()
  businessSize?: string;

  // Financial
  @ApiPropertyOptional({ example: 1000000 })
  @IsNumber()
  @IsOptional()
  annualRevenue?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  lastOrderDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  firstOrderDate?: string;

  @ApiPropertyOptional({ example: 5, description: 'Number of branches' })
  @IsNumber()
  @IsOptional()
  numberOfBranches?: number;

  // Additional
  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  metadata?: {
    storeSize?: number;
    numberOfEmployees?: number;
    numberOfLocations?: number;
    industry?: string;
    website?: string;
    socialMedia?: {
      facebook?: string;
      instagram?: string;
      linkedin?: string;
    };
  };

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  isVip?: boolean;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  contractStartDate?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  contractEndDate?: string;
}


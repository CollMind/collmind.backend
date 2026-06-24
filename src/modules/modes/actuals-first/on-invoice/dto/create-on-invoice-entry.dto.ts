import {
  IsString,
  IsNumber,
  IsDateString,
  IsEnum,
  IsOptional,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OnInvoiceDiscountType } from '../../../../../database/entities/on-invoice-entry.entity';

export class CreateOnInvoiceEntryDto {
  @ApiProperty({ description: 'Müşteri kodu (CPL ile eşleşen)' })
  @IsString()
  customerCode!: string;

  @ApiProperty({ description: 'ERP fatura numarası' })
  @IsString()
  invoiceNo!: string;

  @ApiProperty({ description: 'Fatura tarihi (YYYY-MM-DD)' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ description: 'Bütçe dönemi (YYYY-MM)' })
  @IsString()
  fiscalPeriod!: string;

  @ApiProperty({ description: 'SKU kodu' })
  @IsString()
  skuCode!: string;

  @ApiProperty({ description: 'Miktar' })
  @IsNumber()
  @Min(0)
  quantity!: number;

  @ApiProperty({ description: 'Liste fiyatı' })
  @IsNumber()
  @Min(0)
  listPrice!: number;

  @ApiProperty({ description: 'İndirimli birim fiyat' })
  @IsNumber()
  @Min(0)
  actualPrice!: number;

  @ApiProperty({ description: 'Satır bazlı toplam indirim (₺)' })
  @IsNumber()
  discount!: number;

  @ApiProperty({ description: 'İndirim tipi', enum: OnInvoiceDiscountType })
  @IsEnum(OnInvoiceDiscountType)
  discountType!: OnInvoiceDiscountType;

  @ApiProperty({ description: 'Para birimi', default: 'TRY', required: false })
  @IsOptional()
  @IsString()
  currency?: string;
}

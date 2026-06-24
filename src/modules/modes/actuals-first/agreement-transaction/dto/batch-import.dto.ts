import { IsArray, ValidateNested, IsUUID, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAgreementTransactionDto } from './create-agreement-transaction.dto';

export class BatchImportDto {
  @ApiProperty({ type: [CreateAgreementTransactionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAgreementTransactionDto)
  transactions!: CreateAgreementTransactionDto[];

  @ApiPropertyOptional({ description: 'Optional batch ID for tracking' })
  @IsOptional()
  @IsUUID()
  batchId?: string;
}

export class BatchImportResultDto {
  batchId!: string;
  totalRows!: number;
  successCount!: number;
  errorCount!: number;
  errors!: Array<{
    rowNumber: number;
    invoiceNo: string;
    error: string;
  }>;
  createdTransactions!: string[]; // IDs
}

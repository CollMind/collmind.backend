import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AgreementTransactionService } from './agreement-transaction.service';
import { CreateAgreementTransactionDto, BatchImportDto } from './dto';
import { OffInvoiceFileParserService } from './services/off-invoice-file-parser.service';
import { OffInvoiceValidationService } from './services/off-invoice-validation.service';
import { AgreementService } from '../agreement/agreement.service';
import { BudgetService } from '../../../shared/budget/budget.service';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';
import { randomUUID } from 'crypto';

@ApiTags('Agreement Transactions (Off-Invoice)')
@ApiBearerAuth()
@Controller('agreement-transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgreementTransactionController {
  constructor(
    private readonly txService: AgreementTransactionService,
    private readonly fileParserService: OffInvoiceFileParserService,
    private readonly validationService: OffInvoiceValidationService,
    private readonly agreementService: AgreementService,
    private readonly budgetService: BudgetService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Create single off-invoice transaction' })
  create(
    @Body() dto: CreateAgreementTransactionDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.txService.create(dto, tenantId, user.id);
  }

  @Post('batch')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Batch import off-invoice transactions' })
  batchImport(
    @Body() dto: BatchImportDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.txService.batchImport(dto, tenantId, user.id);
  }

  @Get('agreement/:agreementId')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get transactions by agreement ID' })
  findByAgreement(
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @TenantId() tenantId: string,
  ) {
    return this.txService.findByAgreementId(agreementId, tenantId);
  }

  @Get('agreement/:agreementId/total')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get total transaction amount for agreement' })
  async getTotalByAgreement(
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @TenantId() tenantId: string,
  ) {
    const total = await this.txService.getTotalByAgreement(
      agreementId,
      tenantId,
    );
    return { agreementId, total };
  }

  @Get('batch/:batchId')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get transactions by batch ID' })
  findByBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.txService.findByBatchId(batchId, tenantId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get all agreement transactions with filters' })
  findAll(
    @TenantId() tenantId: string,
    @Query('agreementId') agreementId?: string,
    @Query('batchId') batchId?: string,
    @Query('invoiceDateFrom') invoiceDateFrom?: string,
    @Query('invoiceDateTo') invoiceDateTo?: string,
    @Query('cplId') cplId?: string,
    @Query('status') status?: string,
  ) {
    const filters: any = { agreementId, batchId };
    if (invoiceDateFrom) {
      filters.invoiceDateFrom = new Date(invoiceDateFrom);
    }
    if (invoiceDateTo) {
      filters.invoiceDateTo = new Date(invoiceDateTo);
    }
    if (cplId) {
      filters.cplId = cplId;
    }
    return this.txService.findAll(tenantId, filters);
  }

  @Get('budget-impact/:agreementId')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({
    summary: 'Get budget impact for agreement and fiscal period',
  })
  async getBudgetImpact(
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Query('fiscalPeriod') fiscalPeriod: string,
    @TenantId() tenantId: string,
  ) {
    // Agreement repository already loads relations
    const agreement = await this.agreementService.findById(
      agreementId,
      tenantId,
    );

    if (!agreement.channel) {
      throw new BadRequestException('Agreement channel relation is not loaded');
    }

    const channelCode = agreement.channel.code;

    // Get category from agreement or FU
    let categoryCode: string | undefined;
    if (agreement.category) {
      categoryCode = agreement.category.code;
    } else if (agreement.forecastingUnit) {
      // Load FU with nested relations if needed
      // For now, use categoryId from agreement if available
      if (agreement.categoryId) {
        // Category code will be derived from envelope matching
        categoryCode = undefined; // Will be matched by envelope
      }
    }

    const envelope = await this.budgetService.findEnvelopeByDimensions(
      tenantId,
      channelCode,
      fiscalPeriod,
      categoryCode,
    );

    if (!envelope) {
      return {
        envelope: null,
        currentAvailable: 0,
        channel: channelCode,
        category: categoryCode,
        period: fiscalPeriod,
      };
    }

    return {
      envelope: {
        id: envelope.id,
        code: envelope.code,
        channel: envelope.channel || channelCode,
        category: envelope.category || categoryCode,
        period: envelope.period,
        availableAmount: envelope.availableAmount,
      },
      currentAvailable: envelope.availableAmount,
      channel: channelCode,
      category: categoryCode,
      period: fiscalPeriod,
    };
  }

  @Get('count')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get total count of off-invoice transactions' })
  async getCount(@TenantId() tenantId: string) {
    const count = await this.txService.getCount(tenantId);
    return { count };
  }

  @Get('stats/summary')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get transaction statistics summary' })
  async getSummary(
    @TenantId() tenantId: string,
    @Query('invoiceDateFrom') invoiceDateFrom?: string,
    @Query('invoiceDateTo') invoiceDateTo?: string,
  ) {
    const filters: any = {};
    if (invoiceDateFrom) {
      filters.invoiceDateFrom = new Date(invoiceDateFrom);
    }
    if (invoiceDateTo) {
      filters.invoiceDateTo = new Date(invoiceDateTo);
    }

    const transactions = await this.txService.findAll(tenantId, filters);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTransactions = transactions.filter((tx) => {
      const txDate = new Date(tx.invoiceDate);
      txDate.setHours(0, 0, 0, 0);
      return txDate.getTime() === today.getTime();
    });

    const totalAmount = transactions.reduce(
      (sum, tx) => sum + Number(tx.amount),
      0,
    );
    const todayAmount = todayTransactions.reduce(
      (sum, tx) => sum + Number(tx.amount),
      0,
    );

    // Off-Invoice ve On-Invoice ayrımı (şimdilik hepsi Off-Invoice)
    const offInvoiceCount = transactions.length;
    const offInvoiceAmount = totalAmount;
    const onInvoiceCount = 0;
    const onInvoiceAmount = 0;

    return {
      today: {
        count: todayTransactions.length,
        amount: todayAmount,
      },
      pending: {
        count: 0, // TODO: Implement status-based filtering
        amount: 0,
      },
      total: {
        count: transactions.length,
        amount: totalAmount,
        records: transactions.length,
      },
      offInvoiceShare: {
        off: {
          count: offInvoiceCount,
          amount: offInvoiceAmount,
          percentage: transactions.length > 0 ? 100 : 0,
        },
        on: {
          count: onInvoiceCount,
          amount: onInvoiceAmount,
          percentage: 0,
        },
      },
    };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.PLANNER, UserRole.FINANCE)
  @ApiOperation({ summary: 'Get transaction by ID' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.txService.findById(id, tenantId);
  }

  @Post('upload')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload Off-Invoice file (Excel/CSV) and validate' })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @TenantId() tenantId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Dosya yüklenmedi');
    }

    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
    let parsedRows;

    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      parsedRows = await this.fileParserService.parseExcel(file);
    } else if (fileExtension === 'csv') {
      parsedRows = await this.fileParserService.parseCSV(file);
    } else {
      throw new BadRequestException(
        'Desteklenmeyen dosya formatı. Sadece Excel (.xlsx, .xls) veya CSV (.csv) dosyaları kabul edilir.',
      );
    }

    // Validasyon yap
    const validationResults = await this.validationService.validateBatch(
      parsedRows,
      tenantId,
    );

    // Sonuçları grupla
    const validRows: any[] = [];
    const invalidRows: any[] = [];
    const warningRows: any[] = [];

    validationResults.forEach((result, index) => {
      const row = parsedRows[index];
      if (result.isValid) {
        if (result.warnings.length > 0) {
          warningRows.push({
            ...row.dto,
            rowNumber: result.rowNumber,
            warnings: result.warnings,
            fiscalPeriod: row.fiscalPeriod,
          });
        } else {
          validRows.push({
            ...row.dto,
            rowNumber: result.rowNumber,
            fiscalPeriod: row.fiscalPeriod,
          });
        }
      } else {
        invalidRows.push({
          ...row.dto,
          rowNumber: result.rowNumber,
          errors: result.errors,
          warnings: result.warnings,
          fiscalPeriod: row.fiscalPeriod,
        });
      }
    });

    return {
      totalRows: parsedRows.length,
      validCount: validRows.length,
      invalidCount: invalidRows.length,
      warningCount: warningRows.length,
      validRows,
      invalidRows,
      warningRows,
      summary: {
        totalAmount: validRows.reduce((sum, row) => sum + (row.amount || 0), 0),
        affectedAgreements: new Set(validRows.map((r) => r.agreementId)).size,
      },
    };
  }

  @Post('validate-and-import')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Validate and import validated rows' })
  async validateAndImport(
    @Body() body: { rows: CreateAgreementTransactionDto[]; batchId?: string },
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    const batchId = body.batchId || randomUUID();
    const result = await this.txService.batchImport(
      {
        transactions: body.rows,
        batchId,
      },
      tenantId,
      user.id,
    );

    return result;
  }

  @Get('template/excel')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Download Excel template' })
  async downloadExcelTemplate(@Res() res: Response) {
    const buffer = this.fileParserService.generateExcelTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=off-invoice-template.xlsx',
    );
    res.send(buffer);
  }

  @Get('template/csv')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Download CSV template' })
  async downloadCSVTemplate(@Res() res: Response) {
    const csv = this.fileParserService.generateCSVTemplate();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=off-invoice-template.csv',
    );
    res.send(csv);
  }
}

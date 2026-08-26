import {
  Controller,
  Get,
  Post,
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
import { OnInvoiceService } from './on-invoice.service';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../../common/guards/capability.guard';
import { RequireCapability } from '../../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../../common/authorization/capabilities';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';

// `B3 W6` göçü (2026-08-26, `Z35`) — GERÇEKLEŞME yazımı (`MODES_ACTUALS_WRITE`,
// {ADMIN,FINANCE}: upload/validateBatch/processBatch) `@Roles` →
// `@RequireCapability` göçürüldü. `ROLE_CAPABILITIES`'te hücre göç öncesi
// `@Roles(ADMIN,FINANCE)` kümesiyle BİREBİR — davranış KORUNUYOR.
// `Z42 §4` (`B3b-1 W9`, 2026-08-26) — `count`/`entries`/`batch/:batchId`
// YENİ hücre `MODES_ONINVOICE_READ`'e göçürüldü ({A,F,P,RO}, birebir);
// `template/csv`/`template/excel` YENİ hücre `MODES_IMPORT_READ`'e
// göçürüldü ({A,F}, birebir). Dosyada `@Roles` kalmadı — `RolesGuard`
// kardeş controller'larla aynı `@UseGuards` deseni için KORUNDU (no-op,
// dekoratörsüz).
@ApiTags('On-Invoice')
@ApiBearerAuth()
@Controller('on-invoice')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class OnInvoiceController {
  constructor(private readonly onInvoiceService: OnInvoiceService) {}

  /**
   * Adım 1: Dosya Yükleme
   */
  @Post('upload')
  @RequireCapability(CAPABILITIES.MODES_ACTUALS_WRITE)
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
  @ApiOperation({ summary: 'Adım 1: On-Invoice dosyası yükle (Excel/CSV)' })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    if (!file) {
      throw new BadRequestException('Dosya yüklenmedi');
    }

    // Dosyayı parse et, batch oluştur ve validasyon yap
    // Service içinde tüm işlemler yapılıyor
    return this.onInvoiceService.uploadAndValidateFile(file, tenantId, user.id);
  }

  /**
   * Get total count of On-Invoice entries
   */
  @Get('count')
  @RequireCapability(CAPABILITIES.MODES_ONINVOICE_READ)
  @ApiOperation({ summary: 'Toplam On-Invoice entry sayısını getir' })
  async getCount(@TenantId() tenantId: string) {
    const count = await this.onInvoiceService.getCount(tenantId);
    return { count };
  }

  /**
   * Tüm On-Invoice entry'lerini listele (filtrelerle)
   * NOT: Bu endpoint GET /on-invoice/:batchId'den ÖNCE olmalı (route sırası önemli)
   */
  @Get('entries')
  @RequireCapability(CAPABILITIES.MODES_ONINVOICE_READ)
  @ApiOperation({ summary: "Tüm On-Invoice entry'lerini listele" })
  async getEntries(
    @TenantId() tenantId: string,
    @Query('batchId') batchId?: string,
    @Query('customerId') customerId?: string,
    @Query('skuId') skuId?: string,
    @Query('fiscalPeriod') fiscalPeriod?: string,
    @Query('discountType') discountType?: string,
    @Query('invoiceDateFrom') invoiceDateFrom?: string,
    @Query('invoiceDateTo') invoiceDateTo?: string,
    @Query('status') status?: string,
  ) {
    return this.onInvoiceService.getEntries(tenantId, {
      batchId,
      customerId,
      skuId,
      fiscalPeriod,
      discountType,
      invoiceDateFrom: invoiceDateFrom ? new Date(invoiceDateFrom) : undefined,
      invoiceDateTo: invoiceDateTo ? new Date(invoiceDateTo) : undefined,
      status,
    });
  }

  /**
   * Excel Template İndir
   * NOT: Bu endpoint GET /on-invoice/:batchId'den ÖNCE olmalı (route sırası önemli)
   */
  @Get('template/excel')
  @RequireCapability(CAPABILITIES.MODES_IMPORT_READ)
  @ApiOperation({ summary: 'Excel template indir' })
  async downloadExcelTemplate(@Res() res: Response) {
    const buffer = this.onInvoiceService.generateExcelTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=on-invoice-template.xlsx',
    );
    res.send(buffer);
  }

  /**
   * CSV Template İndir
   * NOT: Bu endpoint GET /on-invoice/:batchId'den ÖNCE olmalı (route sırası önemli)
   */
  @Get('template/csv')
  @RequireCapability(CAPABILITIES.MODES_IMPORT_READ)
  @ApiOperation({ summary: 'CSV template indir' })
  async downloadCSVTemplate(@Res() res: Response) {
    const csv = this.onInvoiceService.generateCSVTemplate();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=on-invoice-template.csv',
    );
    res.send(csv);
  }

  /**
   * Adım 2: Validasyon (Eğer upload'da yapılmadıysa)
   */
  @Post(':batchId/validate')
  @RequireCapability(CAPABILITIES.MODES_ACTUALS_WRITE)
  @ApiOperation({ summary: 'Adım 2: Batch validasyonu yap' })
  async validateBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.onInvoiceService.validateBatch(batchId, tenantId);
  }

  /**
   * Adım 3: Batch İşleme
   */
  @Post(':batchId/process')
  @RequireCapability(CAPABILITIES.MODES_ACTUALS_WRITE)
  @ApiOperation({ summary: 'Adım 3: Batch işle ve ledger entry oluştur' })
  async processBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.onInvoiceService.processBatch(batchId, tenantId, user.id);
  }

  /**
   * Batch Bilgisi
   */
  @Get('batch/:batchId')
  @RequireCapability(CAPABILITIES.MODES_ONINVOICE_READ)
  @ApiOperation({ summary: 'Batch bilgilerini getir' })
  async getBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.onInvoiceService.getBatch(batchId, tenantId);
  }
}

import {
  Controller,
  Get,
  Post,
  Param,
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
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';

@ApiTags('On-Invoice')
@ApiBearerAuth()
@Controller('on-invoice')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OnInvoiceController {
  constructor(private readonly onInvoiceService: OnInvoiceService) {}

  /**
   * Adım 1: Dosya Yükleme
   */
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
  @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.PLANNER, UserRole.READONLY)
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
  @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.PLANNER, UserRole.READONLY)
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
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
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
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
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
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Adım 2: Batch validasyonu yap' })
  async validateBatch(
    @Param('batchId') batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.onInvoiceService.validateBatch(batchId, tenantId);
  }

  /**
   * Adım 3: Batch İşleme
   */
  @Post(':batchId/process')
  @Roles(UserRole.ADMIN, UserRole.FINANCE)
  @ApiOperation({ summary: 'Adım 3: Batch işle ve ledger entry oluştur' })
  async processBatch(
    @Param('batchId') batchId: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.onInvoiceService.processBatch(batchId, tenantId, user.id);
  }

  /**
   * Batch Bilgisi
   */
  @Get('batch/:batchId')
  @Roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.PLANNER, UserRole.READONLY)
  @ApiOperation({ summary: 'Batch bilgilerini getir' })
  async getBatch(
    @Param('batchId') batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.onInvoiceService.getBatch(batchId, tenantId);
  }
}

import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SalesActualsService } from './sales-actuals.service';
import { UploadSalesActualsQueryDto } from './dto';
import { SalesActualSourceType } from '../../../../database/entities/sales-actual-batch.entity';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../../common/guards/capability.guard';
import { RequireCapability } from '../../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../../common/authorization/capabilities';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';

// `B3 W6` göçü (2026-08-26, `Z35`) — GERÇEKLEŞME yazımı (`MODES_ACTUALS_WRITE`,
// {ADMIN,FINANCE}: upload) `@Roles` → `@RequireCapability` göçürüldü.
// `ROLE_CAPABILITIES`'te hücre göç öncesi `WRITE_ROLES` (`@Roles(ADMIN,
// FINANCE)`) kümesiyle BİREBİR — davranış KORUNUYOR.
// `Z42 §4` (`B3b-1 W9`, 2026-08-26) — `batches`/`batches/:batchId`/
// `batches/:batchId/rows` `MODES_READ`'e göçürüldü (taban {A,CM,F,P,RO},
// 5/5, birebir).
// ⛔ `Z43 §4` (`B3` istisna-dalgası `Faz-B`, 2026-08-27) — `summary`
// `SUMMARY_READ`'e göçürüldü ({A,CM,F,RO}) — `−PLANNER` DAVRANIŞ
// DARALTMASI. Dayanak `Z42 §3` (iki bağımsız yarı: kayıtsız doğum `d40ca16`
// + `K-2.6.4`'ün planner cümlesi özet içermiyor); `Faz-A`'nın `§3`
// ölçümünde bu daraltma hükmü AYAKTA bulundu (`dashboard/summary` ve
// `stats/summary`'nin aksine — bkz. `Z43 §0/§1/§2`).
@ApiTags('Sales Actuals')
@ApiBearerAuth()
@Controller('actuals-first/sales-actuals')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class SalesActualsController {
  constructor(private readonly service: SalesActualsService) {}

  @Post('upload')
  @RequireCapability(CAPABILITIES.MODES_ACTUALS_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      'Gerçekleşen satış CSV dosyası yükle (CPL x Kategori x Kanal x Dönem tutar agregası)',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadSalesActualsQueryDto,
    @TenantId() tenantId: string,
    @CurrentUser() user: { id: string; email: string },
  ) {
    if (!file) {
      throw new BadRequestException('Dosya yüklenmedi');
    }

    return this.service.ingest(
      tenantId,
      { userId: user.id, userEmail: user.email },
      {
        fileName: file.originalname,
        fileBuffer: file.buffer,
        fiscalPeriodOverride: query.fiscalPeriod,
        sourceType: SalesActualSourceType.FILE_UPLOAD,
      },
    );
  }

  @Get('batches')
  @RequireCapability(CAPABILITIES.MODES_READ)
  @ApiOperation({ summary: 'Batch listesi (varsayılan: yalnızca ACTIVE)' })
  async getBatches(
    @TenantId() tenantId: string,
    @Query('fiscalPeriod') fiscalPeriod?: string,
    @Query('status') status?: string,
  ) {
    return this.service.getBatches(tenantId, { fiscalPeriod, status });
  }

  @Get('batches/:batchId/rows')
  @RequireCapability(CAPABILITIES.MODES_READ)
  @ApiOperation({ summary: 'Batch satırlarını getir' })
  async getBatchRows(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.service.getBatchRows(tenantId, batchId);
  }

  @Get('batches/:batchId')
  @RequireCapability(CAPABILITIES.MODES_READ)
  @ApiOperation({ summary: 'Batch detayını getir' })
  async getBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.service.getBatch(tenantId, batchId);
  }

  @Get('summary')
  @RequireCapability(CAPABILITIES.SUMMARY_READ)
  @ApiOperation({
    summary: 'ACTIVE batch satırları üzerinden gross/net/discount toplamı',
  })
  async getSummary(
    @TenantId() tenantId: string,
    @Query('fiscalPeriod') fiscalPeriod?: string,
    @Query('cplId') cplId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('channelId') channelId?: string,
  ) {
    return this.service.getSummary(tenantId, {
      fiscalPeriod,
      cplId,
      categoryId,
      channelId,
    });
  }
}

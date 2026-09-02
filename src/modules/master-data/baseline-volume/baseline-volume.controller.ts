import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
import { BaselineVolumeService } from './baseline-volume.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CapabilityGuard } from '../../../common/guards/capability.guard';
import { RequireCapability } from '../../../common/decorators/require-capability.decorator';
import { CAPABILITIES } from '../../../common/authorization/capabilities';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../common/decorators/tenant.decorator';

/**
 * `BL-2` (`docs/process/BL2_GIRIS_BRIEF.md`) — baseline hacim upload ucu.
 *
 * ⚠️ RBAC KARARI — TEYİT EDİLDİ (`F12` düzeltme turu, ürün sahibi hükmü,
 * 2026-09-02, `BL-2` kapanış paketi §2/§3): `BASELINE_WRITE` — {ADMIN,
 * FINANCE}. Önceki tur bu ucu `MASTER_DATA_WRITE`'a bağlamıştı; o hücre
 * KPI/mekanik/SKU/CPL/tactic/brand/channel/category/FU yazma uçlarını da
 * taşıdığı için FINANCE'ı hepsine açmış oldu ve 11 e2e kırıldı
 * (`master-data-capability-boundary.e2e-spec.ts` ·
 * `master-data-kpi-mechanic-capability-boundary.e2e-spec.ts`). Düzeltme:
 * bu uç YENİ ve DAR `BASELINE_WRITE` hücresine taşındı — GÖREV AYRILIĞI
 * gerekçesiyle {ADMIN,FINANCE}: baseline hacim (Excel "Master Data"
 * katmanı) planın ÖLÇÜLDÜĞÜ referanstır; PLANNER kendi referansını
 * yüklerse düşük-baseline → yüksek-uplift yapısal açığı doğar. PLANNER bu
 * hücrede YOK (yalnız `MASTER_DATA_READ` ile batch/rows okuyabilir).
 * Kanonik hüküm: `scripts/analysis/route-cell-map.py`
 * KARAR_HUKMU['BASELINE_WRITE'].
 */
@ApiTags('Baseline Volume')
@ApiBearerAuth()
@Controller('master-data/baseline-volumes')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class BaselineVolumeController {
  constructor(private readonly service: BaselineVolumeService) {}

  @Post('upload')
  @RequireCapability(CAPABILITIES.BASELINE_WRITE)
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
      'Baseline hacim (SKU × CPL × period) CSV/Excel dosyası yükle — Base Volume Master Data',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File,
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
        contentType: file.mimetype,
      },
    );
  }

  @Get('batches/:batchId')
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @ApiOperation({ summary: 'Batch detayı + kabul/red sayıları' })
  async getBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.service.getBatch(tenantId, batchId);
  }

  @Get('batches/:batchId/rows')
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @ApiOperation({ summary: 'Batch satırları (ACCEPTED + REJECTED)' })
  async getBatchRows(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.service.getBatchRows(tenantId, batchId);
  }
}

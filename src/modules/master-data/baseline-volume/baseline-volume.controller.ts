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
import { BaselineVolumeService } from './baseline-volume.service';
import { BaselineVolumeCoverageService } from './services/baseline-volume-coverage.service';
import {
  ImportBatchRowReason,
  ImportBatchRowStatus,
} from '../../../database/entities/baseline-volume-import-batch-row.entity';
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
  constructor(
    private readonly service: BaselineVolumeService,
    private readonly coverageService: BaselineVolumeCoverageService,
  ) {}

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

  /**
   * `BL-4` (`docs/process/BL4_YUZEY_BRIEF.md §3`) — coverage KAPI DEĞİL,
   * KARAR DESTEĞİDİR (`Z90`, ürün sahibi): `RED`/`UNMEASURABLE` hiçbir yolu
   * BLOKLAMAZ, yalnız *"uplift/ROI %X'lik evren için anlamlı"* der. Üç
   * değer (`GREEN`/`RED`/`UNMEASURABLE`) OLDUĞU GİBİ yüzeye çıkar —
   * istemci `UNMEASURABLE`'ı `%0` ya da "yeşil" diye OKUYAMAZ.
   */
  @Get('coverage')
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @ApiOperation({
    summary:
      'Baseline kapsam ORANI (katalog × CPL × dönem) — KAPI DEĞİL, karar desteği (Z90)',
  })
  async getCoverage(@TenantId() tenantId: string) {
    return this.coverageService.computeCoverageGate(tenantId);
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

  /**
   * `BL-4 §4` — teşhis ekranı: `batch → satırlar → NEDEN`. Filtreler
   * (`reason`/`status`/`rowNo`) OPSİYONEL, hepsi AND'lenir. Tanınmayan bir
   * `reason`/`status` değeri SESSİZCE yok sayılmaz — `400` (§2.5, gizli
   * tie-break/varsayılan yasağı).
   */
  @Get('batches/:batchId/rows')
  @RequireCapability(CAPABILITIES.MASTER_DATA_READ)
  @ApiOperation({
    summary:
      'Batch satırları (ACCEPTED + REJECTED + anahtarı çözülemeyenler) — düzeltme cümlesiyle',
  })
  async getBatchRows(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
    @Query('reason') reasonParam?: string,
    @Query('status') statusParam?: string,
    @Query('rowNo') rowNoParam?: string,
  ) {
    let reason: ImportBatchRowReason | undefined;
    if (reasonParam !== undefined) {
      // `in` PROTOTİP ZİNCİRİNİ tarar: 'toString'/'constructor'/'__proto__'
      // doğrulamayı GEÇER ve `where`'e bir Function sızdırırdı (ölçüldü, Z92).
      // Object.values ⇒ yalnız GERÇEK üyeler.
      if (
        !(Object.values(ImportBatchRowReason) as string[]).includes(reasonParam)
      ) {
        throw new BadRequestException(
          `Tanınmayan reason: '${reasonParam}'. Geçerli değerler: ${Object.values(ImportBatchRowReason).join(', ')}.`,
        );
      }
      reason = reasonParam as ImportBatchRowReason;
    }

    let status: ImportBatchRowStatus | undefined;
    if (statusParam !== undefined) {
      if (
        !(Object.values(ImportBatchRowStatus) as string[]).includes(statusParam)
      ) {
        throw new BadRequestException(
          `Tanınmayan status: '${statusParam}'. Geçerli değerler: ${Object.values(ImportBatchRowStatus).join(', ')}.`,
        );
      }
      status = statusParam as ImportBatchRowStatus;
    }

    let rowNo: number | undefined;
    if (rowNoParam !== undefined) {
      const parsed = Number(rowNoParam);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new BadRequestException(
          `Tanınmayan rowNo: '${rowNoParam}' — pozitif tamsayı olmalı.`,
        );
      }
      rowNo = parsed;
    }

    return this.service.getBatchRows(tenantId, batchId, {
      reason,
      status,
      rowNo,
    });
  }
}

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
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantId } from '../../../../common/decorators/tenant.decorator';
import { UserRole } from '../../../../database/entities/user.entity';

const WRITE_ROLES = [UserRole.ADMIN, UserRole.FINANCE];

const READ_ROLES = [
  ...WRITE_ROLES,
  UserRole.PLANNER,
  UserRole.CATEGORY_MANAGER,
  UserRole.READONLY,
];

@ApiTags('Sales Actuals')
@ApiBearerAuth()
@Controller('actuals-first/sales-actuals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesActualsController {
  constructor(private readonly service: SalesActualsService) {}

  @Post('upload')
  @Roles(...WRITE_ROLES)
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
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Batch listesi (varsayılan: yalnızca ACTIVE)' })
  async getBatches(
    @TenantId() tenantId: string,
    @Query('fiscalPeriod') fiscalPeriod?: string,
    @Query('status') status?: string,
  ) {
    return this.service.getBatches(tenantId, { fiscalPeriod, status });
  }

  @Get('batches/:batchId/rows')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Batch satırlarını getir' })
  async getBatchRows(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.service.getBatchRows(tenantId, batchId);
  }

  @Get('batches/:batchId')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Batch detayını getir' })
  async getBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @TenantId() tenantId: string,
  ) {
    return this.service.getBatch(tenantId, batchId);
  }

  @Get('summary')
  @Roles(...READ_ROLES)
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

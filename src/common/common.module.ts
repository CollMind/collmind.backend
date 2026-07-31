import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditService } from './services/admin-audit.service';
import { CsvParserService } from './services/csv-parser.service';
import { RecalcTelemetryContext } from './services/recalc-telemetry.service';
import { RecalcMetricsInterceptor } from './interceptors/recalc-metrics.interceptor';
import { AdminAuditLog } from '../database/entities/admin-audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAuditLog])],
  providers: [
    AdminAuditService,
    CsvParserService,
    RecalcTelemetryContext,
    RecalcMetricsInterceptor,
  ],
  exports: [
    AdminAuditService,
    CsvParserService,
    RecalcTelemetryContext,
    RecalcMetricsInterceptor,
  ],
})
export class CommonModule {}

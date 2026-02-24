import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kpi } from '../../../database/entities/kpi.entity';
import { KpiController } from './kpi.controller';
import { KpiService } from './kpi.service';
import { KpiRepository } from './kpi.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Kpi])],
  controllers: [KpiController],
  providers: [KpiService, KpiRepository],
  exports: [KpiService, KpiRepository],
})
export class KpiModule {}

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kpi } from '../../../database/entities/kpi.entity';
import { KpiController } from './kpi.controller';
import { KpiService } from './kpi.service';
import { KpiRepository } from './kpi.repository';
import { PlanModule } from '../../modes/planning-first/plan/plan.module';
import { KpiEngineModule } from '../../shared/kpi-engine/kpi-engine.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Kpi]),
    forwardRef(() => PlanModule),
    KpiEngineModule,
  ],
  controllers: [KpiController],
  providers: [KpiService, KpiRepository],
  exports: [KpiService, KpiRepository],
})
export class KpiModule {}

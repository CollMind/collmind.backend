import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kpi } from '../../../database/entities/kpi.entity';
import { KpiController } from './kpi.controller';
import { KpiService } from './kpi.service';
import { KpiRepository } from './kpi.repository';
import { PlanModule } from '../../modes/planning-first/plan/plan.module';

@Module({
  imports: [TypeOrmModule.forFeature([Kpi]), forwardRef(() => PlanModule)],
  controllers: [KpiController],
  providers: [KpiService, KpiRepository],
  exports: [KpiService, KpiRepository],
})
export class KpiModule {}

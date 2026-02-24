import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Kpi } from '../../../database/entities/kpi.entity';
import { FormulaParserService } from './formula-parser.service';
import { KpiEngineService } from './kpi-engine.service';

@Module({
  imports: [TypeOrmModule.forFeature([Kpi])],
  providers: [FormulaParserService, KpiEngineService],
  exports: [FormulaParserService, KpiEngineService],
})
export class KpiEngineModule {}

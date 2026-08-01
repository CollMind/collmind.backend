import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { CustomerModule } from '../customer/customer.module';
import { PlanModule } from '../modes/planning-first/plan/plan.module';
import { KpiEngineModule } from '../shared/kpi-engine/kpi-engine.module';
import {
  Brand,
  Category,
  Channel,
  Cpl,
  ForecastingUnit,
  GenericUnit,
  Kpi,
  Mechanic,
  Region,
  Sku,
  Tactic,
} from '../../database/entities';

// Controllers
import { BrandController } from './brand/brand.controller';
import { CategoryController } from './category/category.controller';
import { ChannelController } from './channel/channel.controller';
import { CplController } from './cpl/cpl.controller';
import { FuController } from './forecasting-unit/fu.controller';
import { GuController } from './generic-unit/gu.controller';
import { KpiController } from './kpi/kpi.controller';
import { MechanicController } from './mechanic/mechanic.controller';
import { RegionController } from './region/region.controller';
import { SkuController } from './sku/sku.controller';
import { TacticController } from './tactic/tactic.controller';

// Services
import { BrandService } from './brand/brand.service';
import { CategoryService } from './category/category.service';
import { ChannelService } from './channel/channel.service';
import { CplService } from './cpl/cpl.service';
import { FuService } from './forecasting-unit/fu.service';
import { GuService } from './generic-unit/gu.service';
import { KpiService } from './kpi/kpi.service';
import { MechanicService } from './mechanic/mechanic.service';
import { RegionService } from './region/region.service';
import { SkuService } from './sku/sku.service';
import { TacticService } from './tactic/tactic.service';

// Repositories
import { BrandRepository } from './brand/brand.repository';
import { CategoryRepository } from './category/category.repository';
import { ChannelRepository } from './channel/channel.repository';
import { CplRepository } from './cpl/cpl.repository';
import { FuRepository } from './forecasting-unit/fu.repository';
import { GuRepository } from './generic-unit/gu.repository';
import { KpiRepository } from './kpi/kpi.repository';
import { MechanicRepository } from './mechanic/mechanic.repository';
import { RegionRepository } from './region/region.repository';
import { SkuRepository } from './sku/sku.repository';
import { TacticRepository } from './tactic/tactic.repository';

@Module({
  imports: [
    CommonModule,
    CustomerModule,
    forwardRef(() => PlanModule),
    KpiEngineModule,
    TypeOrmModule.forFeature([
      Brand,
      Category,
      Channel,
      Cpl,
      ForecastingUnit,
      GenericUnit,
      Kpi,
      Mechanic,
      Region,
      Sku,
      Tactic,
    ]),
  ],
  controllers: [
    BrandController,
    CategoryController,
    ChannelController,
    CplController,
    FuController,
    GuController,
    KpiController,
    MechanicController,
    RegionController,
    SkuController,
    TacticController,
  ],
  providers: [
    BrandService,
    BrandRepository,
    CategoryService,
    CategoryRepository,
    ChannelService,
    ChannelRepository,
    CplService,
    CplRepository,
    FuService,
    FuRepository,
    GuService,
    GuRepository,
    KpiService,
    KpiRepository,
    MechanicService,
    MechanicRepository,
    RegionService,
    RegionRepository,
    SkuService,
    SkuRepository,
    TacticService,
    TacticRepository,
  ],
  exports: [
    BrandService,
    CategoryService,
    ChannelService,
    CplService,
    FuService,
    GuService,
    KpiService,
    MechanicService,
    RegionService,
    SkuService,
    TacticService,
  ],
})
export class MasterDataModule {}

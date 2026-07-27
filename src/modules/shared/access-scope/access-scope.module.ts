import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserScope } from '../../../database/entities/user-scope.entity';
import { AccessScopeService } from './access-scope.service';

/**
 * T-028b — shared AccessScopeService module. Tek çıkış noktası: pair-semantik
 * scope çözümü (bkz. access-scope.service.ts header). Plan modülü (CM
 * kategori-scoped onay) bu modülü import eder; dashboard/settlement de
 * T-028d'de buna refactor edilecek.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserScope])],
  providers: [AccessScopeService],
  exports: [AccessScopeService],
})
export class AccessScopeModule {}

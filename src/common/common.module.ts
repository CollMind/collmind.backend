import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditService } from './services/admin-audit.service';
import { AdminAuditLog } from '../database/entities/admin-audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAuditLog])],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class CommonModule {}



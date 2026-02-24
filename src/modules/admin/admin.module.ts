import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AdminAuditController } from './admin-audit.controller';

@Module({
  imports: [CommonModule],
  controllers: [AdminAuditController],
})
export class AdminModule {}

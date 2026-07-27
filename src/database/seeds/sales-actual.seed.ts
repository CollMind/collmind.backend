/**
 * Sales Actuals Seed — T-020
 *
 * Wella actuals CSV fixture'larını (src/database/seeds/data/actuals_*.csv)
 * `SalesActualsService.ingest()` üzerinden yükler — controller'ın kullandığı
 * TEK kod yolu (design §5). Nest DI olmadan, diğer seed script'leriyle aynı
 * pattern: sınıflar `new` ile TypeORM repository'leri üzerine manuel kurulur.
 *
 * Idempotent: aynı dosya tekrar seed edilirse SalesActualsService.ingest()
 * içindeki fileHash karşılaştırması IDEMPOTENT_DUPLICATE döner (no-op).
 */
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { SalesActualsService } from '../../modules/modes/actuals-first/sales-actuals/sales-actuals.service';
import { SalesActualsRepository } from '../../modules/modes/actuals-first/sales-actuals/sales-actuals.repository';
import { SalesActualsLookupService } from '../../modules/modes/actuals-first/sales-actuals/services/sales-actuals-lookup.service';
import { SalesActualsValidationService } from '../../modules/modes/actuals-first/sales-actuals/services/sales-actuals-validation.service';
import { CsvParserService } from '../../common/services/csv-parser.service';
import { AdminAuditService } from '../../common/services/admin-audit.service';
import { SalesActualSourceType } from '../entities/sales-actual-batch.entity';
import { SalesActual } from '../entities/sales-actual.entity';
import { SalesActualBatch } from '../entities/sales-actual-batch.entity';
import { AdminAuditLog } from '../entities/admin-audit-log.entity';
import { Cpl } from '../entities/cpl.entity';
import { Category } from '../entities/category.entity';
import { Channel } from '../entities/channel.entity';
import { Customer } from '../../database/entities/customer.entity';
import { CplService } from '../../modules/master-data/cpl/cpl.service';
import { CplRepository } from '../../modules/master-data/cpl/cpl.repository';
import { CategoryService } from '../../modules/master-data/category/category.service';
import { CategoryRepository } from '../../modules/master-data/category/category.repository';
import { ChannelService } from '../../modules/master-data/channel/channel.service';
import { ChannelRepository } from '../../modules/master-data/channel/channel.repository';
import { CustomerRepository } from '../../modules/customer/customer.repository';

const FIXTURE_FILES = ['actuals_2026-01.csv', 'actuals_2026-02.csv'];

export async function seedSalesActuals(
  dataSource: DataSource,
  tenantId: string,
  adminUserId: string,
  adminUserEmail: string,
): Promise<void> {
  const adminAuditService = new AdminAuditService(
    dataSource.getRepository(AdminAuditLog),
  );

  const cplService = new CplService(
    new CplRepository(dataSource.getRepository(Cpl)),
    new ChannelRepository(dataSource.getRepository(Channel)),
    new CustomerRepository(dataSource.getRepository(Customer)),
  );
  const categoryService = new CategoryService(
    new CategoryRepository(dataSource.getRepository(Category)),
  );
  const channelService = new ChannelService(
    new ChannelRepository(dataSource.getRepository(Channel)),
    adminAuditService,
  );

  const lookupService = new SalesActualsLookupService(
    cplService,
    categoryService,
    channelService,
  );
  const validationService = new SalesActualsValidationService();
  const csvParserService = new CsvParserService();
  const repository = new SalesActualsRepository(
    dataSource.getRepository(SalesActualBatch),
    dataSource.getRepository(SalesActual),
  );

  const service = new SalesActualsService(
    dataSource,
    csvParserService,
    lookupService,
    validationService,
    repository,
    adminAuditService,
  );

  for (const fileName of FIXTURE_FILES) {
    const filePath = path.join(__dirname, 'data', fileName);
    if (!fs.existsSync(filePath)) {
      console.warn(
        `   [SALES ACTUALS SEED] Fixture bulunamadı: ${filePath} — atlanıyor`,
      );
      continue;
    }
    const fileBuffer = fs.readFileSync(filePath);

    try {
      const result = await service.ingest(
        tenantId,
        { userId: adminUserId, userEmail: adminUserEmail },
        {
          fileName,
          fileBuffer,
          sourceType: SalesActualSourceType.SEED,
        },
      );
      console.log(
        `   [SALES ACTUALS SEED] ${fileName}: ${result.validRows}/${result.totalRows} satır geçerli, ` +
          `${result.batches.length} batch (${result.batches.map((b) => b.status).join(', ')})`,
      );
    } catch (error) {
      console.error(`   [SALES ACTUALS SEED] ${fileName} yüklenemedi:`, error);
      throw error;
    }
  }
}

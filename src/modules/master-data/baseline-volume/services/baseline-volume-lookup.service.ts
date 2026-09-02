import { Injectable } from '@nestjs/common';
import { SkuService } from '../../sku/sku.service';
import { CplService } from '../../cpl/cpl.service';
import { Sku } from '../../../../database/entities/sku.entity';
import { Cpl } from '../../../../database/entities/cpl.entity';

export interface BaselineVolumeMasterDataIndex {
  skuByCode: Map<string, Sku>;
  cplByCode: Map<string, Cpl>;
}

/**
 * `BL-2` — SKU/CPL kod → varlık indeksi. `SalesActualsLookupService`'in aynı
 * deseni (bulk `findAll`, N+1 yok — `docs/analysis/0002-actuals-port-design.md
 * §5`).
 *
 * ⛔ SINIR: bu servis yalnız KOD → VARLIK eşlemesi kurar (tam eşleşme).
 * "SKU eşleme" (bulanık eşleşme, iş kuralı) `BL-3`'ün işidir
 * (`BL2_GIRIS_BRIEF.md §0`: "BL-2 bir DOĞRULAMA adımı değildir"). `findAll`
 * `activeOnly=false` çağrılır — pasif bir SKU/CPL'e referans veren bir satır
 * BL-2'de REDDEDİLMEZ (o karar `D4`'ün katalog paydası tarafında yaşar, `Z85
 * §3` PİN 2 — pasif SKU/CPL paydaya GİRMEZ, ama bu bir satırın import'ta
 * reddedilme sebebi değildir; iki ayrı soru).
 */
@Injectable()
export class BaselineVolumeLookupService {
  constructor(
    private readonly skuService: SkuService,
    private readonly cplService: CplService,
  ) {}

  async buildIndex(tenantId: string): Promise<BaselineVolumeMasterDataIndex> {
    const [skus, cpls] = await Promise.all([
      this.skuService.findAll(tenantId, false),
      this.cplService.findAll(tenantId, false),
    ]);

    const skuByCode = new Map<string, Sku>();
    for (const sku of skus) {
      skuByCode.set(sku.code, sku);
    }

    const cplByCode = new Map<string, Cpl>();
    for (const cpl of cpls) {
      cplByCode.set(cpl.code, cpl);
    }

    return { skuByCode, cplByCode };
  }
}

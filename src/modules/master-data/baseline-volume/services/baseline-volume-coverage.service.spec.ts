import { Repository } from 'typeorm';
import {
  BaselineVolumeCoverageService,
  CoverageGateOutcome,
} from './baseline-volume-coverage.service';
import { Sku } from '../../../../database/entities/sku.entity';
import { Cpl } from '../../../../database/entities/cpl.entity';
import { BaselineVolume } from '../../../../database/entities/baseline-volume.entity';

interface MockCountRepository {
  count: jest.Mock;
}

const TENANT_ID = 'tenant-001';

/**
 * `BL-3` `ADIM 2` (`docs/process/BL3_DOGRULAMA_BRIEF.md §B`) — `D4` `≥%95`
 * kapsam kapısı, ÜÇ ÇIKTI:
 *   1. `UNMEASURABLE` — katalog evreni (aktif SKU × aktif CPL × 12) SIFIR.
 *      `0/0` bir oran DEĞİLDİR (brief §B, ZORUNLU).
 *   2. `RED`   — evren > 0, coverageRatio < 0.95.
 *   3. `GREEN` — evren > 0, coverageRatio >= 0.95 (`>=` — F12 kanonik
 *      semantiği, `budget-threshold.service.ts:228-230`).
 *
 * Sınır: `%94.9 → RED`, `%95.0 → GEÇER` (brief `§5` PİN 2 / `§F`).
 */
describe('BaselineVolumeCoverageService.computeCoverageGate', () => {
  let skuRepo: MockCountRepository;
  let cplRepo: MockCountRepository;
  let baselineVolumeRepo: MockCountRepository;
  let service: BaselineVolumeCoverageService;

  beforeEach(() => {
    skuRepo = { count: jest.fn() };
    cplRepo = { count: jest.fn() };
    baselineVolumeRepo = { count: jest.fn() };
    service = new BaselineVolumeCoverageService(
      skuRepo as unknown as Repository<Sku>,
      cplRepo as unknown as Repository<Cpl>,
      baselineVolumeRepo as unknown as Repository<BaselineVolume>,
    );
  });

  it('tenantId eksikse AÇIK HATA fırlatır (sessiz sıfır yasağı, §2.5)', async () => {
    await expect(service.computeCoverageGate('')).rejects.toThrow(
      /tenantId zorunludur/,
    );
  });

  it('katalog evreni SIFIRSA (aktif SKU=0) UNMEASURABLE döner — 0/0 bir oran DEĞİLDİR', async () => {
    skuRepo.count.mockResolvedValue(0);
    cplRepo.count.mockResolvedValue(5);
    baselineVolumeRepo.count.mockResolvedValue(0);

    const result = await service.computeCoverageGate(TENANT_ID);

    expect(result.outcome).toBe(CoverageGateOutcome.UNMEASURABLE);
    expect(result.coverageRatio).toBeNull();
    expect(result.catalogUniverse).toBe(0);
  });

  it('katalog evreni SIFIRSA (aktif CPL=0) UNMEASURABLE döner', async () => {
    skuRepo.count.mockResolvedValue(10);
    cplRepo.count.mockResolvedValue(0);
    baselineVolumeRepo.count.mockResolvedValue(0);

    const result = await service.computeCoverageGate(TENANT_ID);

    expect(result.outcome).toBe(CoverageGateOutcome.UNMEASURABLE);
    expect(result.coverageRatio).toBeNull();
  });

  it('her ikisi de SIFIRSA (plans=0 penceresi) da UNMEASURABLE döner — "temiz" DEĞİL', async () => {
    skuRepo.count.mockResolvedValue(0);
    cplRepo.count.mockResolvedValue(0);
    baselineVolumeRepo.count.mockResolvedValue(0);

    const result = await service.computeCoverageGate(TENANT_ID);

    expect(result.outcome).toBe(CoverageGateOutcome.UNMEASURABLE);
    expect(result.activeSkuCount).toBe(0);
    expect(result.activeCplCount).toBe(0);
  });

  it('SINIR: %94.9 → RED (< 0.95)', async () => {
    // evren = 1 sku * 1 cpl * 12 = 12; 949/1000 oranını 12 payda ile taklit
    // etmek yerine payda/pay'ı doğrudan oranı üretecek şekilde kur:
    // acceptedCount / catalogUniverse = 0.949 elde etmek için 1000 evren, 949 kabul.
    skuRepo.count.mockResolvedValue(1000);
    cplRepo.count.mockResolvedValue(1);
    // periodCount sabit 12 -> evren = 1000*1*12 = 12000; 949 orani icin
    // acceptedCount = 0.949 * 12000 = 11388
    baselineVolumeRepo.count.mockResolvedValue(11388);

    const result = await service.computeCoverageGate(TENANT_ID);

    expect(result.catalogUniverse).toBe(12000);
    expect(result.coverageRatio).toBeCloseTo(0.949, 5);
    expect(result.outcome).toBe(CoverageGateOutcome.RED);
  });

  it('SINIR: %95.0 → GEÇER (GREEN, >= semantiği)', async () => {
    skuRepo.count.mockResolvedValue(1000);
    cplRepo.count.mockResolvedValue(1);
    // evren = 12000; %95.0 icin acceptedCount = 0.95 * 12000 = 11400
    baselineVolumeRepo.count.mockResolvedValue(11400);

    const result = await service.computeCoverageGate(TENANT_ID);

    expect(result.catalogUniverse).toBe(12000);
    expect(result.coverageRatio).toBeCloseTo(0.95, 5);
    expect(result.outcome).toBe(CoverageGateOutcome.GREEN);
  });

  it('dolu katalog + tam kapsama (coverageRatio=1) → GREEN', async () => {
    skuRepo.count.mockResolvedValue(2);
    cplRepo.count.mockResolvedValue(3);
    baselineVolumeRepo.count.mockResolvedValue(2 * 3 * 12);

    const result = await service.computeCoverageGate(TENANT_ID);

    expect(result.outcome).toBe(CoverageGateOutcome.GREEN);
    expect(result.coverageRatio).toBe(1);
  });

  it('pasif SKU/CPL sayıma dahil edilmez — repository çağrısı isActive/status filtresiyle yapılır', async () => {
    skuRepo.count.mockResolvedValue(1);
    cplRepo.count.mockResolvedValue(1);
    baselineVolumeRepo.count.mockResolvedValue(0);

    await service.computeCoverageGate(TENANT_ID);

    expect(skuRepo.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, isActive: true },
    });
    expect(cplRepo.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, status: 'ACTIVE' },
    });
  });

  it('reddedilen satır paya girmez — yalnız ACCEPTED sayılır (repository çağrısı acceptanceStatus filtresiyle)', async () => {
    skuRepo.count.mockResolvedValue(1);
    cplRepo.count.mockResolvedValue(1);
    baselineVolumeRepo.count.mockResolvedValue(0);

    await service.computeCoverageGate(TENANT_ID);

    expect(baselineVolumeRepo.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, acceptanceStatus: 'ACCEPTED' },
    });
  });
});

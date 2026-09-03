import { NotFoundException } from '@nestjs/common';
import { BaselineVolumeService } from './baseline-volume.service';
import { BASELINE_VOLUME_REMEDIATION } from './services/baseline-volume-remediation';
import {
  ImportBatchRowReason,
  ImportBatchRowStatus,
} from '../../../database/entities/baseline-volume-import-batch-row.entity';

/**
 * `BL-4` K2/K4/K6 — `getBatch`/`getBatchRows` WIRING, DB'siz.
 *
 * ⛔ Bu dosya bilinçli olarak `baseline-volume.service.spec.ts`'İ DEĞİL, ayrı
 * bir dosyayı genişletir (`CLAUDE.md` §3: "bir ajan kendi yazdığı kodun
 * testini yazmaz" — o dosya BAŞKA bir ajanın şeridinde, `DOKUNMA` listesinde).
 * Üretim dosyası (`baseline-volume.service.ts`) da DEĞİŞTİRİLMEDİ — yalnız
 * OKUNDU, ENJEKTE edilen `repository` MOCKLANDI.
 *
 * ~~`test/baseline-volume-diagnostics-surface.e2e-spec.ts`'in K2/K3/K5/K6
 * iddiaları BUGÜN bir ALTYAPI kusuru yüzünden CANLI DB'de KOŞAMIYOR
 * (`app_runtime`'ın `baseline_volume_import_batch_rows` üzerinde HİÇBİR
 * GRANT'ı yok — bkz. o dosyanın `beforeAll` yorumu).~~ ✅ **`BL-4` kapanış
 * turu (2026-09-03) — GRANT uygulandı** (`npm run db:roles:grants`, ürün
 * sahibi onayı; kanıt: `docs/verification/GRANT_UZLASTIRMA_2026-09-03.md`,
 * tablo düzeyi 530→532, kolon 6966→6994, kaybolan 0). `F12` deseni: eski
 * cümle SİLİNMEDİ (o anın gerçek teşhisiydi), üstü çizili — artık YÜRÜRLÜKTE
 * DEĞİL, e2e dosyası bugün CANLI DB'de KOŞUYOR (19/19, iki ardışık koşum).
 * Bu suite AYNI mantığı DB'siz doğrular — ikisi ÇAKIŞMAZ (biri wiring/
 * mantık, biri gerçek DB/HTTP), ikisi de TAMAMLAYICI kanıt olarak kalır.
 */
describe('BaselineVolumeService.getBatch / getBatchRows — wiring (DB’siz)', () => {
  const TENANT_ID = 'tenant-wiring-001';
  const BATCH_ID = 'batch-wiring-001';

  function buildService(repositoryOverrides: Record<string, jest.Mock>) {
    const repository = {
      findBatchById: jest.fn(),
      countByAcceptance: jest.fn(),
      computeSourceMatchRatio: jest.fn(),
      findImportBatchRows: jest.fn(),
      ...repositoryOverrides,
    };
    const service = new BaselineVolumeService(
      {} as never, // dataSource — getBatch/getBatchRows kullanmıyor
      {} as never, // fileParser
      {} as never, // lookupService
      repository as never,
      {} as never, // adminAuditService
    );
    return { service, repository };
  }

  it('getBatch: batch bulunamazsa NotFoundException — repository’ye HİÇ inmeden', async () => {
    const { service, repository } = buildService({
      findBatchById: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getBatch(TENANT_ID, BATCH_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.countByAcceptance).not.toHaveBeenCalled();
    expect(repository.computeSourceMatchRatio).not.toHaveBeenCalled();
  });

  it('getBatch: sourceMatch OLDUĞU GİBİ eklenir, coverageRatio EKLENMEZ (§5a)', async () => {
    const { service } = buildService({
      findBatchById: jest.fn().mockResolvedValue({ id: BATCH_ID }),
      countByAcceptance: jest.fn().mockResolvedValue({
        [ImportBatchRowStatus.ACCEPTED]: 0,
        [ImportBatchRowStatus.REJECTED]: 4,
      }),
      computeSourceMatchRatio: jest.fn().mockResolvedValue({
        matchedCount: 0,
        totalCount: 4,
        sourceMatchRatio: 0,
      }),
    });

    const result = await service.getBatch(TENANT_ID, BATCH_ID);

    expect(result.sourceMatch).toEqual({
      matchedCount: 0,
      totalCount: 4,
      sourceMatchRatio: 0,
    });
    expect(result).not.toHaveProperty('coverageRatio');
  });

  it('getBatchRows: 404 önce kontrol edilir — findBatchById çağrılmadan findImportBatchRows ÇAĞRILMAZ', async () => {
    const { service, repository } = buildService({
      findBatchById: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getBatchRows(TENANT_ID, BATCH_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.findImportBatchRows).not.toHaveBeenCalled();
  });

  it('K6 — HER REJECTED satır BASELINE_VOLUME_REMEDIATION’dan KENDİ cümlesini alır (yedi kod, hepsi ayrı)', async () => {
    const allReasons = Object.values(ImportBatchRowReason);
    const rows = allReasons.map((reason, i) => ({
      rowNo: i + 1,
      status: ImportBatchRowStatus.REJECTED,
      reason,
      resolvedSkuId: null,
      resolvedCplId: null,
      raw: { sku_code: `SKU-${i}` },
    }));

    const { service } = buildService({
      findBatchById: jest.fn().mockResolvedValue({ id: BATCH_ID }),
      findImportBatchRows: jest.fn().mockResolvedValue(rows),
    });

    const result = await service.getBatchRows(TENANT_ID, BATCH_ID);

    expect(result).toHaveLength(7);
    for (const row of result) {
      expect(row.remediation).toBe(
        BASELINE_VOLUME_REMEDIATION[row.reason as ImportBatchRowReason],
      );
      expect(row.remediation).not.toBeNull();
    }
    // NEGATIVE_VOLUME ≠ INVALID_VOLUME_FORMAT — ekranda da AYRIŞIYOR (Z87 §F12)
    const negative = result.find(
      (r) => r.reason === ImportBatchRowReason.NEGATIVE_VOLUME,
    )!;
    const invalidFormat = result.find(
      (r) => r.reason === ImportBatchRowReason.INVALID_VOLUME_FORMAT,
    )!;
    expect(negative.remediation).not.toBe(invalidFormat.remediation);
  });

  it('ACCEPTED satır remediation: null taşır (yalnız REJECTED’de dolu)', async () => {
    const { service } = buildService({
      findBatchById: jest.fn().mockResolvedValue({ id: BATCH_ID }),
      findImportBatchRows: jest.fn().mockResolvedValue([
        {
          rowNo: 1,
          status: ImportBatchRowStatus.ACCEPTED,
          reason: undefined,
          resolvedSkuId: 'sku-1',
          resolvedCplId: 'cpl-1',
          raw: {},
        },
      ]),
    });

    const result = await service.getBatchRows(TENANT_ID, BATCH_ID);

    expect(result[0].remediation).toBeNull();
    expect(result[0].reason).toBeNull();
  });

  it('filtre parametreleri (reason/status/rowNo) repository’ye OLDUĞU GİBİ geçer', async () => {
    const { service, repository } = buildService({
      findBatchById: jest.fn().mockResolvedValue({ id: BATCH_ID }),
      findImportBatchRows: jest.fn().mockResolvedValue([]),
    });

    await service.getBatchRows(TENANT_ID, BATCH_ID, {
      reason: ImportBatchRowReason.CPL_NOT_FOUND,
      status: ImportBatchRowStatus.REJECTED,
      rowNo: 9,
    });

    expect(repository.findImportBatchRows).toHaveBeenCalledWith(
      TENANT_ID,
      BATCH_ID,
      {
        reason: ImportBatchRowReason.CPL_NOT_FOUND,
        status: ImportBatchRowStatus.REJECTED,
        rowNo: 9,
      },
    );
  });
});

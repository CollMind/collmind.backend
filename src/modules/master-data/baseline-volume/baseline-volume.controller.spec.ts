import { BadRequestException } from '@nestjs/common';
import { BaselineVolumeController } from './baseline-volume.controller';
import { BaselineVolumeService } from './baseline-volume.service';
import {
  BaselineVolumeCoverageService,
  CoverageGateOutcome,
  CoverageGateResult,
} from './services/baseline-volume-coverage.service';
import {
  ImportBatchRowReason,
  ImportBatchRowStatus,
} from '../../../database/entities/baseline-volume-import-batch-row.entity';

/**
 * `BL-4` (`docs/process/BL4_YUZEY_BRIEF.md`) — YÜZEY testsiz push edilmişti
 * (`code-reviewer` bulgusu: `grep -rn "baseline-volumes" test/` → 0 eşleşme).
 * Bu dosya CONTROLLER'ın kendi mantığını (servis çağrısına GEÇİRDİĞİ /
 * ÜRETTİĞİ şey) DB'ye dokunmadan sınar — RBAC/DB entegrasyonu `test/`
 * altındaki e2e dosyalarının işi.
 *
 * K1 — coverage: controller `computeCoverageGate`'in üç çıktısını da
 *      DEĞİŞTİRMEDEN taşıyor mu (`AYNI SUITE'te üç dal ayrışıyor`).
 * K3 — `?reason=`/`?status=` doğrulaması: `Object.values(...).includes(...)`
 *      — `in` operatörünün prototip-zinciri sızıntısını KAPATTIĞI iddiası,
 *      `toString`/`constructor`/`__proto__`/`hasOwnProperty` ile.
 * K4 — rowNo doğrulaması: pozitif tamsayı olmayan girdi `400`.
 */
describe('BaselineVolumeController', () => {
  let controller: BaselineVolumeController;
  let service: {
    getBatch: jest.Mock;
    getBatchRows: jest.Mock;
    ingest: jest.Mock;
  };
  let coverageService: { computeCoverageGate: jest.Mock };

  const TENANT_ID = 'tenant-ctrl-001';
  const BATCH_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    service = {
      getBatch: jest.fn(),
      getBatchRows: jest.fn(),
      ingest: jest.fn(),
    };
    coverageService = { computeCoverageGate: jest.fn() };
    controller = new BaselineVolumeController(
      service as unknown as BaselineVolumeService,
      coverageService as unknown as BaselineVolumeCoverageService,
    );
  });

  // ── K1 · coverage — ÜÇ ÇIKTI, AYNI SUITE'te ayrışıyor ──────────────────
  describe('getCoverage — üç çıktı OLDUĞU GİBİ yüzeye çıkar (§1a: kapı DEĞİL, karar desteği)', () => {
    it('GREEN: coverageRatio + outcome DEĞİŞTİRİLMEDEN döner', async () => {
      const green: CoverageGateResult = {
        outcome: CoverageGateOutcome.GREEN,
        coverageRatio: 1,
        acceptedCount: 12,
        catalogUniverse: 12,
        activeSkuCount: 1,
        activeCplCount: 1,
        periodCount: 12,
        threshold: 0.95,
      };
      coverageService.computeCoverageGate.mockResolvedValue(green);

      const result = await controller.getCoverage(TENANT_ID);

      expect(result).toEqual(green);
      expect(coverageService.computeCoverageGate).toHaveBeenCalledWith(
        TENANT_ID,
      );
    });

    it('RED: coverageRatio sayısal ve < threshold, outcome RED — GREEN ile AYNI koşumda AYRIŞIYOR', async () => {
      const red: CoverageGateResult = {
        outcome: CoverageGateOutcome.RED,
        coverageRatio: 0,
        acceptedCount: 0,
        catalogUniverse: 59160,
        activeSkuCount: 4930,
        activeCplCount: 1,
        periodCount: 12,
        threshold: 0.95,
      };
      coverageService.computeCoverageGate.mockResolvedValue(red);

      const result = await controller.getCoverage(TENANT_ID);

      expect(result.outcome).toBe(CoverageGateOutcome.RED);
      expect(result.coverageRatio).toBe(0);
      expect(result.coverageRatio).not.toBeNull();
    });

    it('UNMEASURABLE: coverageRatio null döner, sahte 0/100 ÜRETİLMEZ — GREEN/RED ile AYNI koşumda AYRIŞIYOR', async () => {
      const unmeasurable: CoverageGateResult = {
        outcome: CoverageGateOutcome.UNMEASURABLE,
        coverageRatio: null,
        acceptedCount: 0,
        catalogUniverse: 0,
        activeSkuCount: 0,
        activeCplCount: 0,
        periodCount: 12,
        threshold: 0.95,
      };
      coverageService.computeCoverageGate.mockResolvedValue(unmeasurable);

      const result = await controller.getCoverage(TENANT_ID);

      expect(result.outcome).toBe(CoverageGateOutcome.UNMEASURABLE);
      expect(result.coverageRatio).toBeNull();
    });
  });

  // ── K3 · Z92 sınıfı — prototip-zinciri sızıntısı ───────────────────────
  describe('getBatchRows — ?reason= doğrulaması (Z92: `in` yerine Object.values().includes())', () => {
    const POLLUTION_ATTEMPTS = [
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
    ];

    it.each(POLLUTION_ATTEMPTS)(
      'reason=%s → 400 (prototip zinciri üyesi, GERÇEK enum üyesi DEĞİL)',
      async (pollutionValue) => {
        await expect(
          controller.getBatchRows(BATCH_ID, TENANT_ID, pollutionValue),
        ).rejects.toThrow(BadRequestException);
        expect(service.getBatchRows).not.toHaveBeenCalled();
      },
    );

    it.each(POLLUTION_ATTEMPTS)(
      'status=%s → 400 (aynı sınıf, status parametresi)',
      async (pollutionValue) => {
        await expect(
          controller.getBatchRows(
            BATCH_ID,
            TENANT_ID,
            undefined,
            pollutionValue,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(service.getBatchRows).not.toHaveBeenCalled();
      },
    );

    it('reason=SKU_NOT_FOUND (gerçek enum üyesi) → 400 ATMAZ, servise GEÇER', async () => {
      service.getBatchRows.mockResolvedValue([]);

      await controller.getBatchRows(
        BATCH_ID,
        TENANT_ID,
        ImportBatchRowReason.SKU_NOT_FOUND,
      );

      expect(service.getBatchRows).toHaveBeenCalledWith(TENANT_ID, BATCH_ID, {
        reason: ImportBatchRowReason.SKU_NOT_FOUND,
        status: undefined,
        rowNo: undefined,
      });
    });

    it('status=ACCEPTED / status=REJECTED (gerçek enum üyeleri) → 400 ATMAZ', async () => {
      service.getBatchRows.mockResolvedValue([]);

      await controller.getBatchRows(
        BATCH_ID,
        TENANT_ID,
        undefined,
        ImportBatchRowStatus.ACCEPTED,
      );
      await controller.getBatchRows(
        BATCH_ID,
        TENANT_ID,
        undefined,
        ImportBatchRowStatus.REJECTED,
      );

      expect(service.getBatchRows).toHaveBeenCalledTimes(2);
    });
  });

  describe('getBatchRows — ?rowNo= doğrulaması', () => {
    it.each(['0', '-1', '1.5', 'abc', ''])(
      'rowNo=%s → 400 (pozitif tamsayı DEĞİL)',
      async (rowNoValue) => {
        await expect(
          controller.getBatchRows(
            BATCH_ID,
            TENANT_ID,
            undefined,
            undefined,
            rowNoValue,
          ),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('rowNo=3 (pozitif tamsayı) → 400 ATMAZ, sayıya ÇEVRİLEREK servise geçer', async () => {
      service.getBatchRows.mockResolvedValue([]);

      await controller.getBatchRows(
        BATCH_ID,
        TENANT_ID,
        undefined,
        undefined,
        '3',
      );

      expect(service.getBatchRows).toHaveBeenCalledWith(TENANT_ID, BATCH_ID, {
        reason: undefined,
        status: undefined,
        rowNo: 3,
      });
    });
  });

  describe('getBatch — sourceMatch ile birlikte servisten OLDUĞU GİBİ döner', () => {
    it('servisin döndürdüğü şekli DEĞİŞTİRMEDEN taşır (§5a: coverageRatio BURADA YOK)', async () => {
      const batchResult = {
        id: BATCH_ID,
        counts: { ACCEPTED: 5, REJECTED: 2 },
        sourceMatch: {
          matchedCount: 5,
          totalCount: 7,
          sourceMatchRatio: 5 / 7,
        },
      };
      service.getBatch.mockResolvedValue(batchResult);

      const result = await controller.getBatch(BATCH_ID, TENANT_ID);

      expect(result).toEqual(batchResult);
      expect(result).not.toHaveProperty('coverageRatio');
    });
  });
});

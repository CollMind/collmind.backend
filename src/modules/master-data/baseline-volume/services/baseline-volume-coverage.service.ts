import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sku } from '../../../../database/entities/sku.entity';
import { Cpl } from '../../../../database/entities/cpl.entity';
import {
  BaselineVolume,
  BaselineVolumeAcceptanceStatus,
} from '../../../../database/entities/baseline-volume.entity';

/**
 * `BL-3` `ADIM 2` (`docs/process/BL3_DOGRULAMA_BRIEF.md §B`) — `D4` `≥%95`
 * kapsam kapısı.
 *
 * ⛔ **BU SERVİS BİLEREK BİR CONTROLLER'A BAĞLANMADI.** `Z87`/brief §D-§E'nin
 * "yeni rota eklersen scope-ratchet KOVA KARARI ister ⇒ DUR" (`T-266`) şartı
 * — bu servisin bir HTTP ucuna bağlanması `src/**\/*.controller.ts`'e yeni
 * bir rota ekler, ve `scope-ratchet.sh` guard'ı yeni rotayı A1/A2/B/C
 * listelerinden birine el ile sınıflandırmadan geçirmez (bir ÜRÜN KARARI —
 * guard'ın kendisi veremez). Bu turda o karar ALINMADI; servis BİLİNÇLİ
 * OLARAK yalnız enjekte edilebilir/test edilebilir bırakıldı. HTTP yüzeyi
 * (`BL-4` ya da ayrı bir task) route eklerken bu kararı Team Lead'den alır.
 *
 * ── FORMÜL (`Z79 §4` / `Z85 §3` / brief `§B`) ────────────────────────────
 *   coverageRatio = (tenant × ACCEPTED baseline_volumes satır sayısı)
 *                   ---------------------------------------------------
 *                   (aktif SKU sayısı × aktif CPL sayısı × 12 dönem)
 *                   [G5: TÜRETİLMİŞ katalog evreni]
 *
 * ⛔ Pasif SKU/CPL paydaya GİRMEZ. ⛔ Reddedilen satır (`baseline_volumes`'a
 * `REJECTED` olarak yazılmış OLSA BİLE) paya girmez — payda TÜM evrendir,
 * "kabul edilmemiş" orada zaten "eksik" olarak görünür (`§2.5`: kapsam
 * hesaplanamıyorsa AÇIK HATA — burada hesaplanabiliyor, yalnız payda TAM
 * evren üzerinden kurulur, kabul-edilmeyenleri paydan DÜŞÜREREK değil).
 *
 * ── SINIR SEMANTİĞİ — İKİNCİ BİR EŞİK KARŞILAŞTIRMASI YAZILMADI (`F8`) ────
 * `>=` — `budget-threshold.service.ts:228-230`'un (`F12` ile ölçülmüş)
 * KANONİK semantiği — AYNEN kullanılır: `coverageRatio >= threshold ⇒ YEŞİL`.
 *
 * ── ÜÇÜNCÜ ÇIKTI — `0/0` BİR ORAN DEĞİLDİR (brief §B, ZORUNLU) ───────────
 * Katalog evreni (aktif SKU × aktif CPL × 12) SIFIRSA kapı `YEŞİL` DE
 * `KIRMIZI` DA DÖNMEZ — `UNMEASURABLE` döner. `plans=0` penceresinde
 * BUGÜN bu dal koşacak (T-273 körlüğünün kapı hâli): kapı "temiz" değil,
 * "ölçülemedi" der.
 */
export enum CoverageGateOutcome {
  GREEN = 'GREEN',
  RED = 'RED',
  UNMEASURABLE = 'UNMEASURABLE',
}

export interface CoverageGateResult {
  outcome: CoverageGateOutcome;
  /** `null` YALNIZ `outcome === UNMEASURABLE` iken (evren 0, oran tanımsız). */
  coverageRatio: number | null;
  acceptedCount: number;
  catalogUniverse: number;
  activeSkuCount: number;
  activeCplCount: number;
  periodCount: number;
  threshold: number;
}

@Injectable()
export class BaselineVolumeCoverageService {
  /** `Section_10 §10.2 Gate 2` · `Glossary` · `L2_02:55` — brief §2/§B. */
  static readonly THRESHOLD = 0.95;
  /** Katalog evreninin dönem ekseni — brief §B: "aktif-SKU × aktif-CPL × 12-period". */
  static readonly PERIOD_COUNT = 12;

  constructor(
    @InjectRepository(Sku) private readonly skuRepo: Repository<Sku>,
    @InjectRepository(Cpl) private readonly cplRepo: Repository<Cpl>,
    @InjectRepository(BaselineVolume)
    private readonly baselineVolumeRepo: Repository<BaselineVolume>,
  ) {}

  async computeCoverageGate(tenantId: string): Promise<CoverageGateResult> {
    if (!tenantId) {
      // §2.5 — sessiz sıfır yasağı: tenant scope'suz bir "kapsam" hesabı
      // finansal/veri bütünlüğü açısından anlamsızdır, açık hata fırlatılır.
      throw new Error(
        'computeCoverageGate: tenantId zorunludur (sessiz tenant-sızıntısı önlemi, §2.5)',
      );
    }

    const [activeSkuCount, activeCplCount, acceptedCount] = await Promise.all([
      this.skuRepo.count({ where: { tenantId, isActive: true } }),
      this.cplRepo.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.baselineVolumeRepo.count({
        where: {
          tenantId,
          acceptanceStatus: BaselineVolumeAcceptanceStatus.ACCEPTED,
        },
      }),
    ]);

    const periodCount = BaselineVolumeCoverageService.PERIOD_COUNT;
    const catalogUniverse = activeSkuCount * activeCplCount * periodCount;
    const threshold = BaselineVolumeCoverageService.THRESHOLD;

    if (catalogUniverse === 0) {
      // ⛔ 0/0 BİR ORAN DEĞİLDİR — "temiz" (YEŞİL) DEĞİL, "ölçülemedi".
      return {
        outcome: CoverageGateOutcome.UNMEASURABLE,
        coverageRatio: null,
        acceptedCount,
        catalogUniverse,
        activeSkuCount,
        activeCplCount,
        periodCount,
        threshold,
      };
    }

    const coverageRatio = acceptedCount / catalogUniverse;
    // ⛔ `>=` — F12 kanonik semantiği, ikinci bir eşik karşılaştırması YOK.
    const outcome =
      coverageRatio >= threshold
        ? CoverageGateOutcome.GREEN
        : CoverageGateOutcome.RED;

    return {
      outcome,
      coverageRatio,
      acceptedCount,
      catalogUniverse,
      activeSkuCount,
      activeCplCount,
      periodCount,
      threshold,
    };
  }
}

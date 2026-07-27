import { Injectable } from '@nestjs/common';
import { CplService } from '../../../../master-data/cpl/cpl.service';
import { CategoryService } from '../../../../master-data/category/category.service';
import { ChannelService } from '../../../../master-data/channel/channel.service';
import { Cpl } from '../../../../../database/entities/cpl.entity';
import { Category } from '../../../../../database/entities/category.entity';
import { Channel } from '../../../../../database/entities/channel.entity';

export interface SalesActualsMasterDataIndex {
  cplByCode: Map<string, Cpl>;
  channelByCode: Map<string, Channel>;
  channelById: Map<string, Channel>;
  /** Kategori kodu -> Category (opsiyonel CSV `category_code` kolonu için, öncelikli). */
  categoryByCode: Map<string, Category>;
  /** trim() + toLocaleLowerCase('tr-TR') normalize edilmiş isim -> eşleşen Category[]. */
  categoryByNormalizedName: Map<string, Category[]>;
}

/** CSV serbest metin isim eşlemesinde Türkçe İ/ı tuzağını önlemek için tr-TR locale ZORUNLU. */
export function normalizeCategoryName(name: string): string {
  return name.trim().toLocaleLowerCase('tr-TR');
}

/**
 * Master-data toplu (bulk) çözümleme — N+1 yok, 3 sorgu (CPL/Category/Channel
 * findAll). Bkz. docs/analysis/0002-actuals-port-design.md §5.
 */
@Injectable()
export class SalesActualsLookupService {
  constructor(
    private readonly cplService: CplService,
    private readonly categoryService: CategoryService,
    private readonly channelService: ChannelService,
  ) {}

  async buildIndex(tenantId: string): Promise<SalesActualsMasterDataIndex> {
    const [cpls, categories, channels] = await Promise.all([
      this.cplService.findAll(tenantId),
      this.categoryService.findAll(tenantId),
      this.channelService.findAll(tenantId),
    ]);

    const cplByCode = new Map<string, Cpl>();
    for (const cpl of cpls) {
      cplByCode.set(cpl.code, cpl);
    }

    const channelByCode = new Map<string, Channel>();
    const channelById = new Map<string, Channel>();
    for (const channel of channels) {
      channelByCode.set(channel.code, channel);
      channelById.set(channel.id, channel);
    }

    const categoryByCode = new Map<string, Category>();
    const categoryByNormalizedName = new Map<string, Category[]>();
    for (const category of categories) {
      categoryByCode.set(category.code, category);
      const normalized = normalizeCategoryName(category.name);
      const existing = categoryByNormalizedName.get(normalized);
      if (existing) {
        existing.push(category);
      } else {
        categoryByNormalizedName.set(normalized, [category]);
      }
    }

    return {
      cplByCode,
      channelByCode,
      channelById,
      categoryByCode,
      categoryByNormalizedName,
    };
  }
}

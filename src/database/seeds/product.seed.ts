/**
 * Product (SKU) Master Data Seed — T-010
 *
 * Kaynak: Wella/Test CSV/Veriler/Product.xlsx (166 ürün, 10 FU, 7 kategori).
 * Repo-içi kopya: src/database/seeds/data/wella-products.json
 *   { fuToCategory: {FU -> Sheet2 Ana Grup}, products: [{code,name,price,fu,category,subGroup,fkms}] }
 *
 * Hiyerarşi:
 *   Brand: WELLA (agreement.seed.ts'de zaten oluşturulan brand'i YENİDEN KULLANIR)
 *     -> Category: 7 (Sheet1 Ana Grup benzersiz kümesi)
 *          -> GenericUnit: Brand x Category = 7 (dosyada yok, GU zorunlu alanları
 *             için türetildi)
 *               -> ForecastingUnit: 10 (fuToCategory anahtarları; Sheet2 OTORİTER
 *                  kategori eşlemesiyle GU'ya bağlanır)
 *                    -> Sku: 166 (guId + fuId ZORUNLU dolu)
 *
 * Çelişki kuralı: Wellaflex FU'sunda Sheet1 ürün bazlı Ana Grup ikiye bölünmüş
 * (12 Şekillendirici + 6 Köpük). Sheet2 (fuToCategory) OTORİTER -> Wellaflex FU'su
 * Köpük GU'suna bağlanır. Ürünün kendi Sheet1 Ana Grup değeri SKU.metadata.anaGrup
 * alanında kaybolmadan saklanır.
 *
 * KRİTİK: agreement.seed.ts içindeki placeholder zincir (Category 'HAIR_CARE',
 * GenericUnit 'GU-WELLA-HC-001', ForecastingUnit 'FU-WELLA-HC-500ML') e2e testler
 * tarafından kullanılıyor — bu seed o zincire DOKUNMAZ, sadece WELLA brand'ini
 * paylaşır ve yanına gerçek master-data ekler. Kod alanları (CAT-*, GU-WELLA-*,
 * FU-*) placeholder'larla ÇAKIŞMAZ.
 *
 * Idempotent: upsert anahtarı (tenantId, code) — her entity'de unique index var.
 * Tekrar çalıştırmada mevcut kayıtlar bulunup güncellenir; duplicate/hata oluşmaz.
 */
import { DataSource } from 'typeorm';
import { Brand } from '../entities/brand.entity';
import { Category } from '../entities/category.entity';
import { GenericUnit } from '../entities/generic-unit.entity';
import { ForecastingUnit } from '../entities/forecasting-unit.entity';
import { Sku } from '../entities/sku.entity';
import wellaProductData from './data/wella-products.json';

interface WellaProduct {
  code: string;
  name: string;
  price: string;
  fu: string;
  category: string;
  subGroup: string;
  fkms: string;
}

interface WellaProductData {
  fuToCategory: Record<string, string>;
  products: WellaProduct[];
}

const DATA = wellaProductData as WellaProductData;

/** Sheet1 Ana Grup (kategori) -> deterministik kod. */
const CATEGORY_CODE: Record<string, string> = {
  'Saç Boyası': 'CAT-SAC-BOYASI',
  'Set Boya': 'CAT-SET-BOYA',
  Şekillendirici: 'CAT-SEKILLENDIRICI',
  Köpük: 'CAT-KOPUK',
  Peroksit: 'CAT-PEROKSIT',
  Diğer: 'CAT-DIGER',
  'Karma Koli': 'CAT-KARMA-KOLI',
};

/** GU kodu = Brand(WELLA) x Category. */
const GU_CODE: Record<string, string> = {
  'Saç Boyası': 'GU-WELLA-SAC-BOYASI',
  'Set Boya': 'GU-WELLA-SET-BOYA',
  Şekillendirici: 'GU-WELLA-SEKILLENDIRICI',
  Köpük: 'GU-WELLA-KOPUK',
  Peroksit: 'GU-WELLA-PEROKSIT',
  Diğer: 'GU-WELLA-DIGER',
  'Karma Koli': 'GU-WELLA-KARMA-KOLI',
};

/** Sheet2 (fuToCategory) FU adı -> deterministik kod. */
const FU_CODE: Record<string, string> = {
  'Karma Koli': 'FU-KARMA-KOLI',
  Wellaflex: 'FU-WELLAFLEX',
  'Tüp Boya': 'FU-TUP-BOYA',
  'New Wave': 'FU-NEW-WAVE',
  Naturals: 'FU-NATURALS',
  İntense: 'FU-INTENSE',
  Peroksit: 'FU-PEROKSIT',
  'Koleston Kit': 'FU-KOLESTON-KIT',
  Koleston: 'FU-KOLESTON',
  Promosyon: 'FU-PROMOSYON',
};

function isDuplicateError(error: any): boolean {
  return (
    error?.code === '23505' ||
    error?.driverError?.code === '23505' ||
    error?.driverError?.driverError?.code === '23505' ||
    (typeof error?.message === 'string' &&
      error.message.includes('duplicate key')) ||
    (typeof error?.driverError?.message === 'string' &&
      error.driverError.message.includes('duplicate key'))
  );
}

export interface ProductSeedResult {
  brand: Brand;
  categories: Category[];
  genericUnits: GenericUnit[];
  forecastingUnits: ForecastingUnit[];
  skus: Sku[];
}

export async function seedProducts(
  dataSource: DataSource,
  tenantId: string,
  createdByUserId: string,
): Promise<ProductSeedResult> {
  const brandRepo = dataSource.getRepository(Brand);
  const categoryRepo = dataSource.getRepository(Category);
  const guRepo = dataSource.getRepository(GenericUnit);
  const fuRepo = dataSource.getRepository(ForecastingUnit);
  const skuRepo = dataSource.getRepository(Sku);

  // ── 1. Brand: WELLA — agreement.seed.ts ile PAYLAŞILIR, yeniden oluşturulmaz ──
  let brand = await brandRepo.findOne({ where: { code: 'WELLA', tenantId } });
  if (!brand) {
    try {
      brand = brandRepo.create({
        code: 'WELLA',
        name: 'Wella',
        tenantId,
        createdBy: createdByUserId,
      });
      brand = await brandRepo.save(brand);
      console.log('   [PRODUCT SEED] Brand INSERT WELLA');
    } catch (error) {
      if (isDuplicateError(error)) {
        brand = await brandRepo.findOne({ where: { code: 'WELLA', tenantId } });
        if (!brand) throw error;
      } else {
        throw error;
      }
    }
  }

  // ── 2. Categories: 7 (Sheet1 Ana Grup benzersiz kümesi) ──────────────────────
  const categoryByName = new Map<string, Category>();
  for (const [name, code] of Object.entries(CATEGORY_CODE)) {
    let category = await categoryRepo.findOne({ where: { code, tenantId } });
    if (!category) {
      try {
        category = categoryRepo.create({
          code,
          name,
          level: 1,
          tenantId,
          createdBy: createdByUserId,
          metadata: { source: 'Wella Product.xlsx' },
        });
        category = await categoryRepo.save(category);
        console.log(`   [PRODUCT SEED] Category INSERT ${code}`);
      } catch (error) {
        if (isDuplicateError(error)) {
          category = await categoryRepo.findOne({ where: { code, tenantId } });
          if (!category) throw error;
        } else {
          throw error;
        }
      }
    } else if (category.name !== name) {
      category.name = name;
      category = await categoryRepo.save(category);
    }
    categoryByName.set(name, category);
  }

  // ── 3. Generic Units: Brand(WELLA) x Category = 7 ────────────────────────────
  const guByCategoryName = new Map<string, GenericUnit>();
  for (const [categoryName, guCode] of Object.entries(GU_CODE)) {
    const category = categoryByName.get(categoryName)!;
    let gu = await guRepo.findOne({ where: { code: guCode, tenantId } });
    if (!gu) {
      try {
        gu = guRepo.create({
          code: guCode,
          name: `Wella ${categoryName}`,
          brandId: brand.id,
          categoryId: category.id,
          tenantId,
          createdBy: createdByUserId,
          metadata: { source: 'Wella Product.xlsx' },
        });
        gu = await guRepo.save(gu);
        console.log(`   [PRODUCT SEED] GenericUnit INSERT ${guCode}`);
      } catch (error) {
        if (isDuplicateError(error)) {
          gu = await guRepo.findOne({ where: { code: guCode, tenantId } });
          if (!gu) throw error;
        } else {
          throw error;
        }
      }
    } else if (gu.brandId !== brand.id || gu.categoryId !== category.id) {
      gu.brandId = brand.id;
      gu.categoryId = category.id;
      gu = await guRepo.save(gu);
    }
    guByCategoryName.set(categoryName, gu);
  }

  // ── 4. Forecasting Units: 10 (Sheet2 fuToCategory OTORİTER kategori eşlemesi) ─
  const fuByName = new Map<string, ForecastingUnit>();
  for (const [fuName, categoryName] of Object.entries(DATA.fuToCategory)) {
    const fuCode = FU_CODE[fuName];
    if (!fuCode) {
      throw new Error(`[PRODUCT SEED] FU kodu tanımlı değil: ${fuName}`);
    }
    const gu = guByCategoryName.get(categoryName);
    if (!gu) {
      throw new Error(
        `[PRODUCT SEED] GU bulunamadı (FU: ${fuName}, category: ${categoryName})`,
      );
    }
    let fu = await fuRepo.findOne({ where: { code: fuCode, tenantId } });
    if (!fu) {
      try {
        fu = fuRepo.create({
          code: fuCode,
          name: `Wella ${fuName}`,
          guId: gu.id,
          currency: 'TRY',
          isPlannable: true,
          tenantId,
          createdBy: createdByUserId,
          metadata: {
            source: 'Wella Product.xlsx',
            sheet2Category: categoryName,
          },
        });
        fu = await fuRepo.save(fu);
        console.log(`   [PRODUCT SEED] ForecastingUnit INSERT ${fuCode}`);
      } catch (error) {
        if (isDuplicateError(error)) {
          fu = await fuRepo.findOne({ where: { code: fuCode, tenantId } });
          if (!fu) throw error;
        } else {
          throw error;
        }
      }
    } else if (fu.guId !== gu.id) {
      fu.guId = gu.id;
      fu = await fuRepo.save(fu);
    }
    fuByName.set(fuName, fu);
  }

  // ── 5. SKUs: 166 ─────────────────────────────────────────────────────────────
  const skus: Sku[] = [];
  for (const product of DATA.products) {
    const fu = fuByName.get(product.fu);
    if (!fu) {
      throw new Error(`[PRODUCT SEED] FU bulunamadı: ${product.fu} (SKU ${product.code})`);
    }
    // SKU.guId ZORUNLU: FU'nun bağlı olduğu GU (Sheet2-otoriter zincir) kullanılır.
    const guId = fu.guId;
    const unitPrice = Number.parseFloat(product.price);
    const metadata = {
      anaGrup: product.category,
      altGrup: product.subGroup,
      fkms: product.fkms,
      source: 'Wella Product.xlsx',
    };

    let sku = await skuRepo.findOne({ where: { code: product.code, tenantId } });
    if (!sku) {
      try {
        sku = skuRepo.create({
          code: product.code,
          name: product.name,
          guId,
          fuId: fu.id,
          barcode: product.code,
          unitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined,
          currency: 'TRY',
          isActive: true,
          tenantId,
          createdBy: createdByUserId,
          metadata,
        });
        sku = await skuRepo.save(sku);
      } catch (error) {
        if (isDuplicateError(error)) {
          sku = await skuRepo.findOne({ where: { code: product.code, tenantId } });
          if (!sku) throw error;
        } else {
          throw error;
        }
      }
    } else {
      // Idempotent update: değişen alanları güncelle.
      let dirty = false;
      if (sku.name !== product.name) {
        sku.name = product.name;
        dirty = true;
      }
      if (sku.guId !== guId) {
        sku.guId = guId;
        dirty = true;
      }
      if (sku.fuId !== fu.id) {
        sku.fuId = fu.id;
        dirty = true;
      }
      if (Number.isFinite(unitPrice) && Number(sku.unitPrice) !== unitPrice) {
        sku.unitPrice = unitPrice;
        dirty = true;
      }
      if (JSON.stringify(sku.metadata) !== JSON.stringify(metadata)) {
        sku.metadata = metadata;
        dirty = true;
      }
      if (dirty) {
        sku = await skuRepo.save(sku);
      }
    }
    skus.push(sku);
  }

  console.log(
    `   [PRODUCT SEED] Categories: ${categoryByName.size}, GUs: ${guByCategoryName.size}, FUs: ${fuByName.size}, SKUs: ${skus.length}`,
  );

  return {
    brand,
    categories: [...categoryByName.values()],
    genericUnits: [...guByCategoryName.values()],
    forecastingUnits: [...fuByName.values()],
    skus,
  };
}

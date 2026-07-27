/**
 * UserScope seed — T-028b (docs/analysis/0004-rbac-brd-alignment.md §6).
 *
 * AccessScopeService fail-closed çalışır (R-2): scope satırı olmayan
 * PLANNER/CATEGORY_MANAGER hiçbir şey görmez. Bu yüzden bu seed, scope
 * enforcement'ının (T-028b: CM plan modülü) çalışması için ZORUNLUDUR —
 * seedUsers'dan SONRA, seedCpls VE seedProducts'tan (kategoriler) SONRA
 * çalışmalı.
 *
 * Tablo (§6):
 *   planner@wella.com          -> NKA kanalı CPL'leri x categoryId=null
 *   planner2@wella.com  (YENİ) -> Distribütör kanalı CPL'leri
 *   category.manager@wella.com -> cplId=null x 2 kategori (en çok plan olan)
 *     Not: repo'da henüz bir plan seed'i yok; "en çok plan olan" kategori
 *     fiilen CAT-SAC-BOYASI'dır — role-journey.e2e-spec.ts'in TÜM golden-path
 *     planları bu kategoriyi kullanır (FU-TUP-BOYA -> CAT-SAC-BOYASI). İkinci
 *     kategori CAT-SET-BOYA (aynı Wella katalog ailesi, gerçek master-data).
 *   category.manager2@wella.com (YENİ) -> farklı 1 kategori (CAT-SEKILLENDIRICI
 *     — category.manager'ın kümesiyle KESİŞMEZ, cross-category negatif testler
 *     (§9 N3/N4) için).
 *   manager@wella.com (T-028a deprecated alias, role=CATEGORY_MANAGER) ->
 *     category.manager@wella.com ile AYNI scope — geriye uyumluluk: bu
 *     kullanıcı pre-existing e2e golden-path'te (role-journey A9-A15,
 *     settlement/dashboard specs) plan approve/reject için kullanılıyor;
 *     fail-closed (R-2) devreye girince scope'suz bırakılırsa tüm o testler
 *     kırılır.
 *   ADMIN/FINANCE_MANAGER/READONLY -> satır YOK (AccessScopeService bu
 *     rolleri UNRESTRICTED sayar, scope satırı gerekmez).
 *
 * Idempotent: (tenantId, userId, cplId, categoryId) kombinasyonu bulunup
 * yoksa oluşturulur (unique index: user-scope.entity.ts).
 */
import { DataSource, IsNull } from 'typeorm';
import { User } from '../entities/user.entity';
import { UserScope } from '../entities/user-scope.entity';
import { Cpl } from '../entities/cpl.entity';
import { Channel } from '../entities/channel.entity';
import { Category } from '../entities/category.entity';

const NKA_CHANNEL_CODE = 'NKA';
const DISTRIBUTOR_CHANNEL_CODE = 'DISTRIBUTOR';

const CM1_CATEGORY_CODES = ['CAT-SAC-BOYASI', 'CAT-SET-BOYA'];
const CM2_CATEGORY_CODES = ['CAT-SEKILLENDIRICI'];

interface ScopeRowSpec {
  userId: string;
  cplId: string | null;
  categoryId: string | null;
}

async function upsertScopeRow(
  dataSource: DataSource,
  tenantId: string,
  spec: ScopeRowSpec,
  createdByUserId: string,
): Promise<{ created: boolean }> {
  const userScopeRepo = dataSource.getRepository(UserScope);

  const qb = userScopeRepo
    .createQueryBuilder('us')
    .where('us.tenantId = :tenantId', { tenantId })
    .andWhere('us.userId = :userId', { userId: spec.userId });
  qb.andWhere(
    spec.cplId ? 'us.cplId = :cplId' : 'us.cplId IS NULL',
    spec.cplId ? { cplId: spec.cplId } : {},
  );
  qb.andWhere(
    spec.categoryId ? 'us.categoryId = :categoryId' : 'us.categoryId IS NULL',
    spec.categoryId ? { categoryId: spec.categoryId } : {},
  );

  const existing = await qb.getOne();
  if (existing) {
    if (!existing.isActive) {
      await userScopeRepo.update({ id: existing.id }, { isActive: true });
    }
    return { created: false };
  }

  const row = userScopeRepo.create({
    tenantId,
    userId: spec.userId,
    cplId: spec.cplId ?? undefined,
    categoryId: spec.categoryId ?? undefined,
    isActive: true,
    createdBy: createdByUserId,
  });
  await userScopeRepo.save(row);
  return { created: true };
}

export interface UserScopeSeedResult {
  rowsCreated: number;
  rowsSkipped: number;
  totalRows: number;
}

export async function seedUserScopes(
  dataSource: DataSource,
  tenantId: string,
  users: User[],
  createdByUserId: string,
): Promise<UserScopeSeedResult> {
  const channelRepo = dataSource.getRepository(Channel);
  const cplRepo = dataSource.getRepository(Cpl);
  const categoryRepo = dataSource.getRepository(Category);

  const findUser = (email: string): User => {
    const u = users.find((x) => x.email === email);
    if (!u) {
      throw new Error(
        `UserScope seed: required user '${email}' not found — seed users first.`,
      );
    }
    return u;
  };

  const planner = findUser('planner@wella.com');
  const planner2 = findUser('planner2@wella.com');
  const categoryManager = findUser('category.manager@wella.com');
  const categoryManager2 = findUser('category.manager2@wella.com');
  // T-028a deprecated alias user (role MANAGER -> CATEGORY_MANAGER, e-posta
  // korunur): pre-existing e2e suite'in golden-path plan approve/reject
  // akışları (role-journey.e2e-spec.ts A9-A15, settlement/dashboard specs)
  // bu kullanıcıyı kullanır. AccessScopeService fail-closed (R-2) olduğu
  // için scope satırı olmayan bir CATEGORY_MANAGER artık HİÇBİR planı
  // onaylayamaz — bu kullanıcıya da category.manager@wella.com ile AYNI
  // kategori scope'u verilir (BRD ihlali değil: gerçek bir CM'in görmesi
  // gereken kategoriler zaten bunlar).
  const managerAlias = findUser('manager@wella.com');

  const [nkaChannel, distributorChannel] = await Promise.all([
    channelRepo.findOne({ where: { tenantId, code: NKA_CHANNEL_CODE } }),
    channelRepo.findOne({
      where: { tenantId, code: DISTRIBUTOR_CHANNEL_CODE },
    }),
  ]);
  if (!nkaChannel) {
    throw new Error(
      `UserScope seed: channel '${NKA_CHANNEL_CODE}' not found — seed channels first.`,
    );
  }
  if (!distributorChannel) {
    throw new Error(
      `UserScope seed: channel '${DISTRIBUTOR_CHANNEL_CODE}' not found — seed channels first.`,
    );
  }

  const [nkaCpls, distributorCpls] = await Promise.all([
    cplRepo.find({ where: { tenantId, channelId: nkaChannel.id } }),
    cplRepo.find({ where: { tenantId, channelId: distributorChannel.id } }),
  ]);
  if (nkaCpls.length === 0) {
    throw new Error(
      `UserScope seed: no CPLs found for channel '${NKA_CHANNEL_CODE}' — seed CPLs first.`,
    );
  }
  if (distributorCpls.length === 0) {
    throw new Error(
      `UserScope seed: no CPLs found for channel '${DISTRIBUTOR_CHANNEL_CODE}' — seed CPLs first.`,
    );
  }

  const resolveCategoriesByCode = async (
    codes: string[],
  ): Promise<Category[]> => {
    const resolved: Category[] = [];
    for (const code of codes) {
      const category = await categoryRepo.findOne({
        where: { tenantId, code, deletedAt: IsNull() },
      });
      if (!category) {
        throw new Error(
          `UserScope seed: category '${code}' not found — seed products first.`,
        );
      }
      resolved.push(category);
    }
    return resolved;
  };

  const cm1Cats = await resolveCategoriesByCode(CM1_CATEGORY_CODES);
  const cm2Cats = await resolveCategoriesByCode(CM2_CATEGORY_CODES);

  const specs: ScopeRowSpec[] = [
    // planner@wella.com — NKA kanalı CPL'leri x categoryId=null (BRD: bir
    // CPL scope satırı = o CPL'in her kategorisi, çünkü PLANNER kategori
    // sınırlaması olmadan kendi CPL'lerinde çalışır).
    ...nkaCpls.map((cpl) => ({
      userId: planner.id,
      cplId: cpl.id,
      categoryId: null,
    })),
    // planner2@wella.com — Distribütör kanalı CPL'leri (cross-planner negatif
    // test: planner1 planner2'nin CPL'lerini göremez, §9 N7/N8 ailesi).
    ...distributorCpls.map((cpl) => ({
      userId: planner2.id,
      cplId: cpl.id,
      categoryId: null,
    })),
    // category.manager@wella.com — cplId=null x 2 kategori (kanaldan
    // bağımsız kategori sahibi, BRD "CM atanmış kategoriyi onaylar").
    ...cm1Cats.map((cat) => ({
      userId: categoryManager.id,
      cplId: null,
      categoryId: cat.id,
    })),
    // category.manager2@wella.com — farklı 1 kategori (cm1 ile KESİŞMEZ —
    // §9 N3/N4 cross-category negatiflerinin temeli).
    ...cm2Cats.map((cat) => ({
      userId: categoryManager2.id,
      cplId: null,
      categoryId: cat.id,
    })),
    // manager@wella.com (deprecated alias) — geriye uyumluluk, bkz. yukarı yorum.
    ...cm1Cats.map((cat) => ({
      userId: managerAlias.id,
      cplId: null,
      categoryId: cat.id,
    })),
  ];

  let created = 0;
  let skipped = 0;
  for (const spec of specs) {
    const result = await upsertScopeRow(
      dataSource,
      tenantId,
      spec,
      createdByUserId,
    );
    if (result.created) created++;
    else skipped++;
  }

  console.log(
    `✅ Seeded UserScope: ${created} created, ${skipped} already present (total ${specs.length})`,
  );
  console.log(
    `   planner@wella.com: ${nkaCpls.length} NKA CPL(s) x categoryId=null`,
  );
  console.log(
    `   planner2@wella.com: ${distributorCpls.length} Distribütör CPL(s) x categoryId=null`,
  );
  console.log(
    `   category.manager@wella.com: cplId=null x [${CM1_CATEGORY_CODES.join(', ')}]`,
  );
  console.log(
    `   category.manager2@wella.com: cplId=null x [${CM2_CATEGORY_CODES.join(', ')}]`,
  );
  console.log(
    `   manager@wella.com (deprecated alias): cplId=null x [${CM1_CATEGORY_CODES.join(', ')}]`,
  );

  return {
    rowsCreated: created,
    rowsSkipped: skipped,
    totalRows: specs.length,
  };
}

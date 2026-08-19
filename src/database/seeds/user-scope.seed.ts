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
 *   ADMIN/FINANCE/READONLY -> JOKER satır (cplId=null, categoryId=null),
 *     HER kullanıcı için (T-235 ADIM 1, docs/verification/T235_OLCUM_1_VE_3.md §3).
 *     K-2.6.8a: "Boş kapsam = erişim yok. Tüm veriye erişim, AÇIK BİR JOKER
 *     ATAMASIYLA verilir." — access-scope.service.ts'deki `UNRESTRICTED_ROLES`
 *     kod sabiti bugün bu üç rolü satırsız (0 scope row) koşulsuz UNRESTRICTED
 *     sayıyor; bu K-2.6.8a'nın TERSİ (kural: boş = erişim YOK). Bu seed
 *     mekanizmayı DEĞİŞTİRMEZ (`buildScope`'un `hasUnrestrictedRow` dalı
 *     zaten joker satırı UNRESTRICTED'a çeviriyor — davranış AYNI kalır,
 *     yalnız artık kural-uyumlu bir satırla). `UNRESTRICTED_ROLES` kod
 *     sabitinin kaldırılması AYRI bir tur (T-235 ADIM 2, ⛔ SIRA BAĞLAYICI —
 *     satırlar ÖNCE, kod dalı SONRA; ters sırada satırsız bir READONLY R-2
 *     fail-closed ile hiçbir şey göremez).
 *
 * Idempotent: (tenantId, userId, cplId, categoryId) kombinasyonu, DB'nin
 * UNIQUE index'ine değil, `upsertScopeRow`'un kendi SELECT'ine dayanır —
 * `user_scopes`'un (user_id, cpl_id, category_id) UNIQUE index'i NULL'ları
 * PostgreSQL semantiğiyle BİRBİRİNDEN FARKLI sayar (NULLS NOT DISTINCT yok,
 * ölçüldü 2026-08-18), yani DB tekilliği İKİ joker satırı engellemez —
 * idempotentlik bu dosyanın açık `IS NULL` sorgusundan gelir.
 */
import { Brackets, DataSource, IsNull } from 'typeorm';
import { User, UserRole } from '../entities/user.entity';
import { UserScope } from '../entities/user-scope.entity';
import { Cpl } from '../entities/cpl.entity';
import { Channel } from '../entities/channel.entity';
import { Category } from '../entities/category.entity';

/**
 * T-235 ADIM 1 — K-2.6.8a: bu rollerin "tüm veriye erişimi" artık AÇIK bir
 * joker satırla temsil edilir (ürün sahibi kararı, T-235.md "SIRA BAĞLAYICI"
 * bölümü — İZLEYİCİ dahil, K-2.6.4c: "izleme yetenekleri seti, salt-okur
 * bayrağı DEĞİL", yani kapsamı hiçbir yerde "her şey" diye yazılı değildi;
 * joker satır bugünkü davranışı KORUYARAK kuralı ihlal etmeyen hâle getiriyor).
 */
const WILDCARD_SCOPE_ROLES = new Set<UserRole>([
  UserRole.ADMIN,
  UserRole.FINANCE,
  UserRole.READONLY,
]);

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
  const userScopeRepo = dataSource.getRepository(UserScope);

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

  // T-235 ADIM 1 — ADMIN/FINANCE/READONLY: HER kullanıcı için joker satır
  // (WILDCARD_SCOPE_ROLES, dosya başı yorumu). Sabit e-postalara bağlanmaz —
  // `finance@wella.com` VE `finance.manager@wella.com` gibi aynı rolün birden
  // fazla kullanıcısı olabilir; hepsi rol üzerinden yakalanır.
  const wildcardScopeUsers = users.filter((u) =>
    WILDCARD_SCOPE_ROLES.has(u.role),
  );

  // DUR koşulu (T-235.md): bu roldeki bir kullanıcının ZATEN dar (joker
  // olmayan) bir scope satırı varsa, joker eklemek onun kapsamını sessizce
  // GENİŞLETİR — bu bir ürün kararıdır, seed'in sessizce vereceği bir şey
  // değil. Ölçüldü (2026-08-19, main.user_scopes): bugün ADMIN/FINANCE/
  // READONLY'nin scope satırı 0 — bu blok gelecekte biri manuel bir dar
  // satır eklerse sessiz genişlemeyi engeller.
  for (const u of wildcardScopeUsers) {
    const nonWildcardRow = await userScopeRepo
      .createQueryBuilder('us')
      .where('us.tenantId = :tenantId', { tenantId })
      .andWhere('us.userId = :userId', { userId: u.id })
      .andWhere(
        new Brackets((qb) => {
          qb.where('us.cplId IS NOT NULL').orWhere('us.categoryId IS NOT NULL');
        }),
      )
      .getOne();
    if (nonWildcardRow) {
      throw new Error(
        `UserScope seed: user '${u.email}' (role ${u.role}) already has a ` +
          `non-wildcard scope row (id=${nonWildcardRow.id}, cplId=` +
          `${nonWildcardRow.cplId ?? 'null'}, categoryId=` +
          `${nonWildcardRow.categoryId ?? 'null'}). Adding a wildcard row ` +
          `would silently WIDEN this user's access — that is a product ` +
          `decision (T-235 DUR condition), not a seed default. Resolve ` +
          `manually before re-running the seed.`,
      );
    }
  }

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
    // T-235 ADIM 1 — ADMIN/FINANCE/READONLY: joker satır (cplId=null,
    // categoryId=null) HER kullanıcı için. K-2.6.8a uyumu; davranış AYNI
    // kalır (buildScope zaten bu satırı UNRESTRICTED'a çeviriyor).
    ...wildcardScopeUsers.map((u) => ({
      userId: u.id,
      cplId: null,
      categoryId: null,
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
  console.log(
    `   Wildcard (ADMIN/FINANCE/READONLY): ${wildcardScopeUsers.length} user(s) ` +
      `x cplId=null,categoryId=null — [${wildcardScopeUsers
        .map((u) => u.email)
        .join(', ')}]`,
  );

  return {
    rowsCreated: created,
    rowsSkipped: skipped,
    totalRows: specs.length,
  };
}

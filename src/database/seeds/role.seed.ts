/**
 * Role Seed — B dalgası / S6 seed item 3: "rol kataloğu (beş rol)" (`K-2.6.4`).
 *
 * Kaynak: `docs/brd-v2/03_IS_KURALLARI/L2_03_onay_yetki_uyum.md` `K-2.6.4` rol
 * kataloğu tablosu — kod/ad/sorumluluk BİREBİR oradan:
 *
 * | Rol                | Sorumluluk                                              |
 * |--------------------|----------------------------------------------------------|
 * | YÖNETİCİ           | Tanımlar, kural yönetimi                                  |
 * | PLANLAMACI         | Plan, taktik, hacim girişi, gönderim — günlük kullanıcı   |
 * | KATEGORİ MÜDÜRÜ    | Kategori bütçe sahibi: onay + zarf yönetimi               |
 * | FİNANS             | Eşik üstü onay/bildirim, transfer, mutabakat, içe aktarma |
 * | İZLEYİCİ           | Salt görüntüleme                                          |
 *
 * `code` alanı `users_role_enum`'un (R2a, ASCII) tel değerleriyle BİREBİR — `roles`
 * tablosu ve `users.role` enum'u aynı beş rolü, aynı kodlarla temsil eder (iki ayrı
 * katalog değil, geçiş dönemi çakışması).
 *
 * ⚠️ Kapsam: yalnız `roles` (5 satır). `capabilities`/`role_capabilities`/`user_role_
 * assignments` KASITLI BOŞ — K-2.6.3'ün örnekleri ("plan oluşturabilir" vb.) illüstratif,
 * kanonik bir yetenek listesi hiçbir belgede yok; uydurmak `§2.5` ihlali olurdu.
 * `roles` şema olarak var (`S6`), popülasyonu bu seed'in kapsamı — `RBAC` bugün hâlâ
 * `users.role` enum'undan koşuyor, `roles` tablosunun üretim tüketicisi yok (bilinen
 * gap, T-211 review notu).
 *
 * İdempotent: `UQ_roles_tenant_code` üzerinden `ON CONFLICT DO NOTHING`.
 */
import { DataSource } from 'typeorm';
import { Role } from '../entities/role.entity';

const CANONICAL_ROLES: Array<{
  code: string;
  name: string;
  description: string;
}> = [
  { code: 'ADMIN', name: 'YÖNETİCİ', description: 'Tanımlar, kural yönetimi' },
  {
    code: 'PLANNER',
    name: 'PLANLAMACI',
    description: 'Plan, taktik, hacim girişi, gönderim — günlük kullanıcı',
  },
  {
    code: 'CATEGORY_MANAGER',
    name: 'KATEGORİ MÜDÜRÜ',
    description: 'Kategori bütçe sahibi: onay + zarf yönetimi',
  },
  {
    code: 'FINANCE',
    name: 'FİNANS',
    description: 'Eşik üstü onay/bildirim, transfer, mutabakat, içe aktarma',
  },
  { code: 'READONLY', name: 'İZLEYİCİ', description: 'Salt görüntüleme' },
];

export async function seedRoles(
  dataSource: DataSource,
  tenantId: string,
  createdByUserId: string,
): Promise<void> {
  const result = await dataSource
    .createQueryBuilder()
    .insert()
    .into(Role)
    .values(
      CANONICAL_ROLES.map((r) => ({
        ...r,
        tenantId,
        createdBy: createdByUserId,
      })),
    )
    .orIgnore()
    .execute();

  // review S7 emsali: `.orIgnore()` ile `identifiers.length` GİRDİ satırlarını sayar,
  // gerçek `RETURNING`'i değil (ampirik ölçüldü — bkz. fiscal-period.seed.ts). `raw`
  // yalnız GERÇEKTEN eklenen satırları taşır.
  console.log(
    `   Roles: ${result.raw.length} inserted (${CANONICAL_ROLES.length} canonical, K-2.6.4)`,
  );
}

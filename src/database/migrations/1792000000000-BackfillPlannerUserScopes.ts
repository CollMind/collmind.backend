import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-028c — Backfill: mevcut PLANNER kullanıcıları için main.user_scopes.
 *
 * Bağlam (docs/analysis/0004-rbac-brd-alignment.md §6/§7 — "Deny-by-default
 * geçiş riski"): AccessScopeService fail-closed çalışır (R-2) — scope satırı
 * olmayan bir PLANNER, SCOPE_ENFORCEMENT_ENABLED=true olduğu anda HİÇBİR şey
 * göremez/oluşturamaz. T-028b'nin seed'i (`user-scope.seed.ts`) yalnızca iki
 * bilinen e2e test kullanıcısını (planner@wella.com, planner2@wella.com)
 * kapsar — prod/UAT'de bu iki kullanıcıdan fazla PLANNER varsa, seed onları
 * kapsamaz ve enforcement açıldığı anda görünmez kalırlar.
 *
 * Bu migration, HER PLANNER için geçmiş planlarının fiilen kullandığı
 * (cpl_id, category_id) kombinasyonlarından bir scope türetir — "bu kullanıcı
 * geçmişte hangi CPL+Category'de plan açtıysa, oraya zaten fiili erişimi
 * var" varsayımıyla (gerçek bir yetki genişletmesi değil, mevcut fiili
 * kullanımın kaydı).
 *
 * ⚠️ KAPSAM DIŞI (release notunda belirtilmeli — manuel atama gerekir):
 *   - Hiç plan açmamış bir PLANNER (yeni kullanıcı, henüz iş yapmamış) bu
 *     backfill'den satır ALMAZ — enforcement açıldığında `[]` görür (fail-
 *     closed, R-2). Bu kullanıcılar için admin'in `user_scopes`'a manuel
 *     satır eklemesi gerekir (bkz. task raporu / release notu).
 *   - Yalnızca main.plans taranır — Agreement'ın kendi cplId kullanımından
 *     ayrı bir backfill YOK (agreement.cplId genelde plan.cplId ile
 *     örtüşür; PLANNER agreement oluştururken de plan scope'unu kullanır —
 *     T-028c tasarımı, agreement.service.ts#create).
 *
 * Idempotent: main.user_scopes'un unique index'i (user_id, cpl_id,
 * category_id) — ON CONFLICT DO NOTHING ile tekrar çalıştırılabilir.
 * Bu migration'ın eklediği satırlar `created_by = MARKER` ile işaretlenir
 * (down() bu işaretle geri alır — gerçek/seed satırlara dokunmaz).
 *
 * transaction = false: 1779/1790/1791 ile tutarlı.
 */
const MARKER = '00000000-0000-0000-0000-000000001792';

export class BackfillPlannerUserScopes1792000000000 implements MigrationInterface {
  name = 'BackfillPlannerUserScopes1792000000000';
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const result = (await queryRunner.query(
      `
      INSERT INTO main.user_scopes (
        id, tenant_id, user_id, cpl_id, category_id, is_active,
        created_by, created_at, updated_at
      )
      SELECT
        uuid_generate_v4(),
        p.tenant_id,
        p.created_by,
        p.cpl_id,
        p.category_id,
        true,
        $1,
        now(),
        now()
      FROM main.plans p
      JOIN main.users u ON u.id = p.created_by
      WHERE u.role = 'PLANNER'
        AND u.tenant_id = p.tenant_id
        AND p.deleted_at IS NULL
        AND p.created_by IS NOT NULL
      GROUP BY p.tenant_id, p.created_by, p.cpl_id, p.category_id
      ON CONFLICT (user_id, cpl_id, category_id) DO NOTHING
      RETURNING id;
      `,
      [MARKER],
    )) as Array<{ id: string }>;

    // eslint-disable-next-line no-console
    console.log(
      `T-028c backfill: ${result.length} main.user_scopes row(s) created for existing PLANNER users (derived from main.plans history).`,
    );

    const plannerWithoutPlans = (await queryRunner.query(`
      SELECT u.id, u.email
      FROM main.users u
      WHERE u.role = 'PLANNER'
        AND u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM main.user_scopes us
          WHERE us.user_id = u.id AND us.is_active = true
        )
    `)) as Array<{ id: string; email: string }>;

    if (plannerWithoutPlans.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `T-028c backfill WARNING: ${plannerWithoutPlans.length} PLANNER user(s) have NO derivable scope (no plan history) and will see nothing once SCOPE_ENFORCEMENT_ENABLED=true. Manual main.user_scopes assignment required: ${plannerWithoutPlans
          .map((u) => u.email)
          .join(', ')}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM main.user_scopes WHERE created_by = $1`,
      [MARKER],
    );
  }
}

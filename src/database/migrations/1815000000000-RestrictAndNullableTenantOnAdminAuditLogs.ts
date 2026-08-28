import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `Z52 §1`/`§2` — `K1a` dalgası, `#4` ölçümünün karşılığı.
 *
 * BULGU (`Z51 §4`, pakette olmayan bulgu): `admin_audit_logs.tenant_id` FK'si
 * `ON DELETE CASCADE` taşıyordu — bir tenant silinince o tenant'ın TÜM denetim
 * geçmişi de SİLİNİYORDU. `CLAUDE.md §2.3`: "Audit: immutable; silinemez."
 * ⇒ **OPERATÖR ROLÜNÜN İLK İŞİ, DENETİM İZİNİ YOK EDEN BİR İŞ** olurdu.
 *
 * KARAR (ürün sahibi, `Z52 §1`): **`RESTRICT`** — "DENETİM İZİ, İZ SÜRDÜĞÜ
 * NESNENİN YAŞAM DÖNGÜSÜNE TABİ OLAMAZ" (`ADR 0012`'nin denetim-katmanı
 * kardeşi). `SET NULL` ELENDİ — aktörsüz/kaynaksız kalan bir log satırı
 * "kim-ne yaptı"nın yarısını kaybetmiş bir izdir.
 *
 * KARAR (ürün sahibi, `Z52 §2`): operatör eylemleri (`K1` — platform-seviyesi,
 * tenant'a bağlı olmayan iş) AYRI bir tablo yerine AYNI tabloda, `tenant_id`
 * NULLABLE olarak temsil edilir (`Z15`'in kendi cümlesiyle: ayrı tanımlarsak
 * "beşinci aile" oluruz). ⛔ `NULL` burada BİLGİ-EKSİKLİĞİ DEĞİL,
 * KATMAN-BİLGİSİDİR — "platform-seviyesi eylem". `admin_id`/`admin_email`
 * NOT NULL KALIR ve SIKILAŞIR: tenant'sız satırda bile `kim`'siz satır OLAMAZ.
 *
 * Üç durum ayrımı (`1805`/`1808`/.../`1814` deseni):
 *   beklenen-önce   FK deltype='c' (CASCADE) VE tenant_id NOT NULL → UYGULA
 *   zaten-uygulanmış FK deltype='r' (RESTRICT) VE tenant_id NULLABLE → NO-OP
 *   beklenmeyen     başka herhangi bir kombinasyon → İPTAL
 *
 * `down()`: aynı üç-durum ayrımı ile simetrik geri döner. ⚠️ `down()` sırasında
 * `tenant_id IS NULL` satır varsa (platform-seviyesi eylem kaydedilmişse)
 * NOT NULL'a dönmek veri kaybı/ihlal olur — bu durumda İPTAL (sessiz tamir
 * yasağının migration hâli).
 *
 * Constraint adı `FK_df6424756dc2edd5ef911dbe777` KORUNUR (canlı katalogdan
 * ölçüldü, `1704067680000-CreateAdminAuditLogs.ts`'in TypeORM-üretimi adı) —
 * `migration:generate`'in bunu "değişti" sanıp gereksiz bir drift üretmemesi
 * için up/down'da da AYNI ad kullanılır.
 */
export class RestrictAndNullableTenantOnAdminAuditLogs1815000000000 implements MigrationInterface {
  name = 'RestrictAndNullableTenantOnAdminAuditLogs1815000000000';

  private readonly schema = 'main';
  private readonly table = 'admin_audit_logs';
  private readonly fkName = 'FK_df6424756dc2edd5ef911dbe777';
  private readonly columnComment =
    'NULL = platform-seviyesi eylem (tenant bağımsız operatör işi) — bilgi eksikliği DEĞİL, katman bilgisi. Z52 §2.';

  private async fkState(
    queryRunner: QueryRunner,
  ): Promise<{ exists: boolean; deltype: string | null }> {
    const rows: Array<{ confdeltype: string }> = await queryRunner.query(
      `
      SELECT confdeltype
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conname = $1
        AND c.conrelid = ($2 || '.' || $3)::regclass
        AND c.contype = 'f'
        AND n.nspname = $2
      `,
      [this.fkName, this.schema, this.table],
    );
    if (rows.length === 0) {
      return { exists: false, deltype: null };
    }
    return { exists: true, deltype: rows[0].confdeltype };
  }

  private async tenantIdNullable(queryRunner: QueryRunner): Promise<boolean> {
    const rows: Array<{ is_nullable: string }> = await queryRunner.query(
      `
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = 'tenant_id'
      `,
      [this.schema, this.table],
    );
    if (rows.length === 0) {
      throw new Error(
        `${this.name}: beklenmeyen durum — ${this.schema}.${this.table}.tenant_id kolonu bulunamadı. Sessizce geçilmiyor, İPTAL.`,
      );
    }
    return rows[0].is_nullable === 'YES';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const fk = await this.fkState(queryRunner);
    if (!fk.exists) {
      throw new Error(
        `${this.name}: beklenmeyen durum — FK ${this.fkName} bulunamadı. Küme değişmiş olabilir, İPTAL.`,
      );
    }
    const nullable = await this.tenantIdNullable(queryRunner);

    if (fk.deltype === 'r' && nullable) {
      // NO-OP — zaten uygulanmış, taze/prod DB'de tıkanmaz.
      return;
    }
    if (!(fk.deltype === 'c' && !nullable)) {
      throw new Error(
        `${this.name}: beklenmeyen durum — FK deltype='${fk.deltype}', tenant_id nullable=${nullable}. ` +
          'Beklenen ya (CASCADE, NOT NULL) ya (RESTRICT, NULLABLE). Sessizce geçilmiyor, İPTAL.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "${this.schema}"."${this.table}" ALTER COLUMN "tenant_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "${this.schema}"."${this.table}" DROP CONSTRAINT "${this.fkName}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "${this.schema}"."${this.table}" ADD CONSTRAINT "${this.fkName}" FOREIGN KEY ("tenant_id") REFERENCES "${this.schema}"."tenants"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "${this.schema}"."${this.table}"."tenant_id" IS '${this.columnComment}'`,
    );

    // Assert
    const after = await this.fkState(queryRunner);
    const afterNullable = await this.tenantIdNullable(queryRunner);
    if (after.deltype !== 'r' || !afterNullable) {
      throw new Error(
        `${this.name}: ALTER sonrası beklenen durum ölçülemedi (deltype='${after.deltype}', nullable=${afterNullable}) — assert başarısız.`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const fk = await this.fkState(queryRunner);
    if (!fk.exists) {
      throw new Error(
        `${this.name} down(): beklenmeyen durum — FK ${this.fkName} bulunamadı.`,
      );
    }
    const nullable = await this.tenantIdNullable(queryRunner);

    if (fk.deltype === 'c' && !nullable) {
      // NO-OP — zaten geri alınmış.
      return;
    }
    if (!(fk.deltype === 'r' && nullable)) {
      throw new Error(
        `${this.name} down(): beklenmeyen durum — FK deltype='${fk.deltype}', tenant_id nullable=${nullable}. İPTAL.`,
      );
    }

    // ⛔ Sessiz-tamir yasağı: platform-seviyesi (tenant_id IS NULL) satır
    // varken NOT NULL'a dönmek veri kaybı/ihlal olur — geri alma burada durur.
    // ⚠️ money-float — bu bir SATIR SAYISI, para değil, ama `src/database/`
    // Domain A üyesi (ADR 0007 E10) ve yeni dosyalar "exact doğar" (Karar
    // 8.2): `Number()`/`parseFloat()` desenleri yerine `parseInt(...,10)`
    // kullanılıyor (dedektör yalnız ilk ikisini tarıyor, money-float.sh:225-227).
    const orphan: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM "${this.schema}"."${this.table}" WHERE "tenant_id" IS NULL`,
    );
    const orphanCount = parseInt(orphan[0]?.count ?? '0', 10);
    if (!Number.isFinite(orphanCount)) {
      throw new Error(
        `${this.name} down(): tenant_id IS NULL satır sayısı ölçülemedi — İPTAL.`,
      );
    }
    if (orphanCount > 0) {
      throw new Error(
        `${this.name} down(): ${orphanCount} satırda tenant_id NULL (platform-seviyesi eylem) — ` +
          'NOT NULL kısıtına geri dönmek bu satırları ihlal eder/veri kaybına yol açar. Sessizce geçilmiyor, İPTAL.',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "${this.schema}"."${this.table}" DROP CONSTRAINT "${this.fkName}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "${this.schema}"."${this.table}" ADD CONSTRAINT "${this.fkName}" FOREIGN KEY ("tenant_id") REFERENCES "${this.schema}"."tenants"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "${this.schema}"."${this.table}" ALTER COLUMN "tenant_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN "${this.schema}"."${this.table}"."tenant_id" IS NULL`,
    );

    const after = await this.fkState(queryRunner);
    const afterNullable = await this.tenantIdNullable(queryRunner);
    if (after.deltype !== 'c' || afterNullable) {
      throw new Error(
        `${this.name} down(): ALTER sonrası beklenen durum ölçülemedi (deltype='${after.deltype}', nullable=${afterNullable}) — assert başarısız.`,
      );
    }
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-308 / Z45 §1 — `main.v_budget_summary` `security_invoker` YOK.
 *
 * Bulgu: view `SECURITY INVOKER` reloption'ı olmadan doğdu (owner `app_migrate`,
 * `app_runtime` üzerinde yalnız `SELECT` hakkı var). PostgreSQL'in varsayılanı
 * `security_invoker = false` — yani view'ın altındaki tablolar (`budget_envelopes`,
 * `budget_transactions`, `ledger_entries`) view SAHİBİNİN hakkıyla okunur, sorguyu
 * çalıştıran rolün değil.
 *
 * Bugün RLS politikası hiçbir tabloda YOK (ölçüldü: `relrowsecurity=false` dört
 * finansal/tenant tabloda da), yani bu migration'ın BUGÜN davranışsal bir etkisi
 * yoktur — ama `Z45 §1` hükmü gerekçesi budur: *"politikadan önce view — yoksa her
 * politika yazımı SAHTE-YEŞİL doğar."* RLS paketi (`T-304` ailesi) bu tablolara
 * politika yazdığı an, `security_invoker` olmayan bir view o politikaları ATLAR ve
 * `npm run guards` yeşil kalır (view kod tabanında ayrı bir guard yüzeyi değil).
 * Sıra bu yüzden BİRİNCİ adım olarak buraya alındı.
 *
 * Üç durum ayrımı (`1805`/`1808`/`1809`/`1810`/`1811`/`1812` deseni):
 *   security_invoker zaten true  → NO-OP (taze/prod DB'yi tıkamaz)
 *   security_invoker false/yok   → ALTER VIEW ... SET (security_invoker = true)
 *   view mevcut değil            → İPTAL (beklenmeyen durum, sessizce geçilmez)
 *
 * `app_migrate`-owner + `app_runtime`-SELECT düzeni bu migration'dan SONRA da
 * doğrudur — dokunulmadı (Z45 §1: "invoker sonrası doğru").
 *
 * `down()`: `security_invoker` reloption'ını KALDIRIR (`RESET`), view tanımının
 * kendisine dokunmaz — geri dönüş `ALTER VIEW ... RESET (security_invoker)` ile
 * bire bir simetriktir (PostgreSQL 16, `SHOW server_version` ile doğrulanan sürüm
 * ailesiyle aynı — bkz. `1810000000000` emsali).
 */
export class SecurityInvokerOnBudgetSummaryView1813000000000 implements MigrationInterface {
  name = 'SecurityInvokerOnBudgetSummaryView1813000000000';
  private readonly viewSchema = 'main';
  private readonly viewName = 'v_budget_summary';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ reloptions: string[] | null }> =
      await queryRunner.query(
        `
      SELECT c.reloptions
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'v'
      `,
        [this.viewSchema, this.viewName],
      );

    if (rows.length === 0) {
      throw new Error(
        `T-308: beklenmeyen durum — ${this.viewSchema}.${this.viewName} view'ı bulunamadı. ` +
          'Beklenen küme değişmiş olabilir; sessizce geçilmiyor, migration İPTAL edildi.',
      );
    }

    const reloptions = rows[0].reloptions || [];
    const alreadyInvoker = reloptions.some(
      (opt) => opt === 'security_invoker=true',
    );

    if (alreadyInvoker) {
      // NO-OP — taze/prod DB'de bu migration ikinci kez koşarsa tıkanmamalı.
      return;
    }

    await queryRunner.query(
      `ALTER VIEW ${this.viewSchema}.${this.viewName} SET (security_invoker = true)`,
    );

    const after: Array<{ reloptions: string[] | null }> =
      await queryRunner.query(
        `
      SELECT c.reloptions
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'v'
      `,
        [this.viewSchema, this.viewName],
      );
    const afterOk = (after[0]?.reloptions || []).some(
      (opt) => opt === 'security_invoker=true',
    );
    if (!afterOk) {
      throw new Error(
        `T-308: ALTER VIEW sonrası security_invoker=true ölçülemedi — assert başarısız.`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ reloptions: string[] | null }> =
      await queryRunner.query(
        `
      SELECT c.reloptions
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'v'
      `,
        [this.viewSchema, this.viewName],
      );

    if (rows.length === 0) {
      throw new Error(
        `T-308 down(): beklenmeyen durum — ${this.viewSchema}.${this.viewName} view'ı bulunamadı.`,
      );
    }

    const reloptions = rows[0].reloptions || [];
    const isInvoker = reloptions.some((opt) => opt === 'security_invoker=true');
    if (!isInvoker) {
      // NO-OP — zaten invoker değil.
      return;
    }

    await queryRunner.query(
      `ALTER VIEW ${this.viewSchema}.${this.viewName} RESET (security_invoker)`,
    );
  }
}

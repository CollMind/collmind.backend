import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `Z64 §1-3` / [[T-293]] — `agreements`(type=LTA) ↔ `lta_agreements` BAĞI.
 *
 * ── Ölçülmüş durum (2026-08-30, canlı DB, şema-nitelendirilmiş) ──────────
 *   main.lta_agreements       0 satır
 *   main.lta_rates            0 satır
 *   main.lta_plan_overrides   0 satır
 *   main.agreements WHERE agreement_type='LTA'   1 satır   ← FORM BURAYA YAZIYOR
 *
 * Kullanıcı LTA formunu doldurup kaydettiğinde `main.agreements` satırı
 * doğuyor; harcama motoru (`SpendCalculationService` → `LTAAgreementService.
 * getLTAForPlanContext` → `lta_agreements` + `lta_rates`) o satırı ASLA
 * görmüyor. İki tablo arasında HİÇBİR bağ yoktu — ölçüldü (`rg -i`,
 * poz. kontrollü): `lta_agreement_id`/`ltaAgreementId` yalnız `lta_rates`
 * ve `lta_plan_overrides`'ta geçiyor, `agreements` tarafında SIFIR.
 *
 * ── Mimari çerçeve (`Z38 §3(a)`, ürün sahibi 2026-08-26) ────────────────
 *   agreements   = YAŞAM DÖNGÜSÜNÜN kanonik yeri (onay · audit · SoD · defter)
 *   lta_rates    = ORAN ŞARTLARININ kanonik yeri (kanal×kategori kademe)
 *   bağ          AÇIK — agreements-LTA kaydı EBEVEYN, oran kademesi ona
 *                BAĞLI DOĞAR
 *
 * *"BAĞLI DOĞAR"* bu migration'da `NOT NULL` olarak kodlanır: nullable bir
 * kolon *"bağsız da doğabilir"* demek olurdu, yani bugünkü kırık durumun
 * kendisi. `CLAUDE.md §4.2`: *"bağlayıcı koşullar bir guard'a bağlanır —
 * DB constraint."*
 *
 * `ON DELETE RESTRICT`: `ADR 0012` ailesi — yaşam döngüsü satırı silinirse
 * oran şartlarının sessizce yok olması yerine tespit edilebilir bir hata.
 *
 * `UNIQUE`: bir yaşam döngüsü kaydının EN ÇOK BİR oran-şartları başlığı
 * olur (`İlke 4` — aynı olgunun iki temsili zamanla ayrışır).
 *
 * ── ÜÇ DURUM AYRIMI (`1805`/`1808`/…/`1816` deseni) ─────────────────────
 *   kolon YOK + tablo BOŞ            →  ekle (NOT NULL) + FK + UNIQUE + assert
 *   kolon VAR + FK VAR + UQ VAR      →  NO-OP (taze/prod DB'de tıkanmaz)
 *   başka herhangi bir kombinasyon   →  ⛔ İPTAL (küme değişmiş, sessiz geçme yok)
 *
 * ⚠️ `down()` kolonu/FK'yi/index'i **tam olarak** düşürür; `lta_agreements`
 * bu migration'dan önce BOŞ olduğu için veri asimetrisi YOKTUR. `down()`
 * satır varsa REDDEDER — bağlanmış oran şartlarının ebeveynini sessizce
 * koparmak bir bilgi kaybıdır.
 */
export class BindLtaAgreementsToAgreements1817000000000 implements MigrationInterface {
  name = 'BindLtaAgreementsToAgreements1817000000000';

  private static readonly SCHEMA = 'main';
  private static readonly TABLE = 'lta_agreements';
  private static readonly COLUMN = 'agreement_id';
  private static readonly FK_NAME = 'FK_lta_agreements_agreement';
  private static readonly UQ_NAME = 'UQ_lta_agreements_agreement_id';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const S = BindLtaAgreementsToAgreements1817000000000;

    // ── Katalog ölçümü — ŞEMA-NİTELENDİRİLMİŞ (MIGRATION_SEQUENCE madde 5).
    // ⚠️ İKİ katalog birden sorgulanır: TypeORM'un `@Index({unique:true})`'i
    // bir INDEX yaratır, bir CONSTRAINT değil — `pg_constraint`'teki yokluk
    // yokluk DEĞİLDİR (`T-101` dersi).
    const columnRows: Array<{ is_nullable: string; data_type: string }> =
      await queryRunner.query(
        `SELECT is_nullable, data_type
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
        [S.SCHEMA, S.TABLE, S.COLUMN],
      );

    const fkRows: Array<{ conname: string; confdeltype: string }> =
      await queryRunner.query(
        `SELECT c.conname, c.confdeltype
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1 AND t.relname = $2 AND c.conname = $3`,
        [S.SCHEMA, S.TABLE, S.FK_NAME],
      );

    const uqRows: Array<{ indexname: string }> = await queryRunner.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1 AND tablename = $2 AND indexname = $3`,
      [S.SCHEMA, S.TABLE, S.UQ_NAME],
    );

    const hasColumn = columnRows.length === 1;
    const hasFk = fkRows.length === 1;
    const hasUq = uqRows.length === 1;

    // ── DURUM 2: zaten uygulanmış → NO-OP
    if (hasColumn && hasFk && hasUq) {
      if (columnRows[0].is_nullable !== 'NO') {
        throw new Error(
          `[1817] ⛔ İPTAL: main.${S.TABLE}.${S.COLUMN} var ama NULLABLE ` +
            `(beklenen NOT NULL). Beklenmeyen ara durum — sessizce ` +
            `tamamlanmaz (Z38 §3(a): oran kademesi BAĞLI DOĞAR).`,
        );
      }
      if (fkRows[0].confdeltype !== 'r') {
        throw new Error(
          `[1817] ⛔ İPTAL: ${S.FK_NAME} var ama ON DELETE '${fkRows[0].confdeltype}' ` +
            `(beklenen 'r' = RESTRICT, ADR 0012 ailesi).`,
        );
      }
      return; // NO-OP — taze/prod DB'de tıkanmaz
    }

    // ── DURUM 3: yarım uygulanmış / beklenmeyen küme → İPTAL
    if (hasColumn || hasFk || hasUq) {
      throw new Error(
        `[1817] ⛔ İPTAL: yarım uygulanmış durum ` +
          `(kolon=${hasColumn}, FK=${hasFk}, UNIQUE=${hasUq}). ` +
          `Küme beklenmeyen — sessizce tamamlanmaz.`,
      );
    }

    // ── DURUM 1: beklenen durum. Tablo BOŞ olmalı, yoksa NOT NULL kolonu
    //    ekleyecek meşru bir değer YOKTUR (§2.5: uydurma varsayılan yasak).
    const [{ cnt }]: Array<{ cnt: string }> = await queryRunner.query(
      `SELECT count(*)::text AS cnt FROM ${S.SCHEMA}.${S.TABLE}`,
    );
    if (cnt !== '0') {
      throw new Error(
        `[1817] ⛔ İPTAL: main.${S.TABLE} ${cnt} satır taşıyor. ` +
          `NOT NULL '${S.COLUMN}' için her satırın ebeveyn agreements-LTA ` +
          `kaydı BİLİNMİYOR — sessiz varsayılan (§2.5) yasak. Backfill ` +
          `ayrı bir karar kalemidir.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE ${S.SCHEMA}.${S.TABLE} ADD COLUMN "${S.COLUMN}" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ${S.SCHEMA}.${S.TABLE}
         ADD CONSTRAINT "${S.FK_NAME}"
         FOREIGN KEY ("${S.COLUMN}") REFERENCES ${S.SCHEMA}.agreements(id)
         ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "${S.UQ_NAME}"
         ON ${S.SCHEMA}.${S.TABLE} ("${S.COLUMN}")`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN ${S.SCHEMA}.${S.TABLE}."${S.COLUMN}" IS
        'Z38 §3(a): yaşam döngüsünün kanonik kaydı (main.agreements, agreement_type=LTA). Oran kademesi ona BAĞLI doğar.'`,
    );

    // ── ASSERT — yazılmış bir DDL, uygulandığı anlamına gelmez.
    const verify: Array<{ is_nullable: string }> = await queryRunner.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [S.SCHEMA, S.TABLE, S.COLUMN],
    );
    const verifyFk: Array<{ confdeltype: string }> = await queryRunner.query(
      `SELECT c.confdeltype FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = $2 AND c.conname = $3`,
      [S.SCHEMA, S.TABLE, S.FK_NAME],
    );
    const verifyUq: Array<{ indexname: string }> = await queryRunner.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1 AND tablename = $2 AND indexname = $3`,
      [S.SCHEMA, S.TABLE, S.UQ_NAME],
    );
    if (
      verify.length !== 1 ||
      verify[0].is_nullable !== 'NO' ||
      verifyFk.length !== 1 ||
      verifyFk[0].confdeltype !== 'r' ||
      verifyUq.length !== 1
    ) {
      throw new Error(
        `[1817] ⛔ ASSERT DÜŞTÜ: kolon/FK/UNIQUE beklenen şekilde ` +
          `oluşmadı (kolon=${verify.length}/${verify[0]?.is_nullable}, ` +
          `FK=${verifyFk.length}/${verifyFk[0]?.confdeltype}, ` +
          `UQ=${verifyUq.length}).`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const S = BindLtaAgreementsToAgreements1817000000000;

    const columnRows: Array<{ column_name: string }> = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [S.SCHEMA, S.TABLE, S.COLUMN],
    );

    // NO-OP dalı: kolon zaten yok.
    if (columnRows.length === 0) {
      return;
    }

    // ⛔ İPTAL dalı: bağlanmış satır varsa geri alma bir BİLGİ KAYBIDIR —
    // hangi oran-şartları başlığının hangi yaşam döngüsü kaydına ait olduğu
    // kolonla birlikte kaybolur ve `up()` bir daha kuramaz.
    const [{ cnt }]: Array<{ cnt: string }> = await queryRunner.query(
      `SELECT count(*)::text AS cnt FROM ${S.SCHEMA}.${S.TABLE}`,
    );
    if (cnt !== '0') {
      throw new Error(
        `[1817] ⛔ İPTAL (down): main.${S.TABLE} ${cnt} satır taşıyor. ` +
          `'${S.COLUMN}' düşürülürse bağ geri kurulamaz (bilgi kaybı). ` +
          `Önce satırlar temizlenir ya da backfill kararı alınır.`,
      );
    }

    await queryRunner.query(`DROP INDEX IF EXISTS ${S.SCHEMA}."${S.UQ_NAME}"`);
    await queryRunner.query(
      `ALTER TABLE ${S.SCHEMA}.${S.TABLE} DROP CONSTRAINT IF EXISTS "${S.FK_NAME}"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${S.SCHEMA}.${S.TABLE} DROP COLUMN "${S.COLUMN}"`,
    );
  }
}

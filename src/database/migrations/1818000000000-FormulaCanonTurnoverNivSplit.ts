/**
 * `T-334` — FORMÜL-KANON: `TO`/`NIV` KAVRAM AYRIŞTIRMASI + ROI PAYDASININ BÖLÜNMESİ
 *
 * Hüküm: `docs/brd-v2/04_KARAR_KAYDI.md` `Z65 §1` (`Q2`), `Z65 §3` (`Q3`),
 * `Z66 §1` (`Q6`) · ölçüm: `docs/research/A1_KPI_ESLEME.md` `§1 GRUP 4/5/9/11`
 * · semantik kanon: `docs/research/DEMO_EXCEL_KPI_TACTIC_REFERANSI.md §1`.
 *
 * ── NE DEĞİŞİYOR ──────────────────────────────────────────────────────
 * ```
 * TO  = GSV − TotalSpend(on + off)     ← Excel `BaseTurnover = BaseGSV − BaseTradeSpend`
 * NIV = GSV − TotalSpendOn             ← Excel `PlannedPromoNIV`
 * ```
 * `migration 1781` `NIV` ihtiyacını **`TO` adının üstüne** yazmıştı
 * (`Z65 §0`: `Section_05` derleme-kaybı ⇒ `NIV` grubu listeden düşmüş,
 * ihtiyaç kodda doğmuş, karşılığı olmadığı için `TO`'ya yamanmış).
 * ⛔ Bu bir **geri alma DEĞİL, KAVRAM AYRIŞTIRMASIDIR**: `1781`'in yazdığı
 * formüller **doğrudur** — yalnız adları yanlıştı; oldukları gibi
 * `BASE_NIV`/`PLANNED_NIV`'e **taşınır**, `*_TO` ise `1780`'in (Excel'le
 * birebir olduğu ölçülen) semantiğine **döner**.
 *
 * ```
 * INSERT  BASE_NIV          = BASE_GSV - BASE_LTA_ON                  (order 22)
 * INSERT  PLANNED_NIV       = PLANNED_GSV - PLANNED_ON_INVOICE_SPEND  (order 23)
 * INSERT  INCR_NIV          = PLANNED_NIV - BASE_NIV                  (order 24)
 * UPDATE  BASE_TO           = BASE_GSV - BASE_TOTAL_SPEND             (order 25, sabit)
 * UPDATE  PLANNED_TO        = PLANNED_GSV - TOTAL_PLANNED_SPEND       (order 26, sabit)
 * INSERT  INCR_TO           = PLANNED_TO - BASE_TO                    (order 27)
 * INSERT  INCR_PROMO_SPEND  = external (context-injected)             (order 13)
 * UPDATE  GP_ROI_PCT        = INCR_GP / INCR_PROMO_SPEND * 100        (order 48, sabit)
 * ```
 *
 * ⚠️ **`Q3` (GP tabanı `TO`) BU MIGRATION'DA TEK KARAKTER DEĞİŞTİRMEZ** ve
 * bu bir eksiklik değildir: `BASE_GP = BASE_TO - BASE_COGS` metni Excel'in
 * `BaseGrossProfit = BaseTurnover − BaseCOGS`'uyla **zaten birebirdir**;
 * sapan şey `BASE_TO`'nun **anlamıydı**. Aynısı `GP_MARGIN_PCT` için de
 * geçerli. ⇒ **GP/GM DEĞERLERİ VE RAG RENKLERİ DEĞİŞİR, DIFF'TE HİÇBİR GP
 * SATIRI GÖRÜNMEZ** (`A1 §1 GRUP 9`). Beklenen-değişim listesi task
 * raporundadır.
 *
 * ── `Q6` — ROI PAYDASI: DEĞER DEĞİL, **OKUNAN KALEM** ─────────────────
 * `ADR 0011` (`TOTAL_PLANNED_SPEND`) **GERİ ALINMIYOR — KAPSAMI DARALIYOR**
 * (`0011` `F12` notu · `Z66 §1`): bütçe/`plan.totalSpend` `TOTAL`'ı okumaya
 * **devam eder** (zarf gerçek parayı rezerve eder, LTA dahil); yanlış olan
 * **ROI'nin bütçe kalemini okumasıydı**. ROI artık `INCR_PROMO_SPEND`
 * okur — *yalnız promo · LTA hariç · incremental* (`Z62 §6-3`).
 * ⇒ **Finansal yayılım SIFIR**: `TOTAL_PLANNED_SPEND` satırına ve onu
 * besleyen hiçbir yola dokunulmuyor.
 *
 * 📌 Payda dizgesi burada **düz metin** yazılıdır, `src/common/kpi/
 * roi-denominator.ts` sabitinden **import EDİLMEZ**: uygulanmış bir
 * migration tarihsel bir kayıttır; ileride sabit değişirse bu dosyanın
 * anlamı **değişmemelidir**. Canlı katalogların (seed + `KpiService`) o
 * tek noktadan türediği ayrıca kontrol edilir.
 *
 * ── ÜÇ DURUM AYRIMI (`MIGRATION_SEQUENCE.md` kabul kriteri 1) ─────────
 * ```
 * beklenen  1781+1801 hâli (BASE_TO=NIV formülü, *_NIV satırları YOK) → uygula + assert
 * uygulanmış bu migration'ın hedef hâli                                → NO-OP
 * beklenmeyen  başka herhangi bir formül/eksik kalem                   → ⛔ İPTAL
 * ```
 * Sınıflandırma **tenant başına** yapılır (`main.kpis` tenant-scope'lu).
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

// ── Beklenen (migration ÖNCESİ) hâl ───────────────────────────────────
const PRE_BASE_TO = 'BASE_GSV - BASE_LTA_ON';
const PRE_PLANNED_TO = 'PLANNED_GSV - PLANNED_ON_INVOICE_SPEND';
const PRE_GP_ROI = 'INCR_GP / TOTAL_PLANNED_SPEND * 100';

// ── Hedef (migration SONRASI) hâl ─────────────────────────────────────
const POST_BASE_TO = 'BASE_GSV - BASE_TOTAL_SPEND';
const POST_PLANNED_TO = 'PLANNED_GSV - TOTAL_PLANNED_SPEND';
const POST_GP_ROI = 'INCR_GP / INCR_PROMO_SPEND * 100';

// ── `Q5` — `CPP_OFF_PCT` mekaniğinin ANLATIM METNİ (`main.mechanics`) ──
// Motor kanona döndü; konfigürasyon ekranının okuduğu metin de dönmeli
// (`F8` ailesi: aynı kural iki yerde iki farklı). ⚠️ Bu bir **veri**
// düzeltmesidir; `mechanic.seed.ts` var olan satırın bu alanını
// GÜNCELLEMİYOR (ölçüldü 2026-08-30: `npm run seed` sonrası metin
// değişmedi) ⇒ migration olmadan canlı satır sapmalı kalırdı.
const PRE_CPP_OFF_FORMULA =
  '(PLANNED_GSV - PLANNED_LTA_ON - PLANNED_LTA_OFF - total_on_inv_promos) * entered_value / 100';
const POST_CPP_OFF_FORMULA =
  '(PLANNED_GSV - PLANNED_LTA_ON - total_on_inv_promos) * entered_value / 100';
const PRE_CPP_OFF_DESC_FRAGMENT =
  'Spend = (PLANNED_GSV - PLANNED_LTA_ON - PLANNED_LTA_OFF - on_inv_promos) * value / 100.';
const POST_CPP_OFF_DESC_FRAGMENT =
  'Spend = PLANNED_NIV * value / 100  (NIV = PLANNED_GSV - PLANNED_LTA_ON - on_inv_promos).';

const NEW_CODES = [
  'BASE_NIV',
  'PLANNED_NIV',
  'INCR_NIV',
  'INCR_TO',
  'INCR_PROMO_SPEND',
] as const;

interface KpiRow {
  kpi_code: string;
  formula_text: string;
}

type Verdict = 'APPLY' | 'NOOP';

export class FormulaCanonTurnoverNivSplit1818000000000 implements MigrationInterface {
  // ⚠️ `transaction` BİLEREK VARSAYILAN (= her migration kendi
  // transaction'ında). `1781`/`1801` `false` kullanıyordu çünkü tek
  // guard'lı `UPDATE`'lerdi; burada **sekiz ifade** var ve `İPTAL` dalı
  // ortada fırlayabiliyor. Ölçüldü (ilk koşum, 2026-08-30): `false` ile
  // İPTAL dalı **yarım bir `BASE_NIV` satırı BIRAKTI**. Atomiklik bir
  // tercih değil, bu migration için bir ŞART.

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tenants = (await queryRunner.query(
      `SELECT DISTINCT tenant_id FROM "main"."kpis"`,
    )) as Array<{ tenant_id: string }>;

    for (const { tenant_id } of tenants) {
      const verdict = await classify(queryRunner, tenant_id);
      if (verdict === 'NOOP') continue;

      // ── 1 · NIV kendi kodlarıyla doğar ───────────────────────────────
      await insertKpi(queryRunner, tenant_id, {
        code: 'BASE_NIV',
        name: 'Base NIV',
        group: 'Revenue',
        description:
          'Base net invoice value: BASE_GSV - BASE_LTA_ON (Excel `BaseNIV` — only on-invoice deductions; T-334/Z65 §1)',
        formulaType: 'expression',
        formulaText: 'BASE_GSV - BASE_LTA_ON',
        dependsOn: ['BASE_GSV', 'BASE_LTA_ON'],
        order: 22,
        showInGrid: false,
      });
      await insertKpi(queryRunner, tenant_id, {
        code: 'PLANNED_NIV',
        name: 'Planned NIV',
        group: 'Revenue',
        description:
          'Planned net invoice value: PLANNED_GSV - PLANNED_ON_INVOICE_SPEND (Excel `PlannedPromoNIV`; T-334/Z65 §1)',
        formulaType: 'expression',
        formulaText: 'PLANNED_GSV - PLANNED_ON_INVOICE_SPEND',
        dependsOn: ['PLANNED_GSV', 'PLANNED_ON_INVOICE_SPEND'],
        order: 23,
        showInGrid: false,
      });
      await insertKpi(queryRunner, tenant_id, {
        code: 'INCR_NIV',
        name: 'Incremental NIV',
        group: 'Revenue',
        description:
          'Incremental NIV: PLANNED_NIV - BASE_NIV (Excel `PlannedIncrNIV`; T-334)',
        formulaType: 'expression',
        formulaText: 'PLANNED_NIV - BASE_NIV',
        dependsOn: ['PLANNED_NIV', 'BASE_NIV'],
        order: 24,
        showInGrid: false,
      });

      // ── 2 · TO anlamını geri alır ────────────────────────────────────
      await queryRunner.query(
        `
          UPDATE "main"."kpis"
          SET formula_text    = $2,
              kpi_description = $3,
              depends_on_kpis = $4::jsonb,
              updated_at      = NOW()
          WHERE tenant_id = $1::uuid AND kpi_code = 'BASE_TO'
          RETURNING id
          `,
        [
          tenant_id,
          POST_BASE_TO,
          'Base turnover: BASE_GSV - BASE_TOTAL_SPEND (Excel `BaseTurnover = BaseGSV - BaseTradeSpend`; T-334/Z65 §1)',
          JSON.stringify(['BASE_GSV', 'BASE_TOTAL_SPEND']),
        ],
      );
      await queryRunner.query(
        `
          UPDATE "main"."kpis"
          SET formula_text    = $2,
              kpi_description = $3,
              depends_on_kpis = $4::jsonb,
              updated_at      = NOW()
          WHERE tenant_id = $1::uuid AND kpi_code = 'PLANNED_TO'
          RETURNING id
          `,
        [
          tenant_id,
          POST_PLANNED_TO,
          'Planned turnover: PLANNED_GSV - TOTAL_PLANNED_SPEND (Excel `PlannedPromoTurnover`; T-334/Z65 §1)',
          JSON.stringify(['PLANNED_GSV', 'TOTAL_PLANNED_SPEND']),
        ],
      );
      await insertKpi(queryRunner, tenant_id, {
        code: 'INCR_TO',
        name: 'Incremental Turnover',
        group: 'Revenue',
        description:
          'Incremental turnover: PLANNED_TO - BASE_TO (Excel `PlannedIncrTO`; T-334) — RAG kadranının iTO ekseni (Z66 §2)',
        formulaType: 'expression',
        formulaText: 'PLANNED_TO - BASE_TO',
        dependsOn: ['PLANNED_TO', 'BASE_TO'],
        order: 27,
        showInGrid: false,
      });

      // ── 3 · `Q6` — ROI paydası AYRI KALEM ────────────────────────────
      await insertKpi(queryRunner, tenant_id, {
        code: 'INCR_PROMO_SPEND',
        name: 'Incremental Promo Spend',
        group: 'Spend',
        description:
          'Incremental PROMO spend (LTA HARİÇ): planned promo on+off eksi base promo; context-injected from SpendCalc. ROI paydası — Z66 §1 / ADR 0011 F12',
        formulaType: 'external',
        formulaText: 'INCR_PROMO_SPEND',
        dependsOn: [],
        order: 13,
        showInGrid: false,
      });
      await queryRunner.query(
        `
          UPDATE "main"."kpis"
          SET formula_text    = $2,
              kpi_description = $3,
              depends_on_kpis = $4::jsonb,
              updated_at      = NOW()
          WHERE tenant_id = $1::uuid AND kpi_code = 'GP_ROI_PCT'
          RETURNING id
          `,
        [
          tenant_id,
          POST_GP_ROI,
          'Incremental GP ROI %: INCR_GP / INCR_PROMO_SPEND * 100 (Z66 §1 — payda BÖLÜNDÜ: bütçe TOTAL okur, ROI INCR-PROMO okur; ADR 0011 F12)',
          JSON.stringify(['INCR_GP', 'INCR_PROMO_SPEND']),
        ],
      );

      // ── 4 · ASSERT — hedef hâl gerçekten oluştu ──────────────────────
      // ⛔ Doğrulama **KATALOGU OKUYARAK** yapılır, yazma ifadelerinin
      // DÖNÜŞ DEĞERİNE bakarak değil (`DISIPLIN`: *"bir yazma işleminin
      // dönüş değeri, yazdığının kanıtı değildir"*). Ölçüldü (2026-08-30):
      // `queryRunner.query()` `INSERT ... RETURNING` için satır dizisi,
      // `UPDATE ... RETURNING` için `[rows, count]` döndürüyor — aynı
      // `.length` kontrolü birinde `1`, diğerinde `2` veriyordu. Şekle
      // dayalı sayım bu yüzden TERK EDİLDİ; aşağıdaki okuma **sekiz
      // kalemin de** hedef hâlini tek tek doğrular.
      const after = (await queryRunner.query(
        `SELECT kpi_code, formula_text FROM "main"."kpis" WHERE tenant_id = $1::uuid`,
        [tenant_id],
      )) as KpiRow[];
      const post = classifyRows(after);
      if (post !== 'NOOP') {
        throw new Error(
          `[1818] ⛔ up() SONRASI hedef hâl doğrulanamadı (tenant=${tenant_id}). ` +
            `Migration iptal edilmelidir.`,
        );
      }
    }

    // ── 5 · `Q5`'in METİN tarafı: `main.mechanics.CPP_OFF_PCT` ──────────
    await retextCppOff(
      queryRunner,
      PRE_CPP_OFF_FORMULA,
      POST_CPP_OFF_FORMULA,
      PRE_CPP_OFF_DESC_FRAGMENT,
      POST_CPP_OFF_DESC_FRAGMENT,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await retextCppOff(
      queryRunner,
      POST_CPP_OFF_FORMULA,
      PRE_CPP_OFF_FORMULA,
      POST_CPP_OFF_DESC_FRAGMENT,
      PRE_CPP_OFF_DESC_FRAGMENT,
    );

    const tenants = (await queryRunner.query(
      `SELECT DISTINCT tenant_id FROM "main"."kpis"`,
    )) as Array<{ tenant_id: string }>;

    for (const { tenant_id } of tenants) {
      // ⛔ ÜÇ DURUM AYRIMI — `down()`'ta da, `up()`'taki kadar (review `S4`).
      // Bir ara sürümde `down()` `NEW_CODES`'u KOŞULSUZ siliyor, üç satırı
      // KOŞULSUZ geri yazıyordu; aynı dosyanın `retextCppOff` yarısı ise
      // *"beklenmedik metin ⇒ İPTAL"* diyordu. **Aynı dosyada iki farklı
      // disiplin**, ve geri alma tarafı zayıf olanıydı: `up()`'ın hiç
      // yazmadığı bir hâlin üzerine sessizce yazmak, bir kullanıcı ya da
      // sonraki bir migration'ın kararını siler.
      //   hedef hâl (`up()` uygulanmış)   → geri al
      //   zaten geri alınmış (`PRE` hâli) → NO-OP
      //   başka herhangi bir hâl          → ⛔ İPTAL
      const rows = (await queryRunner.query(
        `SELECT kpi_code, formula_text FROM "main"."kpis" WHERE tenant_id = $1::uuid`,
        [tenant_id],
      )) as KpiRow[];
      const verdict = classifyRows(rows, tenant_id);
      if (verdict === 'APPLY') continue; // zaten `PRE` hâlinde ⇒ NO-OP
      // `classifyRows` üçüncü durumu zaten fırlatır; buraya yalnız
      // `NOOP` (= hedef hâl, geri alınacak) ulaşır.

      // `up()`'ın eklediği satırlar gider (BAŞKA hiçbir satıra dokunulmaz).
      await queryRunner.query(
        `DELETE FROM "main"."kpis" WHERE tenant_id = $1::uuid AND kpi_code = ANY($2::text[])`,
        [tenant_id, NEW_CODES as unknown as string[]],
      );
      await queryRunner.query(
        `
        UPDATE "main"."kpis"
        SET formula_text    = $2,
            kpi_description = $3,
            depends_on_kpis = $4::jsonb,
            updated_at      = NOW()
        WHERE tenant_id = $1::uuid AND kpi_code = 'BASE_TO'
        `,
        [
          tenant_id,
          PRE_BASE_TO,
          'Base net turnover: BASE_GSV - BASE_LTA_ON (BRD NIV semantics — only on-invoice; T-008)',
          JSON.stringify(['BASE_GSV', 'BASE_LTA_ON']),
        ],
      );
      await queryRunner.query(
        `
        UPDATE "main"."kpis"
        SET formula_text    = $2,
            kpi_description = $3,
            depends_on_kpis = $4::jsonb,
            updated_at      = NOW()
        WHERE tenant_id = $1::uuid AND kpi_code = 'PLANNED_TO'
        `,
        [
          tenant_id,
          PRE_PLANNED_TO,
          'Planned net turnover: PLANNED_GSV - PLANNED_ON_INVOICE_SPEND (BRD NIV semantics — only on-invoice deductions; T-008)',
          JSON.stringify(['PLANNED_GSV', 'PLANNED_ON_INVOICE_SPEND']),
        ],
      );
      await queryRunner.query(
        `
        UPDATE "main"."kpis"
        SET formula_text    = $2,
            kpi_description = $3,
            depends_on_kpis = $4::jsonb,
            updated_at      = NOW()
        WHERE tenant_id = $1::uuid AND kpi_code = 'GP_ROI_PCT'
        `,
        [
          tenant_id,
          PRE_GP_ROI,
          'Incremental GP ROI %: INCR_GP / TOTAL_PLANNED_SPEND * 100 (BRD canonical — ADR 0011: bkz. docs/decisions/0011-gp-roi-paydasi-total-planned-spend.md)',
          JSON.stringify(['INCR_GP', 'TOTAL_PLANNED_SPEND']),
        ],
      );

      // ASSERT — geri alma gerçekten `PRE` hâlini üretti (katalogdan OKUNUR).
      const after = (await queryRunner.query(
        `SELECT kpi_code, formula_text FROM "main"."kpis" WHERE tenant_id = $1::uuid`,
        [tenant_id],
      )) as KpiRow[];
      if (classifyRows(after, tenant_id) !== 'APPLY') {
        throw new Error(
          `[1818] ⛔ down() SONRASI \`PRE\` hâli doğrulanamadı (tenant=${tenant_id}).`,
        );
      }
    }
  }
}

/** ⛔ ÜÇ DURUM: beklenen (APPLY) · uygulanmış (NOOP) · başka her şey (THROW). */
async function classify(
  queryRunner: QueryRunner,
  tenantId: string,
): Promise<Verdict> {
  const rows = (await queryRunner.query(
    `SELECT kpi_code, formula_text FROM "main"."kpis" WHERE tenant_id = $1::uuid`,
    [tenantId],
  )) as KpiRow[];
  return classifyRows(rows, tenantId);
}

function classifyRows(rows: KpiRow[], tenantId = '?'): Verdict {
  const byCode = new Map(rows.map((r) => [r.kpi_code, r.formula_text]));
  const newRowsPresent = NEW_CODES.filter((c) => byCode.has(c));

  const isPre =
    byCode.get('BASE_TO') === PRE_BASE_TO &&
    byCode.get('PLANNED_TO') === PRE_PLANNED_TO &&
    byCode.get('GP_ROI_PCT') === PRE_GP_ROI &&
    newRowsPresent.length === 0;

  const isPost =
    byCode.get('BASE_TO') === POST_BASE_TO &&
    byCode.get('PLANNED_TO') === POST_PLANNED_TO &&
    byCode.get('GP_ROI_PCT') === POST_GP_ROI &&
    newRowsPresent.length === NEW_CODES.length &&
    byCode.get('BASE_NIV') === 'BASE_GSV - BASE_LTA_ON' &&
    byCode.get('PLANNED_NIV') === 'PLANNED_GSV - PLANNED_ON_INVOICE_SPEND' &&
    byCode.get('INCR_NIV') === 'PLANNED_NIV - BASE_NIV' &&
    byCode.get('INCR_TO') === 'PLANNED_TO - BASE_TO' &&
    byCode.get('INCR_PROMO_SPEND') === 'INCR_PROMO_SPEND';

  if (isPre) return 'APPLY';
  if (isPost) return 'NOOP';

  throw new Error(
    `[1818] ⛔ İPTAL — KPI kümesi beklenmedik durumda (tenant=${tenantId}). ` +
      `Sessizce geçilmez (MIGRATION_SEQUENCE kabul kriteri 1). Ölçülen: ` +
      `BASE_TO=${JSON.stringify(byCode.get('BASE_TO'))} · ` +
      `PLANNED_TO=${JSON.stringify(byCode.get('PLANNED_TO'))} · ` +
      `GP_ROI_PCT=${JSON.stringify(byCode.get('GP_ROI_PCT'))} · ` +
      `yeni kalemler=[${newRowsPresent.join(',')}]`,
  );
}

async function insertKpi(
  queryRunner: QueryRunner,
  tenantId: string,
  k: {
    code: string;
    name: string;
    group: string;
    description: string;
    formulaType: 'expression' | 'external';
    formulaText: string;
    dependsOn: string[];
    order: number;
    showInGrid: boolean;
  },
): Promise<void> {
  await queryRunner.query(
    `
    INSERT INTO "main"."kpis" (
      id, tenant_id, kpi_code, kpi_name, kpi_group, kpi_description,
      formula_type, formula_text, depends_on_kpis,
      calculation_order, calculation_level,
      display_format, decimal_places,
      show_in_grid, column_order,
      aggregation_method_fu,
      rag_green_threshold, rag_amber_threshold,
      is_active, created_at, updated_at
    ) VALUES (
      uuid_generate_v4(), $1::uuid, $2, $3, $4, $5,
      $6::main.kpis_formula_type_enum, $7, $8::jsonb,
      $9::integer, 'sku'::main.kpis_calculation_level_enum,
      'currency'::main.kpis_display_format_enum, 2,
      $10::boolean, NULL,
      'sum'::main.kpis_aggregation_method_enum,
      NULL, NULL,
      true, NOW(), NOW()
    )
    RETURNING id
    `,
    [
      tenantId,
      k.code,
      k.name,
      k.group,
      k.description,
      k.formulaType,
      k.formulaText,
      JSON.stringify(k.dependsOn),
      k.order,
      k.showInGrid,
    ],
  );
}

/**
 * `CPP_OFF_PCT` mekaniğinin taban ANLATIMINI `from` → `to` çevirir.
 * ⛔ ÜÇ DURUM (aynı disiplin): `from` ⇒ çevir · `to` ⇒ NO-OP ·
 * başka herhangi bir metin ⇒ **İPTAL** (satır elle özelleştirilmiş
 * olabilir; sessizce üzerine yazmak bir kullanıcı kararını siler).
 */
async function retextCppOff(
  queryRunner: QueryRunner,
  from: string,
  to: string,
  descFrom: string,
  descTo: string,
): Promise<void> {
  const rows = (await queryRunner.query(
    `SELECT id, tenant_id, calculation_formula, description
       FROM "main"."mechanics" WHERE code = 'CPP_OFF_PCT'`,
  )) as Array<{
    id: string;
    tenant_id: string;
    calculation_formula: string | null;
    description: string | null;
  }>;

  for (const row of rows) {
    if (row.calculation_formula === to) continue; // NO-OP
    if (row.calculation_formula !== from) {
      throw new Error(
        `[1818] ⛔ İPTAL — mechanics.CPP_OFF_PCT.calculation_formula ` +
          `beklenmedik (tenant=${row.tenant_id}): ` +
          `${JSON.stringify(row.calculation_formula)}. Elle özelleştirilmiş ` +
          `bir metnin üzerine sessizce yazılmaz.`,
      );
    }
    await queryRunner.query(
      `UPDATE "main"."mechanics"
          SET calculation_formula = $2,
              description = CASE WHEN description LIKE $3 THEN replace(description, $4, $5) ELSE description END,
              updated_at = NOW()
        WHERE id = $1::uuid`,
      [row.id, to, `%${descFrom}%`, descFrom, descTo],
    );
  }

  const after = (await queryRunner.query(
    `SELECT calculation_formula FROM "main"."mechanics" WHERE code = 'CPP_OFF_PCT'`,
  )) as Array<{ calculation_formula: string | null }>;
  const bad = after.filter((r) => r.calculation_formula !== to);
  if (bad.length > 0) {
    throw new Error(
      `[1818] ⛔ mechanics.CPP_OFF_PCT metni hedef hâle gelmedi ` +
        `(${bad.length} satır). Migration iptal edilmelidir.`,
    );
  }
}

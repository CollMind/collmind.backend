/**
 * T-325 (parça 2/2) — e2e TAM koşumdan ÖNCE taban temizliği.
 *
 * Ölçülmüş sorun (2026-08-29, `W1` tam koşumu):
 *
 *   Tests: 832 passed / 832    ← HEPSİ YEŞİL
 *   exit                  1    ← ama KIRMIZI (globalTeardown'dan fırladı)
 *     plans              2 → 0   (-2)
 *     plan_skus        104 → 0   (-104)
 *     approval_requests  3 → 2   (-1)
 *
 * Delta'lar NEGATİF ⇒ suite SIZDIRMADI — önceki HEDEFLİ (kısmi,
 * `--testPathPattern` ile tek dosya) e2e koşumlarının bıraktığı artığı
 * TEMİZLEDİ. Kaynak: hedefli koşumların kendi `afterAll` temizliği VARDIR
 * ama yalnızca KENDİ ürettiği satırları bilir — başka bir suite'in
 * `E2E-` önekli fixture'ını görmez. `T-047`/`global-setup.js`'in BAŞLANGIÇ
 * snapshot'ı bu yüzden zaten kirli bir tabanı "temiz" sanıp kaydediyordu;
 * suite kendi `afterAll`'larında bu artığı da silince delta negatif çıktı
 * ve gerçek bir sızıntı gibi okundu.
 *
 * Bu script `npm run test:e2e`'nin (TAM koşum) `global-setup.js`'den ÖNCE
 * çalışan bir ön-adımıdır (bkz. `package.json`'daki `test:e2e` scripti ve
 * `scripts/e2e-run-locked.sh`): taban her zaman SESSİZCE "öyleymiş gibi"
 * kabul edilmez (§2.5) — ÖLÇÜLÜR, kirliyse GÖRÜNÜR şekilde temizlenir,
 * temizlenen her şey BASILIR.
 *
 * YENİDEN YAZMAZ, TAŞIR: `cleanupTestAgreements`/`cleanupTestPlans`/
 * `cleanupSalesActuals` (`test/helpers/seed-e2e.ts`) bugün zaten HER e2e
 * dosyasının kendi `afterAll`'ında çağrılıyor ve aynı `E2E-`/`2027-`
 * önek desenini kullanıyor — bu script SQL'i KOPYALAMAZ, aynı fonksiyonları
 * çağırır (CLAUDE.md §7: aynı yetenek iki kez yazılmasın). Tek eklediği:
 * ÇAĞRIDAN ÖNCE/SONRA satır sayısını ölçüp DELTA'yı bassın — bu fonksiyonlar
 * bugün sessiz (`if (ids.length === 0) return;`).
 */

import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import {
  cleanupTestAgreements,
  cleanupTestPlans,
  cleanupSalesActuals,
} from './helpers/seed-e2e';
import { closeAdminDataSource } from './helpers/admin-datasource';
// CommonJS helper — bkz. e2e-row-count.js dosya başı yorumu (ts-jest'e
// bağımlı olamaz, bu yüzden ayrı bir dosyadır); ts-node burada onu normal
// bir require/import olarak çözer.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connect, resolveFixtureTenantId } = require('./helpers/e2e-row-count');

const DIRTY_TABLES = [
  {
    schema: 'main',
    table: 'plans',
    where: `tenant_id = $1 AND plan_name LIKE 'E2E-%'`,
  },
  {
    schema: 'main',
    table: 'agreements',
    where: `tenant_id = $1 AND agreement_name LIKE 'E2E-%'`,
  },
  {
    schema: 'main',
    table: 'sales_actual_batches',
    where: `tenant_id = $1 AND fiscal_period LIKE '2027-%'`,
  },
];

/**
 * `countDirty`'nin ihtiyaç duyduğu TEK yetenek: parametreli bir sorgu koşup
 * satır dizisi döndürmek. `pg.Client` tipini import etmek bu dosyayı driver
 * sürümüne bağlar; `any` ise `lint-ratchet`'in *"yeni kod LINT-TEMİZ DOĞAR"*
 * kuralını ihlal eder (ve bir tur bu yüzden kırmızı kaldı, `Z82`).
 * ⇒ YAPISAL tip: ne fazlası ne eksiği.
 */
type QueryRunner = {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: Array<{ n: number }> }>;
};

async function countDirty(
  client: QueryRunner,
  tenantId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const { schema, table, where } of DIRTY_TABLES) {
    const res = await client.query(
      `SELECT COUNT(*)::int AS n FROM ${schema}.${table} WHERE ${where}`,
      [tenantId],
    );
    counts[`${schema}.${table}`] = res.rows[0].n;
  }
  return counts;
}

async function main(): Promise<void> {
  console.log('▶ [T-325] e2e taban temizlik ön-kontrolü başlıyor...');

  const client = await connect();
  let tenantId: string;
  let before: Record<string, number>;
  try {
    tenantId = await resolveFixtureTenantId(client);
    before = await countDirty(client, tenantId);
  } finally {
    await client.end();
  }

  const dirtyEntries = Object.entries(before).filter(([, n]) => n > 0);

  if (dirtyEntries.length === 0) {
    console.log(
      '  ✅ taban TEMİZ — önceki koşumlardan E2E-/2027- önekli artık yok',
    );
    return;
  }

  console.log(
    '  ⚠️ taban KİRLİ — önceki (muhtemelen hedefli/kısmi) koşumlardan artık bulundu:',
  );
  for (const [key, n] of dirtyEntries) {
    console.log(`     ${key}: ${n} satır (E2E-/2027- önekli)`);
  }
  console.log(
    '  → temizleniyor (aynı temizlik fonksiyonları, cleanupTestAgreements/' +
      'cleanupTestPlans/cleanupSalesActuals — SESSİZ DEĞİL, bu script ne sildiğini basar)',
  );

  const app = await createTestApp();
  try {
    await cleanupTestAgreements(app, tenantId);
    await cleanupTestPlans(app, tenantId);
    await cleanupSalesActuals(app, tenantId);
  } finally {
    await closeTestApp();
    await closeAdminDataSource();
  }

  const afterClient = await connect();
  let after: Record<string, number>;
  try {
    after = await countDirty(afterClient, tenantId);
  } finally {
    await afterClient.end();
  }

  console.log('  ✅ temizlik SONUCU (silinen satır sayısı, tablo başına):');
  let stillDirty = false;
  for (const key of Object.keys(before)) {
    const delta = before[key] - after[key];
    console.log(
      `     ${key}: ${before[key]} → ${after[key]} (silinen: ${delta})`,
    );
    if (after[key] > 0) {
      stillDirty = true;
    }
  }

  if (stillDirty) {
    // §2.5 sessiz sıfır yasağı: temizlik BEKLENEN etkiyi yaratmadıysa
    // (ör. cleanupTestPlans'ın kapsamadığı yeni bir tablo/desen) bunu
    // sessizce "denedik, olan oldu" diye geçmiyoruz — açık hata.
    throw new Error(
      '[T-325] taban temizliği BEKLENEN etkiyi yaratmadı — yukarıdaki ' +
        'tablo(lar)da hâlâ E2E-/2027- önekli satır var. cleanupTestAgreements/' +
        'cleanupTestPlans/cleanupSalesActuals bu deseni kapsamıyor olabilir ' +
        '(yeni bir fixture türü / yeniden adlandırma T-047 sınıfı bir sızıntı ' +
        'olabilir) — elle incele, SESSİZCE devam etme.',
    );
  }

  console.log('  ✅ taban artık TEMİZ, tam koşum başlayabilir.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('⛔ [T-325] taban temizlik ön-kontrolü BAŞARISIZ:', err);
    process.exit(1);
  });

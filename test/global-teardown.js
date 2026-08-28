/**
 * Jest e2e globalTeardown — T-047 kalıcı satır-sayısı invaryantı (2/2).
 * Bağlam ve tablo seçim gerekçesi için bkz. global-setup.js'in başındaki
 * yorum.
 *
 * Suite'in TÜMÜ bittikten sonra bir kez çalışır: global-setup.js'in diske
 * yazdığı BAŞLANGIÇ satır sayılarını okur, aynı sorguları tekrar çalıştırıp
 * BİTİŞ satır sayılarıyla karşılaştırır. Herhangi bir fark varsa (artış YA
 * DA azalış — azalış da meşru değildir, örn. bir test seed verisini kazara
 * silmiş olabilir) bir Error fırlatır: Jest bunu suite sonuç özetinde
 * gösterir ve process exit code'unu non-zero yapar (CI'da suite'i KIRMIZI
 * yapar) — `npm run test:e2e`'nin "0 total" ile sessizce geçmesi ihtimaline
 * karşı process.exitCode da açıkça set edilir.
 */

const fs = require('fs');
const path = require('path');
const { connect, countRows } = require('./helpers/e2e-row-count');

const SNAPSHOT_PATH = path.join(__dirname, '.e2e-row-count-snapshot.json');
// `T-319`: sabit bir anahtar listesi YOK artık — karşılaştırma
// `before.tables`'ın KENDİ anahtarları üzerinden yapılır (evren
// `pg_catalog`'dan türetilmiş, bkz. e2e-row-count.js). Bu da AYRICA bir
// invaryant: `after.tables`'ta `before.tables`'takiyle BİREBİR aynı anahtar
// kümesi bekleniyor — biri diğerinde yoksa (ör. iki koşum arasında bir
// migration tablo eklemiş/kaldırmışsa) bu da SESSİZCE yutulmaz, açık hata.

module.exports = async function globalTeardown() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    // eslint-disable-next-line no-console
    console.warn(
      '[T-047 invariant] Başlangıç snapshot dosyası bulunamadı — ' +
        'global-setup.js hiç çalışmamış olabilir (örn. --testPathPattern ile ' +
        'globalSetup atlanmışsa). İnvaryant atlanıyor, bu bir PASS değildir.',
    );
    return;
  }

  const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));

  const client = await connect();
  let afterResult;
  try {
    afterResult = await countRows(client, before.tenantId);
  } finally {
    await client.end();
    try {
      fs.unlinkSync(SNAPSHOT_PATH);
    } catch {
      // best-effort cleanup of the snapshot file itself
    }
  }

  const after = afterResult.tables;
  const beforeTables = before.tables;

  // eslint-disable-next-line no-console
  console.log(
    `[T-047/T-319 invariant] BİTİŞ satır sayıları (tenant=Wella Turkey, ` +
      `role=${afterResult.connectedAsRole}):`,
  );
  // eslint-disable-next-line no-console
  console.log('  ' + JSON.stringify(after));

  const beforeKeys = Object.keys(beforeTables).sort();
  const afterKeys = Object.keys(after).sort();
  if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
    const msg =
      '[T-047/T-319 invariant] TABLO EVRENİ suite başlangıcı ile bitişi ' +
      'arasında DEĞİŞTİ (pg_catalog türetimi farklı bir tablo kümesi ' +
      `döndürdü) — başlangıç: [${beforeKeys.join(', ')}], bitiş: ` +
      `[${afterKeys.join(', ')}]. Bu SESSİZCE karşılaştırılmaz.`;
    // eslint-disable-next-line no-console
    console.error(msg);
    process.exitCode = 1;
    throw new Error(msg);
  }

  const diffs = beforeKeys
    .filter((k) => beforeTables[k] !== after[k])
    .map(
      (k) =>
        `${k}: ${beforeTables[k]} -> ${after[k]} (delta ${after[k] - beforeTables[k]})`,
    );

  if (diffs.length > 0) {
    const msg =
      '[T-047/T-060/T-319 invariant] SATIR SAYISI İNVARYANTI İHLAL EDİLDİ — ' +
      'e2e suite başlangıcı ile bitişi arasında aşağıdaki main.* ' +
      '(pg_catalog\'dan türetilmiş TÜM tablolar, tenant-scoped) satır ' +
      'sayısı DEĞİŞTİ (bütçe zarfı sabit kalsa bile bu bir sızıntıdır — ' +
      "bkz. T-047, T-060, T-319):\n  " +
      diffs.join('\n  ') +
      '\nKök neden büyük olasılıkla: (a) bir e2e fixture (agreement/plan) ' +
      "'E2E-' önekini bir rename ile kaybetti (cleanupTestPlans/" +
      "cleanupTestAgreements 'LIKE \\'E2E-%\\'' ile arıyor, test/helpers/" +
      'seed-e2e.ts), (b) bir test kendi ürettiği satırı hiç silmedi/' +
      'temizlemedi, ya da (c) FK\'siz (polimorfik entity_id) bir satır ' +
      'yazan yeni bir kod yolu, cleanupTestPlans/cleanupTestAgreements/' +
      'ilgili suite temizliğinin kapsamına GİRMEDİ (T-060/T-319 sınıfı ' +
      'hata — bkz. test/helpers/e2e-row-count.js).';
    // eslint-disable-next-line no-console
    console.error(msg);
    process.exitCode = 1;
    throw new Error(msg);
  }

  // eslint-disable-next-line no-console
  console.log(
    '[T-047 invariant] PASS — satır sayıları suite öncesi/sonrası birebir aynı.',
  );
};

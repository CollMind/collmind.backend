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
const COUNT_KEYS = ['agreements', 'plans', 'planFus', 'planSkus'];

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
  let after;
  try {
    after = await countRows(client, before.tenantId);
  } finally {
    await client.end();
    try {
      fs.unlinkSync(SNAPSHOT_PATH);
    } catch {
      // best-effort cleanup of the snapshot file itself
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[T-047 invariant] BİTİŞ satır sayıları (tenant=Wella Turkey) — ` +
      `agreements=${after.agreements} plans=${after.plans} ` +
      `plan_fus=${after.planFus} plan_skus=${after.planSkus}`,
  );

  const diffs = COUNT_KEYS.filter((k) => before[k] !== after[k]).map(
    (k) => `${k}: ${before[k]} -> ${after[k]} (delta ${after[k] - before[k]})`,
  );

  if (diffs.length > 0) {
    const msg =
      '[T-047 invariant] SATIR SAYISI İNVARYANTI İHLAL EDİLDİ — e2e suite ' +
      'başlangıcı ile bitişi arasında main.agreements/plans(/plan_fus/plan_skus) ' +
      'satır sayısı DEĞİŞTİ (bütçe zarfı sabit kalsa bile bu bir sızıntıdır — ' +
      "bkz. T-047):\n  " +
      diffs.join('\n  ') +
      '\nKök neden büyük olasılıkla: bir e2e fixture (agreement/plan) ' +
      "'E2E-' önekini bir rename ile kaybetti (cleanupTestPlans/" +
      "cleanupTestAgreements 'LIKE \\'E2E-%\\'' ile arıyor, test/helpers/" +
      'seed-e2e.ts) — ya da bir test kendi ürettiği satırı hiç silmedi/' +
      'temizlemedi.';
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

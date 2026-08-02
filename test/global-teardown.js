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
// T-060: approvalRequests/adminAuditLogs/users eklendi — bkz. global-setup.js
// ve test/helpers/e2e-row-count.js'deki gerekçe (ölçülerek belirlendi).
const COUNT_KEYS = [
  'agreements',
  'plans',
  'planFus',
  'planSkus',
  'approvalRequests',
  'adminAuditLogs',
  'users',
];

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
      `plan_fus=${after.planFus} plan_skus=${after.planSkus} ` +
      `approval_requests=${after.approvalRequests} ` +
      `admin_audit_logs=${after.adminAuditLogs} users=${after.users}`,
  );

  const diffs = COUNT_KEYS.filter((k) => before[k] !== after[k]).map(
    (k) => `${k}: ${before[k]} -> ${after[k]} (delta ${after[k] - before[k]})`,
  );

  if (diffs.length > 0) {
    const msg =
      '[T-047/T-060 invariant] SATIR SAYISI İNVARYANTI İHLAL EDİLDİ — e2e ' +
      'suite başlangıcı ile bitişi arasında main.agreements/plans/plan_fus/' +
      'plan_skus/approval_requests/admin_audit_logs/users satır sayısı ' +
      'DEĞİŞTİ (bütçe zarfı sabit kalsa bile bu bir sızıntıdır — bkz. ' +
      "T-047, T-060):\n  " +
      diffs.join('\n  ') +
      '\nKök neden büyük olasılıkla: (a) bir e2e fixture (agreement/plan) ' +
      "'E2E-' önekini bir rename ile kaybetti (cleanupTestPlans/" +
      "cleanupTestAgreements 'LIKE \\'E2E-%\\'' ile arıyor, test/helpers/" +
      'seed-e2e.ts), (b) bir test kendi ürettiği satırı hiç silmedi/' +
      'temizlemedi, ya da (c) approval_requests/admin_audit_logs delta ise: ' +
      'yeni bir kod yolu bu tabloya main.plans/agreements/' +
      'agreement_transactions\'a FK\'siz (polimorfik entity_id) bir satır ' +
      'yazdı ve cleanupTestPlans/cleanupTestAgreements bu yeni entity_type\'ı ' +
      'kapsamıyor (T-060 sınıfı hata — bkz. test/helpers/e2e-row-count.js).';
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

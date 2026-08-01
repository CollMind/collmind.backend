/**
 * Jest e2e globalSetup — T-047 kalıcı satır-sayısı invaryantı (1/2).
 *
 * KÖK NEDEN (T-047 task raporu): Team Lead'in bu sprint boyunca kullandığı
 * "reset'siz 3 ardışık koşum + ENV-2026-NKA-Q1 reserved sabit" invaryantı
 * yalnızca bütçe ZARFINI (v_budget_summary.reserved_amount) kontrol
 * ediyordu. DRAFT durumunda kalan ve hiçbir bütçe rezerve etmeyen
 * fixture'lar (STA-2026-XXX agreement'lar, 'CAS-WINNER' /
 * 'bump-version-before-delete' / 'bump-before-delete' planları — hepsi
 * optimistic-locking.e2e-spec.ts'de bir PATCH ile 'E2E-' önekini
 * KAYBEDEREK cleanupTestPlans/cleanupTestAgreements'ın (test/helpers/
 * seed-e2e.ts, `... LIKE 'E2E-%'`) görüş alanından çıkıyordu) zarfı hiç
 * değiştirmediği için sızıntı 4 gün (201 agreement + 197 plan satırı)
 * fark edilmedi.
 *
 * Bu dosya, e2e suite'in TÜMÜ (jest-e2e.json testRegex'iyle eşleşen HER
 * .e2e-spec.ts dosyası) çalışmaya başlamadan ÖNCE, bir kez, main.agreements
 * / main.plans / main.plan_fus / main.plan_skus satır sayılarını (yalnızca
 * e2e fixture tenant'ı — "Wella Turkey" — kapsamında) diske yazar.
 * global-teardown.js suite'in TÜMÜ bittikten SONRA aynı sayıları tekrar
 * okur ve KARŞILAŞTIRIR; fark varsa process'i non-zero exit code ile
 * bitirir (CI'da/`npm run test:e2e` çıktısında suite'i KIRMIZI yapar).
 *
 * Neden main.agreements / main.plans / main.plan_fus / main.plan_skus
 * (ve YALNIZ bunlar)?
 *   - main.agreements / main.plans: BRD'nin state machine'ine tabi asıl iş
 *     nesneleri. Suite'in oluşturduğu HER agreement/plan ya testin kendisi
 *     tarafından (DELETE/cancel) ya da cleanupTestAgreements/
 *     cleanupTestPlans tarafından (afterAll, 'E2E-' önekiyle) suite sonuna
 *     kadar temizlenmiş OLMALI — net satır artışı SIFIR olması gereken,
 *     doğrulanabilir bir davranıştır.
 *   - main.plan_fus / main.plan_skus: plans'ın çocuk satırları. Normalde
 *     ON DELETE CASCADE ile plan silinince (hard delete) giderler, ama
 *     plans zaten net-sıfırsa bunlar da örtük olarak net-sıfırdır — burada
 *     ayrıca sayılmalarının amacı, plans satır sayısı YANLIŞLIKLA sabit
 *     kalırken (örn. bir testin bir FU/SKU eklemesi ama planın kendisini
 *     hiç dokunmaması gibi bir senaryoda) çocuk tablo kaymasının TEK
 *     BAŞINA görünür olmasıdır — bağımsız bir çapraz kontrol.
 *   - main.budget_transactions / main.ledger_entries / main.admin_audit_logs
 *     BİLİNÇLİ OLARAK SAYILMIYOR: bunlar append-only/audit tablolarıdır;
 *     bir E2E fixture'ı TAMAMEN silindiğinde (agreement/plan'ın kendisiyle
 *     birlikte) cleanup fonksiyonları bu izleri de temizliyor — ama genel
 *     olarak büyümeleri BRD'nin "audit immutable, her işlem loglanır"
 *     kuralı gereği BEKLENEN ve MEŞRU bir davranıştır (örn. seed'in
 *     APPROVED agreement'ı üzerinde çalışan reversal/settlement testleri
 *     her koşumda yeni audit satırları üretir — bu bir sızıntı DEĞİLDİR).
 *     Bu invaryantın hedefi yalnızca "test'in ürettiği iş nesnesi silinmeden
 *     terk edildi mi" sorusudur.
 *
 * Neden TÜM main.agreements/main.plans (yalnızca 'E2E-' önekli olanlar
 * DEĞİL)? Bu invaryantın TÜM AMACI budur: prefiksiz sızıntıyı (T-047'nin
 * kök nedeni) yakalamak. Yalnızca `E2E-%` sayarsak, prefiksiz bir kayıt hiç
 * sayılmaz ve invaryant T-047'deki gibi yine kör olur — bkz. T-047 task
 * raporundaki "İnvaryantın gerçekten koruduğunun kanıtı" (kasıtlı mutasyon
 * testi: bir teste prefiksiz kayıt bıraktırıp invaryantın KIRMIZI olduğunu
 * kanıtlamak).
 *
 * Neden sadece "Wella Turkey" tenant'ı? T-034 Layer 6 (cross-tenant
 * isolation) kendi geçici tenant'ını (E2E-OPTLOCK-TENANT-B-*) yaratıp
 * kendi afterAll'ında siler (main.tenants FK'sinde main.users ON DELETE
 * CASCADE) — o tenant'ı bu invaryanta dahil etmek yalnız gürültü ekler.
 * Ana fixture tenant'ı kapsamı, mevcut Team Lead invaryantıyla (ENV-2026-
 * NKA-Q1, aynı tenant) tutarlıdır.
 */

const fs = require('fs');
const path = require('path');
const { connect, resolveFixtureTenantId, countRows } = require('./helpers/e2e-row-count');

const SNAPSHOT_PATH = path.join(__dirname, '.e2e-row-count-snapshot.json');

module.exports = async function globalSetup() {
  const client = await connect();
  try {
    const tenantId = await resolveFixtureTenantId(client);
    const counts = await countRows(client, tenantId);

    fs.writeFileSync(
      SNAPSHOT_PATH,
      JSON.stringify({ tenantId, ...counts }, null, 2),
    );

    // eslint-disable-next-line no-console
    console.log(
      `[T-047 invariant] BAŞLANGIÇ satır sayıları (tenant=Wella Turkey) — ` +
        `agreements=${counts.agreements} plans=${counts.plans} ` +
        `plan_fus=${counts.planFus} plan_skus=${counts.planSkus}`,
    );
  } finally {
    await client.end();
  }
};

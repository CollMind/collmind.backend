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
 *
 * T-060: main.approval_requests / main.admin_audit_logs / main.users bu
 * listeye eklendi. Kapsam ÖLÇÜLEREK belirlendi (ezbere değil) — TÜM
 * main.* tabloları bir `npm run test:e2e` koşumu öncesi/sonrası sayıldı,
 * yalnız bu üç tablo (agreements/plans/plan_fus/plan_skus dışında) sıfırdan
 * farklı delta verdi. Tam ölçüm tablosu, kök neden ve "neden RAW count,
 * neden admin_audit_logs artık dahil" gerekçesi için
 * test/helpers/e2e-row-count.js'deki countRows() yorumuna bakınız.
 *
 * `T-319` (2026-08-28) — bu elle yazılmış YEDİ tablo listesi (yukarıdaki
 * dört + T-060'ın üçü) İKİNCİ KEZ kör çıktı: `notifications`'a `Z59`
 * dalgasında gelen ilk üretim yazıcısı 16 satır artık bıraktı ve bu
 * invaryant PASS dedi. Düzeltme bu listeyi SEKİZE çıkarmak DEĞİL — evren
 * artık `pg_catalog`'dan TÜRETİLİYOR (`e2e-row-count.js#resolveCountableTables`).
 * Bu dosya artık HANGİ tabloların sayıldığını sabit yazmıyor; `countRows()`
 * ne döndürürse onu snapshot'lar.
 *
 * `T-324` (`Z61` HÜKÜM (a), 2026-08-28) — `T-319`'un evreni YARIM'dı:
 * `pg_catalog`'dan türetiliyordu AMA `app_runtime`'ın SELECT edebildiği
 * 39/48 tabloyla filtreleniyordu (9 tablo kördü). Sayım bağlantısı
 * `app_migrate`'e taşındı (`e2e-row-count.js#connect`, ölçüldü: 48/48) —
 * evren artık YETKİ FİLTRESİ TAŞIMIYOR. `excludedNoSelect` alanı bu
 * yüzden KALDIRILDI: evren zaten tam olduğu için "SELECT hakkı olmadığı
 * için dışarıda bırakılan" bir küme YOK — bir gün olursa
 * `resolveCountableTables()` bunu sessizce dışarıda bırakmaz, AÇIK hata
 * fırlatır (bkz. e2e-row-count.js).
 */

const fs = require('fs');
const path = require('path');
const { connect, resolveFixtureTenantId, countRows } = require('./helpers/e2e-row-count');
const { acquireLock } = require('./helpers/e2e-run-lock');

const SNAPSHOT_PATH = path.join(__dirname, '.e2e-row-count-snapshot.json');

module.exports = async function globalSetup() {
  // T-325 — TEK-ÇALIŞTIRAN KİLİDİ. İlk adım, DB'ye dokunmadan ÖNCE:
  // T-047/T-319/T-324 satır-sayısı invaryantı zaten "aynı DB'yi paylaşan
  // iki e2e suite'i" senaryosuna karşı KÖRDÜ (T-269 ∥ T-270, T-324 turu) —
  // kilit burada, globalTeardown'da serbest bırakılır (bkz. o dosya).
  //
  // ⚠️ Kilit alındıktan SONRA bu fonksiyonun geri kalanı başarısız olursa
  // (ör. DB'ye bağlanılamıyor) Jest globalTeardown'ı HER ZAMAN çalıştırmayı
  // GARANTİ ETMEZ — bu yüzden setup'ın KENDİ hata yolunda da kilit
  // serbest bırakılır (aşağıdaki dış try/catch), yoksa bir bağlantı hatası
  // bile kilidi kalıcı olarak tutup bir sonraki koşumu bloklardı.
  const releaseLock = acquireLock();

  try {
    const client = await connect();
    try {
      const tenantId = await resolveFixtureTenantId(client);
      const { tables, connectedAsRole } = await countRows(client, tenantId);

      fs.writeFileSync(
        SNAPSHOT_PATH,
        JSON.stringify({ tenantId, tables }, null, 2),
      );

      // eslint-disable-next-line no-console
      console.log(
        `[T-047/T-319/T-324 invariant] BAŞLANGIÇ satır sayıları (tenant=` +
          `Wella Turkey, role=${connectedAsRole}, ${Object.keys(tables).length} ` +
          `tablo, pg_catalog'dan türetilmiş TAM evren — yetki filtresi YOK, ` +
          `T-324/Z61):`,
      );
      // eslint-disable-next-line no-console
      console.log('  ' + JSON.stringify(tables));
    } finally {
      await client.end();
    }
  } catch (err) {
    releaseLock();
    throw err;
  }
};

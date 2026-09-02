/**
 * T-325 (parça 1/2) — TEK-ÇALIŞTIRAN KİLİDİ.
 *
 * Ölçülmüş gerekçe:
 *   T-269 ∥ T-270   paylaşılan AĞAÇ — bir ajanın yarım işi ötekinin ÖLÇÜM
 *                   ARACINI bozdu
 *   T-324 turu      kazayla İKİ e2e paralel koştu; biri auth retry-loop'una
 *                   girip öldürülünce YARIM CLEANUP bıraktı
 *
 * `touches:` disjoint olsa bile aynı e2e suite'i AYNI DB'yi (fixture
 * tenant'ı "Wella Turkey") paylaşır — kilit bunu korur.
 *
 * NEDEN `global-setup.js`/`global-teardown.js`'te (bir shell wrapper'da
 * DEĞİL): Jest'in `globalSetup`/`globalTeardown`'ı, `testRegex`'i
 * eşleştiren HER `jest` çağrısında çalışır — tam koşum (`npm run test:e2e`),
 * hedefli koşum (`--testPathPattern`), ya da doğrudan `npx jest --config
 * ./test/jest-e2e.json <dosya>` fark etmez. Kilidi burada tutmak, bir
 * ajanın orkestratör script'ini (bir wrapper) atlayıp jest'i doğrudan
 * çağırdığı durumlarda da korumayı SÜRDÜRÜR — bir wrapper script'te
 * tutulsaydı bu yol sessizce korumasız kalırdı.
 *
 * Mekanizma (PID dosyası + canlılık kontrolü, `shlock(1)`'in aynısı ama
 * saf Node — üçüncü parti bağımlılık eklemeden):
 *   1. `fs.writeFileSync(path, pid, { flag: 'wx' })` — 'wx' (exclusive
 *      create) ATOMİKTİR: dosya zaten varsa `EEXIST` ile başarısız olur,
 *      iki process aynı anda "yarattım" sanamaz.
 *   2. Dosya zaten varsa içindeki PID'in hâlâ YAŞADIĞI `process.kill(pid, 0)`
 *      ile kontrol edilir (sinyal göndermez, yalnız var/yok sorar).
 *      - Yaşamıyorsa (çökme/kill sonrası kalmış "stale" kilit) → SİLİNİR ve
 *        tekrar denenir. Kilit ÇÖKME SONRASI kalıcı olarak takılı kalmaz.
 *      - Yaşıyorsa → `timeoutMs` dolana kadar kısa aralıklarla beklenir;
 *        dolarsa AÇIK bir hata fırlatılır (SESSİZCE paralel koşmaz, ve
 *        sessizce sonsuza kadar da beklemez).
 *
 * Öz-kilitlenme YOK: bu modül yalnızca `globalSetup`/`globalTeardown`'dan
 * çağrılır — ikisi de aynı jest CLI process'inde bir kez çalışır (worker'lar
 * DEĞİL), yani aynı koşumun test dosyaları/worker'ları kilidi TEKRAR almaya
 * çalışmaz.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCK_PATH = path.join(__dirname, '..', '.e2e-run.lock');
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 dakika
const POLL_INTERVAL_MS = 1000;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: process yok → ölü. EPERM: process var ama başka kullanıcıya
    // ait → yaşıyor sayılır (temkinli taraf: yanlışlıkla stale sanıp
    // silmemek, bir başkasının canlı kilidini kırmaktan daha güvenli).
    return err.code === 'EPERM';
  }
}

function blockingSleep(ms) {
  // Node'da senkron/blocking bir sleep yok; `sleep` komutunu senkron
  // child-process olarak çalıştırmak (execFileSync) event loop'u BİLEREK
  // durdurur — globalSetup zaten senkron bir kilit adımı bekliyor, burada
  // asenkron bir avantaj yok ve basit tutmak daha az hataya açık.
  execFileSync('sleep', [String(ms / 1000)]);
}

/**
 * Kilidi alır (bloklayarak). `timeoutMs` içinde alınamazsa fırlatır.
 * Dönen fonksiyon `release()` — yalnız BU process kilidin sahibiyse siler.
 */
function acquireLock(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const start = Date.now();
  let warnedStale = false;

  for (;;) {
    try {
      fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
      // eslint-disable-next-line no-console
      console.log(`  ✅ [T-325] e2e kilidi alındı (pid ${process.pid}, ${LOCK_PATH})`);
      return () => releaseLock();
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      let heldPid = NaN;
      try {
        heldPid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);
      } catch {
        // Dosya bizim okumamızla diğer process'in silmesi arasında
        // kayboldu (yarış) — bir sonraki turda 'wx' tekrar denenecek.
      }

      if (!isProcessAlive(heldPid)) {
        if (!warnedStale) {
          // eslint-disable-next-line no-console
          console.warn(
            `  ⚠️ [T-325] STALE kilit bulundu (pid ${heldPid} artık yaşamıyor) ` +
              '— siliniyor ve yeniden deneniyor. (Önceki koşum çökmüş/kill ' +
              'edilmiş olabilir; kilit ÇÖKME SONRASI kalıcı takılı kalmaz.)',
          );
          warnedStale = true;
        }
        try {
          fs.unlinkSync(LOCK_PATH);
        } catch {
          // başka bir process bizden önce sildi — sorun değil, tekrar dene
        }
        continue;
      }

      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `[T-325] e2e kilidi ${timeoutMs}ms içinde alınamadı — pid ${heldPid} ` +
            `hâlâ koşuyor (${LOCK_PATH}). İKİ e2e suite'i AYNI DB'yi paylaşır ` +
            '(T-269 ∥ T-270, T-324) — bu SESSİZCE paralel koşulmaz. Önceki ' +
            'koşum bitene kadar bekleyin ya da (gerçekten stale olduğundan ' +
            `eminseniz) elle silin: rm ${LOCK_PATH}`,
        );
      }

      blockingSleep(POLL_INTERVAL_MS);
    }
  }
}

function releaseLock() {
  try {
    const heldPid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    if (heldPid === process.pid) {
      fs.unlinkSync(LOCK_PATH);
      // eslint-disable-next-line no-console
      console.log(`  ✅ [T-325] e2e kilidi serbest bırakıldı (pid ${process.pid})`);
    }
    // Kilit bize ait değilse (ör. bir başkası zaten stale sanıp silmiş ve
    // kendi kilidini kurmuş) DOKUNMAYIZ — başkasının kilidini kırmak,
    // korumak istediğimiz şeyin tam tersini üretir.
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
    // Dosya zaten yok — sorun değil, hedef zaten sağlanmış.
  }
}

module.exports = { acquireLock, releaseLock, LOCK_PATH, isProcessAlive };

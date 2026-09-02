#!/usr/bin/env node
/**
 * T-325 — `e2e-run-lock.js` için DB'siz self-test.
 *
 * Gerçek e2e DB bağlantısı GEREKTİRMEZ (kilit mekanizması saf dosya-sistemi
 * + process seviyesindedir) — bu yüzden `npm run guards`/CI'da her zaman
 * koşabilir, `npm run test:e2e`'nin kendisine bağımlı değildir.
 *
 * Üç senaryo:
 *   1. Boş kilit → hemen alınır.
 *   2. Kilit BAŞKA BİR CANLI PROCESS tarafından tutuluyor → ikinci
 *      `acquireLock` kısa bir timeout içinde AÇIK bir hata ile durur
 *      (sessizce paralel koşmaz, sessizce de vazgeçmez).
 *   3. Kilit dosyası var ama içindeki PID ÖLÜ (stale) → `acquireLock`
 *      onu SİLİP hemen (timeout'u beklemeden) devralır.
 *
 * Çıkış: 0 = üç senaryo da beklendiği gibi · 1 = en az biri beklenmedik.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { acquireLock, releaseLock, LOCK_PATH } = require('./e2e-run-lock');

let failures = 0;

function check(label, cond) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ⛔ ${label}`);
    failures += 1;
  }
}

function cleanupLockFile() {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    // yoksa sorun değil
  }
}

async function main() {
  cleanupLockFile();

  console.log('▶ Senaryo 1 — boş kilit hemen alınır');
  const release1 = acquireLock(5000);
  check('kilit dosyası oluştu', fs.existsSync(LOCK_PATH));
  check(
    'kilit dosyasında BU process\'in pid\'i var',
    fs.readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid),
  );

  console.log('▶ Senaryo 2 — kilit CANLI bir process tarafından tutuluyorken ikinci istek AÇIK HATA ile durur');
  // Ayrı bir child process başlat (kendi PID'i, canlı — parent lock'u tutuyor
  // olduğu için buraya girmeyecek, ama liveness kontrolü kendi PID'ini değil
  // PARENT'in PID'ini görecek — bu yüzden burada sadece parent lock hâlâ
  // TUTULUYORKEN ikinci acquireLock çağrısının kısa sürede hata verdiğini
  // doğruluyoruz).
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `
      const { acquireLock } = require(${JSON.stringify(path.resolve(__dirname, 'e2e-run-lock.js'))});
      try {
        acquireLock(2000);
        process.exit(2); // beklenmedik: almamalıydı
      } catch (err) {
        console.error('CHILD_THREW: ' + err.message);
        process.exit(0);
      }
      `,
    ],
    { encoding: 'utf8' },
  );
  check('ikinci istek zamanında hata ile bitti (exit 0, "kilit alınamadı")', child.status === 0);
  check(
    'hata mesajı T-325 bağlamını taşıyor',
    /kilidi.*alınamadı|kilit/i.test(child.stderr || ''),
  );

  release1();
  check('serbest bırakma sonrası kilit dosyası SİLİNDİ', !fs.existsSync(LOCK_PATH));

  console.log('▶ Senaryo 3 — STALE kilit (ölü pid) tekrar denenmeden hemen devralınır');
  // Gerçekten ölü bir pid üret: kısa bir alt-process başlat, öldür, PID'ini
  // kilit dosyasına yaz.
  const dyingChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  const deadPid = dyingChild.pid;
  await new Promise((resolve) => setTimeout(resolve, 200));
  dyingChild.kill('SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 300));

  fs.writeFileSync(LOCK_PATH, String(deadPid));
  const startedAt = Date.now();
  const release3 = acquireLock(30000); // yüksek timeout — stale tespiti HEMEN olmalı, timeout'u beklememeli
  const elapsedMs = Date.now() - startedAt;
  check('stale kilit HIZLI devralındı (< 5000ms, timeout beklenmedi)', elapsedMs < 5000);
  check(
    'devralınan kilitte artık BU process\'in pid\'i var',
    fs.readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid),
  );
  release3();
  cleanupLockFile();

  console.log();
  if (failures > 0) {
    console.error(`⛔ e2e-run-lock self-test — ${failures} beklenmedik sonuç`);
    process.exit(1);
  }
  console.log('✅ e2e-run-lock self-test — temiz');
}

main().catch((err) => {
  console.error('⛔ self-test çöktü:', err);
  cleanupLockFile();
  process.exit(1);
});

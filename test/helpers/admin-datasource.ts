/**
 * K-2.6.13 KARAR 1 (ürün sahibi, 2026-08-16) — test temizliği için
 * `app_migrate` bağlantısı.
 *
 * `app_runtime`'ın `ledger_entries` / `admin_audit_logs` /
 * `agreement_transactions` üzerindeki DELETE hakkı BİLİNÇLİ OLARAK
 * KALDIRILDI (bkz. `scripts/db-roles/02-runtime-grants.sql`'deki "KARAR 1"
 * notu — kural dayanağı K-2.3.4/K-2.11.6/K-2.11.7/INV-L-003: bu üç tablo
 * bir defter/denetim kaydıdır, `app_runtime` onu SİLEMEZ — ne uygulama
 * kodu bunu yapmaya çalışır ne de DB seviyesinde hakkı vardır).
 *
 * Ölçüldü (2026-08-16): bu üç tablodaki DELETE'in TEK tüketicisi test
 * temizliğiydi (`npm run test:e2e`'nin kendi fixture'larını sildiği
 * `afterAll`/`finally` blokları) — üretim çağrı yolunda hiçbiri hard-DELETE
 * ETMİYOR (bkz. aynı dosyanın grants notu). GRANT kaldırıldığında bu test
 * yardımcıları `permission denied for table {ledger_entries,
 * admin_audit_logs, agreement_transactions}` ile kırıldı; düzeltme
 * `app_runtime`'a GERİ GRANT vermek DEĞİL, bu üç tabloya dokunan DELETE
 * sorgularını `app_migrate` kimlik bilgileriyle (`db-role-env.ts`,
 * `migrateDbCredentials()`) AYRI bir bağlantı üzerinden çalıştırmaktır —
 * tıpkı `npm run seed:cleanup*`'ın zaten yaptığı gibi (`src/database/seeds/
 * cleanup-data.ts`, aynı rol).
 *
 * ⚠️ Yalnız RAW SQL (`.query()`) için — entity metadata TAŞIMAZ (bu üç
 * tablonun TypeORM repository'sine değil, ham DELETE/SELECT'e ihtiyaç var).
 * `entities: []` bilinçli: bir entity listesi taşımak hem gereksiz hem de
 * `typeorm.config.ts`'in `ALL_ENTITIES`'iyle senkron kalma yükü getirirdi.
 *
 * Paylaşılan tek bağlantı (module-level singleton, lazy init) — jest
 * `--runInBand` tek process'te koştuğu için her spec dosyasının kendi
 * bağlantısını açıp kapatması yerine bunu paylaşır.
 */

import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { migrateDbCredentials } from '../../src/config/db-role-env';

config();

let adminDataSource: DataSource | undefined;

function envOr(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * Lazy-init edilmiş, paylaşılan `app_migrate` bağlantısını döner. K-2.6.13d
 * ile aynı sözleşme: `DB_MIGRATE_USERNAME`/`DB_MIGRATE_PASSWORD` eksikse
 * `migrateDbCredentials()` sessizce bir varsayılana düşmez, AÇIK hata
 * fırlatır.
 */
export async function getAdminDataSource(): Promise<DataSource> {
  if (!adminDataSource) {
    const { username, password } = migrateDbCredentials();
    adminDataSource = new DataSource({
      type: 'postgres',
      host: envOr('DB_HOST', 'localhost'),
      port: parseInt(envOr('DB_PORT', '5432'), 10),
      username,
      password,
      database: envOr('DB_DATABASE', ''),
      schema: envOr('DB_SCHEMA', 'main'),
      ssl: envOr('DB_SSL', 'false') === 'false' ? false : undefined,
      entities: [],
      synchronize: false,
      logging: false,
    });
  }
  if (!adminDataSource.isInitialized) {
    await adminDataSource.initialize();
  }
  return adminDataSource;
}

/**
 * Bağlantıyı kapatır. `global-teardown.js`'e KASITLI OLARAK eklenmedi —
 * o dosya CommonJS'tir ve ts-jest'e bağımlı OLAMAZ (bkz. `test/helpers/
 * e2e-row-count.js`'in dosya başı yorumu, aynı kısıt); bu dosyayı (TS,
 * `src/config/db-role-env.ts`'i import eder) oraya `require` etmek o
 * kısıtı ihlal ederdi. Suite `--runInBand` tek process'te koştuğu için
 * kapatılmayan bağlantı process çıkışında zaten kapanır — mevcut
 * `Jest did not exit one second after...` uyarısına (halihazırda başka
 * açık handle'lardan kaynaklanan, bu değişiklikten ÖNCE de var olan bir
 * durum) bir katkı daha, yeni bir hata SINIFI değil. Çağıran isterse
 * kendi `afterAll`'ında çağırabilir.
 */
export async function closeAdminDataSource(): Promise<void> {
  if (adminDataSource?.isInitialized) {
    await adminDataSource.destroy();
  }
  adminDataSource = undefined;
}

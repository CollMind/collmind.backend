/**
 * K-2.6.13a / K-2.6.13d — veritabanı bağlantı KİMLİKLERİ için TEK KAYNAK.
 *
 * İki ayrı rol, iki ayrı env-değişken çifti:
 *   - app_runtime  → NestJS uygulamasının (ve e2e suite'in) çalışma zamanı
 *     bağlantısı. DML, RLS'e tabi, DDL yok, tablo sahibi değil.
 *   - app_migrate  → CLI migration komutları (`migration:run/generate/
 *     revert`) VE seed script'leri (`npm run seed*`, `cleanup*`). DDL
 *     yetkili, tablo sahibi.
 *
 * K-2.6.13d: SESSİZ GERİ DÖNÜŞ YASAK. Bu dosya projedeki TEK yerdir — bir
 * env değişkeni eksikse (`undefined` ya da boş string) burada AÇIK HATA
 * fırlatılır; hiçbir çağıran 'postgres' ya da başka bir ayrıcalıklı role
 * sessizce düşemez. AC#8(a) grep'i bu dosyayı ve onu çağıran dört yeri
 * (typeorm.config.ts, database.module.ts, cleanup-and-seed.ts,
 * cleanup-data.ts) tarar — ayrıcalıklı dizge/kimlik bunların DIŞINDA hiçbir
 * runtime kod yolunda geçmemeli.
 */

export interface DbRoleCredentials {
  username: string;
  password: string;
}

/**
 * Bir env değişkenini okur; tanımsız ya da boş string ise AÇIK HATA
 * fırlatır. `process.env`'den okur (dotenv `config()` bu noktaya kadar
 * zaten çalışmış olmalı — hem CLI girişleri `typeorm.config.ts`'in başında,
 * hem NestJS `ConfigModule.forRoot()` uygulama bootstrap'ında bunu yapar).
 */
export function requireDbEnvVar(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(
      `${key} tanımlı değil. K-2.6.13d: veritabanı bağlantı kimliği eksik ` +
        `ya da boşsa sessizce bir varsayılana (ör. ayrıcalıklı 'postgres' ` +
        `rolüne) düşülmez — bağlantı kurulmadan AÇIK hata verilir. ` +
        `Yerel geliştirmede: 'bash scripts/db-roles-setup.sh' ile rolleri ` +
        `kur, ardından .env'e ${key} değerini ekle.`,
    );
  }
  return value;
}

/** `app_runtime` — NestJS çalışma zamanı bağlantısı (K-2.6.13a). */
export function runtimeDbCredentials(): DbRoleCredentials {
  return {
    username: requireDbEnvVar('DB_RUNTIME_USERNAME'),
    password: requireDbEnvVar('DB_RUNTIME_PASSWORD'),
  };
}

/** `app_migrate` — CLI migration + seed bağlantısı (K-2.6.13a/c). */
export function migrateDbCredentials(): DbRoleCredentials {
  return {
    username: requireDbEnvVar('DB_MIGRATE_USERNAME'),
    password: requireDbEnvVar('DB_MIGRATE_PASSWORD'),
  };
}

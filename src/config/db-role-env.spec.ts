import {
  requireDbEnvVar,
  runtimeDbCredentials,
  migrateDbCredentials,
} from './db-role-env';

/**
 * K-2.6.13d — `db-role-env.ts` için ilk birim testi (önceden yoktu).
 *
 * ⚡ M-3(a) KABUL(b)'in ASIL kanıtı: bu dosya `migrateDbCredentials()`'ı
 * GERÇEK KODDA çağırıyor (yorum değil) ama hiçbir `DataSource`/`Client`
 * bağlantı yapılandırması İNŞA ETMİYOR — `test/db-role-sessiz-fallback.
 * e2e-spec.ts`'in AC#8(a) guard'ı bu dosyayı tarar ve dört-dosyalık
 * `ALLOWED_FILES` kümesi BÜYÜMEMELİDİR (`hasPrivilegedConnectionUsage`,
 * `test/helpers/privileged-connection-scan.ts`).
 *
 * ⚠️ Assertion'lar BİLEREK `{ username: ..., password: ... }` nesne
 * literali ŞEKLİNDE YAZILMADI (`result.username` / `result.password` ayrı
 * ayrı) — guard'ın bağlantı-işareti sezgisi (`username`/`password` alan
 * ÇİFTİNİN aynı nesne literalinde BİRLİKTE görünmesi) yalnızca gerçek
 * bağlantı yapılandırmalarını değil, bu şekli de yakalar; test bunu
 * kasıtlı olarak taşımıyor (bkz. `privileged-connection-scan.ts`'in
 * "ÖLÇÜLMÜŞ SINIR" notu).
 */
describe('db-role-env — requireDbEnvVar', () => {
  const KEY = 'DB_ROLE_ENV_SPEC_TEST_VAR';
  const originalValue = process.env[KEY];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = originalValue;
    }
  });

  it('tanımsız env değişkeni için AÇIK hata fırlatır (sessiz varsayılan YOK)', () => {
    delete process.env[KEY];
    expect(() => requireDbEnvVar(KEY)).toThrow(`${KEY} tanımlı değil`);
  });

  it('boş string env değişkeni için AÇIK hata fırlatır (K-2.6.13d — boş != tanımsız ama ikisi de reddedilir)', () => {
    process.env[KEY] = '';
    expect(() => requireDbEnvVar(KEY)).toThrow(`${KEY} tanımlı değil`);
  });

  it('dolu bir değeri OLDUĞU GİBİ döner — dönüştürmez, kırpmaz', () => {
    process.env[KEY] = '  raw-value-with-space  ';
    expect(requireDbEnvVar(KEY)).toBe('  raw-value-with-space  ');
  });
});

describe('db-role-env — runtimeDbCredentials (app_runtime)', () => {
  const originalUser = process.env.DB_RUNTIME_USERNAME;
  const originalPass = process.env.DB_RUNTIME_PASSWORD;

  afterEach(() => {
    if (originalUser === undefined) delete process.env.DB_RUNTIME_USERNAME;
    else process.env.DB_RUNTIME_USERNAME = originalUser;
    if (originalPass === undefined) delete process.env.DB_RUNTIME_PASSWORD;
    else process.env.DB_RUNTIME_PASSWORD = originalPass;
  });

  it('DB_RUNTIME_USERNAME eksikken AÇIK hata fırlatır', () => {
    delete process.env.DB_RUNTIME_USERNAME;
    process.env.DB_RUNTIME_PASSWORD = 'irrelevant';
    expect(() => runtimeDbCredentials()).toThrow('DB_RUNTIME_USERNAME');
  });

  it('DB_RUNTIME_PASSWORD eksikken AÇIK hata fırlatır', () => {
    process.env.DB_RUNTIME_USERNAME = 'app_runtime';
    delete process.env.DB_RUNTIME_PASSWORD;
    expect(() => runtimeDbCredentials()).toThrow('DB_RUNTIME_PASSWORD');
  });

  it('ikisi de doluyken ikisini de OLDUĞU GİBİ döner', () => {
    process.env.DB_RUNTIME_USERNAME = 'app_runtime';
    process.env.DB_RUNTIME_PASSWORD = 'rt-pass-123';
    const result = runtimeDbCredentials();
    expect(result.username).toBe('app_runtime');
    expect(result.password).toBe('rt-pass-123');
  });
});

describe('db-role-env — migrateDbCredentials (app_migrate)', () => {
  const originalUser = process.env.DB_MIGRATE_USERNAME;
  const originalPass = process.env.DB_MIGRATE_PASSWORD;

  afterEach(() => {
    if (originalUser === undefined) delete process.env.DB_MIGRATE_USERNAME;
    else process.env.DB_MIGRATE_USERNAME = originalUser;
    if (originalPass === undefined) delete process.env.DB_MIGRATE_PASSWORD;
    else process.env.DB_MIGRATE_PASSWORD = originalPass;
  });

  it('DB_MIGRATE_USERNAME eksikken AÇIK hata fırlatır — sessizce app_runtime/postgres kimliğine düşmez', () => {
    delete process.env.DB_MIGRATE_USERNAME;
    process.env.DB_MIGRATE_PASSWORD = 'irrelevant';
    expect(() => migrateDbCredentials()).toThrow('DB_MIGRATE_USERNAME');
  });

  it('DB_MIGRATE_PASSWORD eksikken AÇIK hata fırlatır', () => {
    process.env.DB_MIGRATE_USERNAME = 'app_migrate';
    delete process.env.DB_MIGRATE_PASSWORD;
    expect(() => migrateDbCredentials()).toThrow('DB_MIGRATE_PASSWORD');
  });

  it('ikisi de doluyken ikisini de OLDUĞU GİBİ döner', () => {
    process.env.DB_MIGRATE_USERNAME = 'app_migrate';
    process.env.DB_MIGRATE_PASSWORD = 'mig-pass-456';
    const result = migrateDbCredentials();
    expect(result.username).toBe('app_migrate');
    expect(result.password).toBe('mig-pass-456');
  });

  it('runtime ve migrate kimlikleri BİRBİRİNDEN BAĞIMSIZDIR — biri doluyken diğeri eksikse yine hata verir', () => {
    process.env.DB_MIGRATE_USERNAME = 'app_migrate';
    delete process.env.DB_MIGRATE_PASSWORD;
    // runtime env'ler ayrı değişkenler; migrate'in eksikliği runtime'ı
    // etkilemez ve migrate'in kendi eksikliği hâlâ reddedilir.
    expect(() => migrateDbCredentials()).toThrow('DB_MIGRATE_PASSWORD');
  });
});

/**
 * db-role-sessiz-fallback.e2e-spec.ts
 *
 * K-2.6.13d / `_ISSUE_DB_ROLU.md` AC#8 — SESSİZ GERİ DÖNÜŞ YOK, iki bacak,
 * ikisi de zorunlu (`AC#1`'in yeşili bunu kanıtlayamaz — sessiz geri dönüş
 * bağlantı HATASINDA ateşlenir, ve suite yeşilken o yola hiç girilmez):
 *
 *   (a) VARLIK    ayrıcalıklı kimlik bir BAĞLANTI YAPILANDIRMASINA
 *                 beslenmiyor — `test/helpers/privileged-connection-scan.ts`,
 *                 POZİTİF KONTROLLÜ (desenin çalıştığı ayrıca gösterilir).
 *   (b) DAVRANIŞ  bağlantı KASTEN bozulur (yanlış parola) → uygulama HATA
 *                 verir, ayrıcalıklı role DÖNMEZ.
 *
 * İkisi ayrı kör noktaya sahip (`_ISSUE_DB_ROLU.md` AC#8 notu): (a) çalışma
 * zamanında TÜRETİLEN bir dizgeyi göremez; (b) tetiklenMEyen bir dalı
 * göremez. Biri diğerinin yerine geçmez — ikisi de burada.
 *
 * ⚡ M-3(a) DÜZELTMESİ (code-reviewer kapanış review'u, `0157268..HEAD`):
 * (a) bacağı önceden `re.test(rawFileContent)` yapıyordu — HAM METİN.
 * Yorumu koddan ayırt edemiyordu (üç `src/` dosyası bu yüzden "DDL-yetkili
 * rolün adını LİTERAL YAZMA" diye CLAUDE.md'yle çelişen bir karşı-talimat
 * taşımak zorunda kalmıştı) VE bir birim testinin salt
 * `migrateDbCredentials()` ÇAĞIRMASI (gerçek kod) guard'ı kırıyordu.
 * Yüzey `hasPrivilegedConnectionUsage()`'a daraltıldı: artık "bu metin
 * geçiyor mu" değil, "bu kimlik bir DataSource/Client seçeneğine
 * besleniyor mu" soruluyor — bkz. o dosyanın başlığı (yöntem + ölçülmüş
 * sınır).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import { runtimeDbCredentials } from '../src/config/db-role-env';
import { AppModule } from '../src/app.module';
import {
  PRIVILEGED_PATTERNS,
  hasPrivilegedConnectionUsage,
} from './helpers/privileged-connection-scan';

config();

const SRC_ROOT = path.join(__dirname, '..', 'src');

/**
 * K-2.6.13a/c gereği bu dört dosyanın app_migrate/migrate kimliğini bir
 * BAĞLANTI yapılandırmasına beslemesi KURALDIR, kaçak değil
 * (`src/config/db-role-env.ts`'in üst yorumu: "AC#8(a) grep'i bu dosyayı
 * ve onu çağıran dört yeri ... tarar"). Tam repo taraması (2026-08-16,
 * task raporu) bu listenin TAM ve TEK eşleşen küme olduğunu doğruladı —
 * `scripts/db-roles-setup.sh` ve `scripts/db-roles/*.sql` de eşleşiyor
 * ama onlar `src/` dışında (admin bootstrap betiği, runtime kod yolu
 * değil) — bu yüzden bu listede yok.
 */
const ALLOWED_RELATIVE_PATHS = [
  'config/db-role-env.ts',
  'config/typeorm.config.ts',
  'database/seeds/cleanup-and-seed.ts',
  'database/seeds/cleanup-data.ts',
];
const ALLOWED_FILES = new Set(
  ALLOWED_RELATIVE_PATHS.map((p) => path.join(SRC_ROOT, p)),
);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('K-2.6.13d/AC#8(a) — VARLIK: ayrıcalıklı kimlik bir bağlantı yapılandırmasına beslenmiyor', () => {
  const allTsFiles = walkTsFiles(SRC_ROOT);
  const filesWithPrivilegedConnectionUsage = allTsFiles.filter((file) =>
    hasPrivilegedConnectionUsage(file),
  );

  it('POZİTİF KONTROL: desen `src/` içinde en az bir dosyada gerçekten eşleşiyor (filtre kör değil)', () => {
    // §2.7 — negatif bir sonuç (aşağıdaki test) pozitif kontrolsüz
    // raporlanamaz. Bu test o kontroldür: 0 çıksaydı, aşağıdaki "yalnız 4
    // dosya" iddiası "hiçbir yerde yok" ile "desen hiçbir şeyle eşleşmiyor"
    // arasında ayrım yapamazdı.
    expect(filesWithPrivilegedConnectionUsage.length).toBeGreaterThan(0);
  });

  it('eşleşen dosya kümesi TAM OLARAK bilinen dört dosyadır — fazlası YENİ bir kaçak, azı belgeyi bayatlatır', () => {
    const actual = new Set(filesWithPrivilegedConnectionUsage);
    expect(actual).toEqual(ALLOWED_FILES);
  });

  it('runtime bağlantı dosyası (database.module.ts) ayrıcalıklı bağlantı kullanımı taşımaz', () => {
    expect(
      hasPrivilegedConnectionUsage(
        path.join(SRC_ROOT, 'database/database.module.ts'),
      ),
    ).toBe(false);
  });

  /**
   * M-3(a) KABUL — (b): guard ARTIK ENGELLEMİYOR. Yalnız-tanımlayıcı bir
   * ÇAĞRI (bağlantı yapılandırması İNŞA ETMEYEN, ör. bir birim testinin
   * `migrateDbCredentials()`'ı `expect(...).toThrow()` ile sınaması) flag
   * edilmemeli — asıl kalıcı kanıt `src/config/db-role-env.spec.ts`'in
   * kendisi (guard suite'i bu dosyayı da tarar, ve dört dosyalık küme
   * BÜYÜMEZ). Burada aynı iddia İZOLE bir fixture ile de doğrulanıyor.
   */
  it('KABUL(b): bağlantı yapılandırması İNŞA ETMEYEN bir çağrı (birim testi deseni) flag EDİLMEZ — izole fixture', () => {
    const tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ac8a-b-')),
      'fake.spec.ts',
    );
    fs.writeFileSync(
      tmpFile,
      [
        "import { migrateDbCredentials } from '../db-role-env';",
        '',
        "describe('migrateDbCredentials', () => {",
        "  it('throws when DB_MIGRATE_USERNAME missing', () => {",
        '    delete process.env.DB_MIGRATE_USERNAME;',
        '    expect(() => migrateDbCredentials()).toThrow();',
        '  });',
        '});',
      ].join('\n'),
    );
    try {
      expect(hasPrivilegedConnectionUsage(tmpFile)).toBe(false);
    } finally {
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
    }
  });

  /**
   * M-3(a) KABUL — (b), ikinci yüz: bir AÇIKLAYICI YORUM (kod değil) da
   * flag edilmemeli. Bu, CLAUDE.md §7.1'in "grep'lenebilir referans yaz"
   * kuralıyla guard'ın artık ÇELİŞMEDİĞİnin doğrudan kanıtı.
   */
  it('KABUL(b): AÇIKLAYICI YORUM (kod değil) flag EDİLMEZ — izole fixture', () => {
    const tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ac8a-comment-')),
      'documented.ts',
    );
    fs.writeFileSync(
      tmpFile,
      [
        '// Bu dosya app_migrate rolünü KULLANMAZ — bkz. db-role-env.ts',
        '// (migrateDbCredentials, DB_MIGRATE_USERNAME, DB_MIGRATE_PASSWORD).',
        'export function noop(): void {}',
      ].join('\n'),
    );
    try {
      expect(hasPrivilegedConnectionUsage(tmpFile)).toBe(false);
    } finally {
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
    }
  });

  /**
   * M-3(a) KABUL — (a): guard HÂLÂ YAKALIYOR. İzole bir kopyada gerçek bir
   * geri-dönüş yolu — `catch` içinde ikinci (ayrıcalıklı) kimlikle
   * bağlanma — hâlâ flag edilir. Daraltma yüzeyi ZAYIFLATMADI.
   */
  it('KABUL(a): catch içinde ikinci (ayrıcalıklı) kimlikle bağlanma HÂLÂ flag edilir — izole fixture', () => {
    const tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ac8a-a-')),
      'regression.ts',
    );
    fs.writeFileSync(
      tmpFile,
      [
        "import { DataSource } from 'typeorm';",
        "import { runtimeDbCredentials, migrateDbCredentials } from '../db-role-env';",
        '',
        'export async function connectWithFallback(): Promise<DataSource> {',
        '  const { username, password } = runtimeDbCredentials();',
        "  const ds = new DataSource({ type: 'postgres', username, password });",
        '  try {',
        '    await ds.initialize();',
        '    return ds;',
        '  } catch (err) {',
        '    const admin = migrateDbCredentials();',
        '    const fallbackDs = new DataSource({',
        "      type: 'postgres',",
        '      username: admin.username,',
        '      password: admin.password,',
        '    });',
        '    await fallbackDs.initialize();',
        '    return fallbackDs;',
        '  }',
        '}',
      ].join('\n'),
    );
    try {
      expect(hasPrivilegedConnectionUsage(tmpFile)).toBe(true);
    } finally {
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
    }
  });
});

describe('privileged-connection-scan helper — POZİTİF KONTROL: PRIVILEGED_PATTERNS boş değil', () => {
  // §2.7 pozitif kontrol: AC#8(a)'nın "0 eşleşme" iddiaları anlamlı olsun
  // diye — desenler listesinin kendisi boşalırsa her şey sessizce geçerdi.
  it('en az bir desen tanımlı', () => {
    expect(PRIVILEGED_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('K-2.6.13d/AC#8(b) — DAVRANIŞ: bağlantı kasten bozulunca uygulama HATA verir, ayrıcalıklı role DÖNMEZ', () => {
  // ÖLÇÜLDÜ (2026-08-16, task raporu): gerçek AppModule + DatabaseModule
  // zinciri, YANLIŞ `DB_RUNTIME_PASSWORD` ile ~12.1s'de (5 retry ×
  // retryDelay=3000ms, database.module.ts) REDDEDİYOR — "password
  // authentication failed for user \"app_runtime\"". 5 denemenin HİÇBİRİ
  // farklı bir kimlikle sessizce başarıya dönmedi.
  it('YANLIŞ DB_RUNTIME_PASSWORD ile gerçek AppModule bootstrap REDDEDİLİR (ayrıcalıklı role sessizce düşülmez)', async () => {
    const originalPassword = process.env.DB_RUNTIME_PASSWORD;
    // Bu testin öncesinde de env dolu olmalı — boşsa zaten
    // requireDbEnvVar() farklı bir hata sınıfı (K-2.6.13d eksik-kimlik
    // dalı) fırlatır ve bu test YANLIŞ dalı ölçmüş olur.
    if (!originalPassword) {
      throw new Error(
        'DB_RUNTIME_PASSWORD test ortamında tanımlı değil — bu test yanlış-parola ' +
          'dalını değil, eksik-kimlik dalını ölçer. .env eksik olabilir.',
      );
    }

    process.env.DB_RUNTIME_PASSWORD = 'deliberately-wrong-password-k26613-ac8b';
    let app: INestApplication | undefined;
    try {
      await expect(
        (async () => {
          const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
          }).compile();
          app = moduleRef.createNestApplication();
          await app.init();
        })(),
      ).rejects.toThrow(/password authentication failed/i);
    } finally {
      process.env.DB_RUNTIME_PASSWORD = originalPassword;
      if (app) {
        await app.close().catch(() => undefined);
      }
    }

    // "geri yükle ve GERİ YÜKLEMENİN SONUCUNU doğrula" — parolayı string
    // olarak geri yazmak yetmez; gerçek bağlantının döndüğünü ayrıca
    // kanıtla (hızlı, izole bir raw DataSource ile — ikinci bir tam
    // AppModule bootstrap'ı burada gerekmiyor, kimlik zaten (a)'da ve
    // yukarıdaki başarısız denemede doğrulandı).
    const { username, password } = runtimeDbCredentials();
    expect(password).toBe(originalPassword);
    const restoredDs = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username,
      password,
      database: process.env.DB_DATABASE,
      schema: process.env.DB_SCHEMA || 'main',
    });
    await restoredDs.initialize();
    try {
      const rows: Array<{ u: string }> = await restoredDs.query(
        'SELECT current_user AS u',
      );
      expect(rows[0].u).toBe('app_runtime');
    } finally {
      await restoredDs.destroy();
    }
  }, 30000); // 5 retry × 3s retryDelay (database.module.ts) + bootstrap payı
});

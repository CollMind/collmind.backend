/**
 * db-role-sessiz-fallback.e2e-spec.ts
 *
 * K-2.6.13d / `_ISSUE_DB_ROLU.md` AC#8 — SESSİZ GERİ DÖNÜŞ YOK, iki bacak,
 * ikisi de zorunlu (`AC#1`'in yeşili bunu kanıtlayamaz — sessiz geri dönüş
 * bağlantı HATASINDA ateşlenir, ve suite yeşilken o yola hiç girilmez):
 *
 *   (a) VARLIK    ayrıcalıklı dizge/kimlik runtime kod yolunda SIFIR kez
 *                 geçiyor — grep, POZİTİF KONTROLLÜ (desenin çalıştığı
 *                 ayrıca gösterilir).
 *   (b) DAVRANIŞ  bağlantı KASTEN bozulur (yanlış parola) → uygulama HATA
 *                 verir, ayrıcalıklı role DÖNMEZ.
 *
 * İkisi ayrı kör noktaya sahip (`_ISSUE_DB_ROLU.md` AC#8 notu): (a) çalışma
 * zamanında TÜRETİLEN bir dizgeyi göremez; (b) tetiklenMEyen bir dalı
 * göremez. Biri diğerinin yerine geçmez — ikisi de burada.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { config } from 'dotenv';
import { runtimeDbCredentials } from '../src/config/db-role-env';
import { AppModule } from '../src/app.module';

config();

const SRC_ROOT = path.join(__dirname, '..', 'src');

/**
 * Ayrıcalıklı kimlik/kimlik-bilgisi desenleri — K-2.6.13d "sessiz geri
 * dönüş" adayları. `type: 'postgres'` (TypeORM sürücü tipi, HER postgres
 * bağlantısında zorunlu boilerplate — runtime dahil) kasıtlı olarak
 * DIŞARIDA: bu bir rol/kimlik değil, bir sürücü seçimidir (ölçüldü:
 * `database.module.ts:26`'da da geçiyor ve bu MEŞRU).
 */
const PRIVILEGED_PATTERNS: RegExp[] = [
  /\bapp_migrate\b/,
  /\bmigrateDbCredentials\b/,
  /\bDB_MIGRATE_USERNAME\b/,
  /\bDB_MIGRATE_PASSWORD\b/,
  /\bDB_ADMIN_USERNAME\b/,
  /\bDB_ADMIN_PASSWORD\b/,
];

/**
 * K-2.6.13a/c gereği bu dört dosyanın app_migrate/migrate kimliğine atıf
 * vermesi KURALDIR, kaçak değil (`src/config/db-role-env.ts`'in üst
 * yorumu: "AC#8(a) grep'i bu dosyayı ve onu çağıran dört yeri ... tarar").
 * Tam repo taraması (2026-08-16, task raporu) bu listenin TAM ve TEK
 * eşleşen küme olduğunu doğruladı — `scripts/db-roles-setup.sh` ve
 * `scripts/db-roles/*.sql` de eşleşiyor ama onlar `src/` dışında (admin
 * bootstrap betiği, runtime kod yolu değil) — bu yüzden bu listede yok.
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

describe('K-2.6.13d/AC#8(a) — VARLIK: ayrıcalıklı kimlik runtime kod yolunda yok', () => {
  const allTsFiles = walkTsFiles(SRC_ROOT);
  const filesWithPrivilegedRef = allTsFiles.filter((file) => {
    const content = fs.readFileSync(file, 'utf8');
    return PRIVILEGED_PATTERNS.some((re) => re.test(content));
  });

  it('POZİTİF KONTROL: desen `src/` içinde en az bir dosyada gerçekten eşleşiyor (filtre kör değil)', () => {
    // §2.7 — negatif bir sonuç (aşağıdaki test) pozitif kontrolsüz
    // raporlanamaz. Bu test o kontroldür: 0 çıksaydı, aşağıdaki "yalnız 4
    // dosya" iddiası "hiçbir yerde yok" ile "desen hiçbir şeyle eşleşmiyor"
    // arasında ayrım yapamazdı.
    expect(filesWithPrivilegedRef.length).toBeGreaterThan(0);
  });

  it('eşleşen dosya kümesi TAM OLARAK bilinen dört dosyadır — fazlası YENİ bir kaçak, azı belgeyi bayatlatır', () => {
    const actual = new Set(filesWithPrivilegedRef);
    expect(actual).toEqual(ALLOWED_FILES);
  });

  it('runtime bağlantı dosyası (database.module.ts) ayrıcalıklı kimliğe SIFIR referans içerir', () => {
    const content = fs.readFileSync(
      path.join(SRC_ROOT, 'database/database.module.ts'),
      'utf8',
    );
    for (const re of PRIVILEGED_PATTERNS) {
      expect(content).not.toMatch(re);
    }
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

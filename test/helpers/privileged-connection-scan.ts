/**
 * K-2.6.13d/AC#8(a) — DARALTILMIŞ tarayıcı (M-3(a) düzeltmesi,
 * code-reviewer kapanış review'u, `0157268..HEAD`).
 *
 * ÖNCEKİ tasarım `re.test(rawFileContent)` yapıyordu: HAM METİN taraması.
 * İki bedeli vardı:
 *   1. Yorumu koddan AYIRT EDEMİYORDU — bir açıklayıcı yorum (CLAUDE.md'nin
 *      istediği türden, `§7.1` "grep'lenebilir referans yaz" kuralına
 *      uyan) guard'ı KIRIYORDU. Bu yüzden `src/` altındaki üç dosya
 *      "DDL-yetkili rolün adını LİTERAL YAZMA" diye bir karşı-talimat
 *      taşımak ZORUNDA kalmıştı — CLAUDE.md'nin kendisiyle çelişen bir
 *      durum.
 *   2. Sorduğu soru "bu METİN dosyada geçiyor mu" idi, "bu KİMLİK bir
 *      bağlantı yapılandırmasına besleniyor mu" değil. Bir birim testinin
 *      salt `migrateDbCredentials()` ÇAĞIRMASI (gerçek kod, yorum değil —
 *      örn. `src/config/db-role-env.spec.ts`) guard'ı KIRIYORDU, çünkü o
 *      çağrı da düz metin taramasına yakalanıyordu.
 *
 * YENİ tasarım iki adım:
 *   1. TypeScript printer ile YORUMLARI SİL — kaynağı AST'ten
 *      `removeComments: true` ile yeniden yazdır. Bir açıklayıcı yorum
 *      artık HİÇBİR ZAMAN eşleşmez (AST düzeyinde kod değildir).
 *   2. Kalan (yalnız kod) metinde İKİ koşulu BİRLİKTE ara:
 *        (a) BAĞLANTI İŞARETİ — `new DataSource(`, `createConnection(`,
 *            `TypeOrmModule.forRoot(Async)?(`, ya da bir nesne literalinin
 *            `username`/`password` alan çiftini (keyed ya da shorthand)
 *            BİRLİKTE taşıması.
 *        (b) AYRICALIKLI DESEN — `PRIVILEGED_PATTERNS`'ten biri.
 *      İkisi de varsa dosya "ayrıcalıklı bağlantı kullanımı" taşıyor sayılır.
 *
 * ⚠️ ÖLÇÜLMÜŞ SINIR (CLAUDE.md "kapsam maskelemesi" kuralı — bir küme
 * hakkında sonuç yazılıyorsa kümenin nasıl sınırlandığı aynı cümlede
 * yazılır): granülerlik DOSYA seviyesidir, fonksiyon/blok seviyesi DEĞİL.
 * Yani bir dosyada ayrıcalıklı desen ile bağlantı işareti birbirinden
 * BAĞIMSIZ iki noktada bulunsa bile dosya flag edilir — guard "bu ikisi
 * aynı ifadede mi" diye sormaz, "bu ikisi aynı DOSYADA birlikte var mı"
 * diye sorar. Bu bilinçli bir kapsam kararı: bu guard'ın amacı gürültüsüz
 * bir HAYIR üretmek (yorum ve izole çağrılar artık geçmesin), ve bir
 * dosyada ayrıcalıklı kimlik erişimi ile bağlantı kurma davranışının
 * BİRLİKTE varlığı zaten incelemeyi hak eder — daha dar (ifade/blok
 * seviyesi) bir granülerlik bu turun kapsamı dışında bırakıldı.
 *
 * Ölçüldü (2026-08-16): repo genelinde (`src/`, 479 dosya) bu tarama
 * ~0.5 saniyede tamamlanıyor — e2e suite'in zaman aşımını riske atmıyor.
 */

import * as fs from 'fs';
import * as ts from 'typescript';

/**
 * Ayrıcalıklı kimlik/kimlik-bilgisi desenleri — K-2.6.13d "sessiz geri
 * dönüş" adayları. `type: 'postgres'` (TypeORM sürücü tipi, HER postgres
 * bağlantısında zorunlu boilerplate — runtime dahil) kasıtlı olarak
 * DIŞARIDA: bu bir rol/kimlik değil, bir sürücü seçimidir.
 */
export const PRIVILEGED_PATTERNS: RegExp[] = [
  /\bapp_migrate\b/,
  /\bmigrateDbCredentials\b/,
  /\bDB_MIGRATE_USERNAME\b/,
  /\bDB_MIGRATE_PASSWORD\b/,
  /\bDB_ADMIN_USERNAME\b/,
  /\bDB_ADMIN_PASSWORD\b/,
];

const CONNECTION_MARKER_PATTERNS: RegExp[] = [
  /\bnew\s+DataSource\s*\(/,
  /\bcreateConnection\s*\(/,
  /TypeOrmModule\.forRoot(?:Async)?\s*\(/,
];

/**
 * Verilen kaynağı AST'ten (`removeComments: true`) yeniden yazdırır —
 * sonuç yalnız KOD taşır, hiçbir yorum (satır içi, blok, JSDoc) içermez.
 * Biçimlendirme değişebilir (printer kendi stiliyle yazar); tanımlayıcı
 * metinler (identifier/string literal) DEĞİŞMEZ, yalnız bunlar aranıyor.
 */
export function stripComments(fileName: string, sourceText: string): string {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const printer = ts.createPrinter({ removeComments: true });
  return printer.printFile(sourceFile);
}

/** Yalnız-kod metninde bir "bağlantı yapılandırması" işareti var mı. */
export function hasConnectionMarker(codeOnlyText: string): boolean {
  if (CONNECTION_MARKER_PATTERNS.some((re) => re.test(codeOnlyText))) {
    return true;
  }
  // Keyed (`username: x`) ya da shorthand (`username,`/`username }`) nesne
  // literali alanı — ikisi BİRLİKTE, `type: 'postgres'` config nesnelerinin
  // ortak şekli.
  return (
    /\busername\s*[:,}]/.test(codeOnlyText) &&
    /\bpassword\s*[:,}]/.test(codeOnlyText)
  );
}

/** Yalnız-kod metninde bir ayrıcalıklı kimlik deseni var mı. */
export function hasPrivilegedPattern(codeOnlyText: string): boolean {
  return PRIVILEGED_PATTERNS.some((re) => re.test(codeOnlyText));
}

/**
 * Bir dosyanın "ayrıcalıklı bağlantı kullanımı" taşıyıp taşımadığını
 * döner — dosya başı yorumdaki iki koşulun BİRLİKTE sağlanması.
 */
export function hasPrivilegedConnectionUsage(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf8');
  const codeOnly = stripComments(filePath, raw);
  return hasConnectionMarker(codeOnly) && hasPrivilegedPattern(codeOnly);
}

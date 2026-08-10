/**
 * T-107 adım 2 — GERÇEK bir `.xlsx` yüklemesi, gerçek HTTP, gerçek
 * `FileInterceptor`, gerçek DB satırı. Bu dosya kapatılmadan önce ölçülen
 * boşluk: `test/`de üç importer'a (customer, on-invoice, off-invoice) giden
 * HİÇBİR e2e yoktu — hepsi `Buffer.from(csv)` gönderiyordu
 * (`sales-actuals.e2e-spec.ts`, `on-invoice-split-envelope.e2e-spec.ts`, …).
 * `raw: true`'nun uyandırdığı beş noktanın (`pick-cell.ts` docstring'i) hepsi
 * tam olarak XLSX yolunda yaşıyordu — CSV hiçbir zaman bu kod yolundan
 * geçmiyor (`csv-parser`, `sheet_to_json` değil).
 *
 * Bu dosya `customer/services/file-parser.service.ts`'in PUBLIC yüzeyini
 * (`parseExcel`), gerçek bir `XLSX.write` çıktısı buffer'ı ile,
 * `POST /customers/import`'a kadar tek bir zincirde kanıtlıyor:
 *   multipart upload -> FileInterceptor -> parseExcel -> mapToCustomerDtos
 *   -> CustomerService.importFromFile -> DB INSERT.
 *
 * Kapsadığı matris (task'ın açık kabul kriteri):
 *   - baştaki sıfırlı KOD (`E2E-T107-0079-...`) — string hücre, dönüşmeden
 *   - gerçek `0`, alias zincirinin İLK başlığıyla (`creditLimit`)
 *   - gerçek `0`, alias zincirinin SON başlığıyla (`CREDIT_LIMIT`)
 *   - gerçek `false`, İLK başlıkla (`isVip`)
 *   - gerçek `false`, SON başlıkla (`IS_VIP`)
 *   - bir tarih hücresi, GÖRÜNÜM biçimi `dd.mm.yyyy` (SheetJS `z` — raw:true
 *     altında bu biçim asla okunmaz, yalnız ham seri; `excelSerialToIsoDate`
 *     görüntü biçiminden bağımsız doğru sonucu üretmeli)
 *   - bir BOŞ satır ortada — satır numaralarının ONDAN SONRAKİ satırlar için
 *     kaymadığını kanıtlar (T-121 B4'ün aynısı, ama bu sefer XLSX->DB
 *     zincirinin ucunda)
 *   - bir BOZUK tarih (`"3/4/26"`, ABD sırası/belirsiz) — satır-bazlı hata
 *     kanalının (row-level `errors[]`, doğru `row` numarasıyla) gerçek HTTP
 *     yanıtında da çalıştığını kanıtlar; §2.5: satır sessizce atlanmıyor,
 *     `errors[]`'a düşüyor.
 *
 * Fixture izolasyonu: tüm satırlar `E2E-T107-` önekli `code` taşır;
 * `afterAll` bu önekle eşleşen HER ŞEYİ siler — try/finally ile, bir
 * assertion ortada patlarsa bile (T-113 dersi). `main.customers` T-047 satır
 * sayısı invaryantının (`test/helpers/e2e-row-count.js`) kapsamında DEĞİL
 * (ölçüldü: `countRows()` yalnız agreements/plans/plan_fus/plan_skus/
 * approval_requests/admin_audit_logs/users sayıyor) — yani bu dosyanın
 * temizliği invaryant tarafından DOĞRULANMIYOR, tamamen bu `afterAll`'a
 * bağlı. Bu, invaryantı genişletmek için ayrı bir task'lık bulgu, bu
 * task'ın kapsamı değil.
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';

describe('T-107 adım 2 — gerçek .xlsx yüklemesi (POST /customers/import)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const CODE_PREFIX = 'E2E-T107-';
  const CODE_A = `${CODE_PREFIX}0079-${RUN_ID}`; // leading-zero-looking code
  const CODE_B = `${CODE_PREFIX}B-${RUN_ID}`;
  const CODE_C = `${CODE_PREFIX}C-${RUN_ID}`; // broken-date row, never created

  /**
   * Serial 46115 -> 2026-04-03 (T-107 adım 1's own reference battery uses
   * 46037 -> 2026-01-15; this is 78 days later, independently confirmed via
   * `excelSerialToIsoDate(46115)` before being relied on here). The cell's
   * OWN number format (`z`) is deliberately `dd.mm.yyyy` — a Turkish display
   * format `raw: false` could not have carried as a parseable string
   * (T-107 task note) — to prove `raw: true` reads the value independently
   * of that display format.
   */
  const DATE_SERIAL = 46115;
  const EXPECTED_ISO_DATE = '2026-04-03';

  function buildXlsxBuffer(): Buffer {
    const rows: unknown[][] = [
      [
        'code',
        'name',
        'channel',
        'creditLimit',
        'CREDIT_LIMIT',
        'isVip',
        'IS_VIP',
        'city',
        'contractStartDate',
      ],
      // Row A (sheet row 2): leading-zero-looking code, real 0 / real false
      // through the FIRST alias spelling, a genuine date cell.
      [
        CODE_A,
        'T-107 Row A',
        'RETAIL',
        0,
        null,
        false,
        null,
        'İstanbul',
        DATE_SERIAL,
      ],
      // Sheet row 3: BLANK — every cell absent. Proves row numbers below do
      // not shift (T-121 B4, exercised end-to-end here).
      [],
      // Row B (sheet row 4): real 0 / real false through the LAST alias
      // spelling — pins the exact shape `pick-cell.ts`'s docstring measures
      // (a real `0`/`false` surviving a non-first header spelling).
      // MEASURED (T-107 adım 2 review, B4 — `pickCell` mutated back to an
      // `a || b || c` chain): this row's assertions stay GREEN under that
      // mutation, not red — being the chain's own LAST operand, `0`/`false`
      // here have nothing after them to be overridden by, so `||` and
      // `pickCell` agree. Row A (FIRST alias, above) is the one that
      // distinguishes; see its own assertion's test title below.
      [CODE_B, 'T-107 Row B', 'RETAIL', null, 0, null, false, 'Ankara', null],
      // Row C (sheet row 5): unreadable date text (US-order/ambiguous) —
      // must surface as a ROW-LEVEL error, not silently drop the row or
      // reject the whole file.
      [
        CODE_C,
        'T-107 Row C',
        'RETAIL',
        null,
        null,
        null,
        null,
        'İzmir',
        '3/4/26',
      ],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    // Row A's contractStartDate cell (column I, sheet row 2): force a
    // Turkish display format on the numeric serial. `raw: true` must ignore
    // it and still resolve the underlying serial correctly.
    (worksheet['I2'] as { z?: string }).z = 'dd.mm.yyyy';

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    try {
      await dataSource.query(
        `DELETE FROM main.customers WHERE tenant_id = $1 AND code LIKE $2`,
        [fixture.tenantId, `${CODE_PREFIX}%`],
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('T-107 adım 2 cleanup failed:', e);
    } finally {
      await closeTestApp();
    }
  });

  it('uploads a real .xlsx buffer through the actual multipart/FileInterceptor path', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const buffer = buildXlsxBuffer();

    const res = await request(app.getHttpServer())
      .post('/customers/import')
      .set(admin.authHeader())
      .attach('file', buffer, 'e2e-t107-import.xlsx')
      .expect(201);

    // eslint-disable-next-line no-console
    console.log(
      'T-107 adım 2 EVIDENCE: import response',
      JSON.stringify(res.body),
    );

    // Blank row (sheet row 3) is filtered out entirely before counting —
    // `total` reflects the 3 REAL data rows (A, B, C), not 4.
    expect(res.body.total).toBe(3);
    expect(res.body.created).toBe(2); // A, B
    expect(res.body.skipped).toBe(1); // C — broken date

    expect(res.body.errors).toHaveLength(1);
    const rowCError = res.body.errors[0];
    // Row numbering: header(1) + A(2) + blank(3) + B(4) + C(5). If the blank
    // row shifted numbering (the T-121 B4 regression), this would be 4, not 5.
    expect(rowCError.row).toBe(5);
    expect(rowCError.code).toBe(CODE_C);
    expect(rowCError.error_type).toBe('INVALID_DATE');
  });

  it('Row A persisted with the leading-zero-looking code intact, real 0 / real false via the FIRST alias, and the correct date regardless of the cell´s own display format', async () => {
    const rows = await dataSource.query(
      `SELECT code, credit_limit, is_vip, city,
              to_char(contract_start_date, 'YYYY-MM-DD') AS contract_start_date
         FROM main.customers
        WHERE tenant_id = $1 AND code = $2`,
      [fixture.tenantId, CODE_A],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.code).toBe(CODE_A); // not coerced/truncated
    // §2.5: a REAL 0 must persist as 0, never as NULL (the silent-zero
    // shape `pick-cell.ts` exists to close).
    expect(row.credit_limit).not.toBeNull();
    expect(Number(row.credit_limit)).toBe(0);
    expect(row.is_vip).toBe(false);
    expect(row.city).toBe('İstanbul');
    // The cell's OWN number format was `dd.mm.yyyy` — raw:true bypassed it
    // entirely and read the serial directly; still the correct calendar day.
    expect(row.contract_start_date).toBe(EXPECTED_ISO_DATE);
  });

  it('Row B persisted with real 0 / real false via the LAST alias spelling (CREDIT_LIMIT / IS_VIP) — pins the shape; not a `||`-regression detector, see fixture comment', async () => {
    const rows = await dataSource.query(
      `SELECT code, credit_limit, is_vip, city,
              contract_start_date
         FROM main.customers
        WHERE tenant_id = $1 AND code = $2`,
      [fixture.tenantId, CODE_B],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.credit_limit).not.toBeNull();
    expect(Number(row.credit_limit)).toBe(0);
    expect(row.is_vip).toBe(false);
    expect(row.city).toBe('Ankara');
    // No date was given for Row B — genuinely absent, must stay NULL, not
    // some invented value.
    expect(row.contract_start_date).toBeNull();
  });

  it('Row C (broken date) was never inserted — a row-level parse failure must not create a partial row', async () => {
    const rows = await dataSource.query(
      `SELECT code FROM main.customers WHERE tenant_id = $1 AND code = $2`,
      [fixture.tenantId, CODE_C],
    );
    expect(rows).toHaveLength(0);
  });
});

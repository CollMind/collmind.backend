/**
 * sales-actuals-consumer-absence.e2e-spec.ts — `SC-2c` (`Faz-2 W1`,
 * `FAZ2_PLANLAMA_BRIEF.md §1iv`)
 *
 * Kapsam: `sales_actuals`'ın "çıkmaz bacak" olduğu iddiasının GERÇEK bir
 * yazma+okuma zinciriyle pinlenmesi. Statik kanıt (ZORUNLU önce ölçüldü,
 * `§7`): `grep -rln "SalesActualsService\|SalesActualsRepository\|
 * sales_actuals" src --include="*.ts"` → sonuç kümesi kendi modülü +
 * migration/seed/entity dışında BOŞ (hiçbir servis `SalesActualsService`/
 * `SalesActualsRepository`'yi enjekte etmiyor).
 *
 * ⚠️ Bu ÇAĞRI-YERİ (statik) kanıtı YETERSİZ (`DISIPLIN`: "enjeksiyon
 * kullanım değildir") — bu suite AYNI iddiayı DAVRANIŞSAL olarak, gerçek
 * bir upload'ın gerçek bütçe/defter/agreement tablolarını DEĞİŞTİRMEDİĞİNİ
 * ölçerek pinler.
 *
 * ⛔ `AYIRT EDİCİ` — bu bir "yokluk pini"dir ve `§2.7`'nin "verinin yokluğu
 * örter" sınıfına düşmemesi için fixture'ın İKİ TARAFI da bu suite'in
 * KENDİ, taze verisiyle ölçülür:
 *   TARAF A (pozitif kontrol): sales_actual_batches/sales_actuals GERÇEKTEN
 *     artıyor mu? (upload gerçekten bir şey yazdı mı, yoksa sessizce
 *     no-op mu oldu?)
 *   TARAF B (yokluk pini): AYNI upload sonrası budget_transactions/
 *     agreement_transactions/ledger_entries satır sayısı (TENANT GENELİ,
 *     gerçek üretim verisi üstünde) BİREBİR AYNI kalıyor mu?
 * TARAF A olmadan TARAF B anlamsızdır (upload başarısız olsa da "yokluk"
 * doğru görünürdü — gerçek yazmanın olduğunu KANITLAMADAN yokluğu
 * iddia etmek `§2.7`'nin tam tanımladığı hata).
 *
 * Fixture izolasyonu: `fiscalPeriod=2027-11` (hiçbir başka e2e dosyasında
 * kullanılmıyor — ölçüldü, `grep`).
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import {
  loadE2EFixture,
  E2EFixture,
  cleanupSalesActuals,
} from './helpers/seed-e2e';
import { closeAdminDataSource } from './helpers/admin-datasource';

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf-8');
}

const HEADER =
  'cpl_code,category,channel_code,gross_amount,net_amount,discount_amount';
const FISCAL_PERIOD = '2027-11';

describe('Sales Actuals — çıkmaz bacak DAVRANIŞSAL pini (E2E), SC-2c', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
    await cleanupSalesActuals(app, fixture.tenantId);
  }, 60000);

  afterAll(async () => {
    await cleanupSalesActuals(app, fixture.tenantId);
    await closeTestApp();
    await closeAdminDataSource();
  }, 60000);

  async function getCplCode(): Promise<string> {
    const rows = await dataSource.query(
      `SELECT code FROM main.cpls WHERE id = $1 LIMIT 1`,
      [fixture.cplId],
    );
    return rows[0].code;
  }

  async function countAll(table: string): Promise<number> {
    const rows = await dataSource.query(
      `SELECT count(*)::int AS c FROM main.${table} WHERE tenant_id = $1`,
      [fixture.tenantId],
    );
    return rows[0].c;
  }

  it('TARAF A (pozitif kontrol) + TARAF B (yokluk pini): gerçek hacim sales_actuals içine GİRER, hiçbir motora (budget/agreement/ledger) SIZMAZ', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const cplCode = await getCplCode();
    const nonce = Date.now() % 100000;

    // ── ÖNCE: tenant-geneli, GERÇEK üretim verisi üstünde taban sayım ──
    const [
      budgetTxBefore,
      agreementTxBefore,
      ledgerBefore,
      batchesBefore,
      rowsBefore,
    ] = await Promise.all([
      countAll('budget_transactions'),
      countAll('agreement_transactions'),
      countAll('ledger_entries'),
      countAll('sales_actual_batches'),
      countAll('sales_actuals'),
    ]);

    // ── GERÇEK yazma: iki farklı scope (CPL x kategori x kanal), büyük
    // ve ayırt edici tutarlar (nonce ile benzersiz) ──
    const content = csv([
      HEADER,
      `${cplCode},Şekillendirici,NKA,${911000 + nonce},900000,11000`,
      `${cplCode},Saç Boyası,NKA,${922000 + nonce},900000,22000`,
    ]);

    const uploadRes = await request(app.getHttpServer())
      .post(`/actuals-first/sales-actuals/upload?fiscalPeriod=${FISCAL_PERIOD}`)
      .set(admin.authHeader())
      .attach('file', content, `actuals_${FISCAL_PERIOD}.csv`)
      .expect(201);

    expect(uploadRes.body.fiscalPeriod).toBe(FISCAL_PERIOD);
    expect(uploadRes.body.totalRows).toBe(2);
    expect(uploadRes.body.validRows).toBe(2);
    expect(uploadRes.body.errorRows).toBe(0);
    expect(uploadRes.body.batches).toHaveLength(2);

    // ── TARAF A — gerçekten yazdı mı? (upload'ın no-op OLMADIĞININ kanıtı) ──
    const [batchesAfter, rowsAfter] = await Promise.all([
      countAll('sales_actual_batches'),
      countAll('sales_actuals'),
    ]);
    expect(batchesAfter).toBe(batchesBefore + 2);
    expect(rowsAfter).toBeGreaterThan(rowsBefore);

    const sumRows = await dataSource.query(
      `SELECT sum(gross_amount)::numeric AS s FROM main.sales_actuals
        WHERE tenant_id = $1 AND fiscal_period = $2 AND cpl_id = $3`,
      [fixture.tenantId, FISCAL_PERIOD, fixture.cplId],
    );
    expect(Number(sumRows[0].s)).toBeGreaterThanOrEqual(
      911000 + nonce + 922000 + nonce,
    );

    // ── TARAF B — GERÇEK motorlara sızma YOK (tenant geneli, aynı
    // upload'ın SONRASI ölçülür — boş küme değil, GERÇEK üretim verisi) ──
    const [budgetTxAfter, agreementTxAfter, ledgerAfter] = await Promise.all([
      countAll('budget_transactions'),
      countAll('agreement_transactions'),
      countAll('ledger_entries'),
    ]);
    expect(budgetTxAfter).toBe(budgetTxBefore);
    expect(agreementTxAfter).toBe(agreementTxBefore);
    expect(ledgerAfter).toBe(ledgerBefore);
  });
});

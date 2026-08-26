/**
 * budget-reserve-canonical-path.e2e-spec.ts
 *
 * T-289 (`Z38`, `B3` kaza-dalgası `K6(c)(d)`, 2026-08-26) — `POST /budget/reserve`
 * (`BudgetService#reserveBudget`) KALDIRILDI.
 *
 * Gerekçe (bkz. `.claude/backlog/tasks/T-289.md` tam zincir):
 *   (1) `K-2.2.4`'ün ("Rezerve kovası bir anlaşma ONAYLANDIĞINDA dolar") tetikleyicisini
 *       ATLAYAN, doğrulanmamış `agreementId` ile kesinleşmiş (`POSTED`) defter satırı
 *       üreten ikinci bir yazma yolu (yapısal).
 *   (2) Uç yapısal olarak KIRIK ve ÖLÜ idi: `findEnvelopeWithLock` transaction'sız
 *       çağrılıyordu, `setLock('pessimistic_write')` HER ÇAĞRIDA
 *       `PessimisticLockTransactionRequiredError` ile 500 veriyordu — repro-pin
 *       `F12`/`Z38 §1`'de kayıtlı (Team Lead bağımsız doğruladı).
 *   (3) Defter taraması (`K6(b)`): bu yolla doğmuş satır SIFIR — `ADR-0012` devreye
 *       girmedi, fiziksel silme yok.
 *
 * Kanonik (TEK) yol: `reserveForAgreement` (anlaşma onayından,
 * `agreement.service.ts:750`) ve `reserveTypedForPlan` (plan onayından). Bu suite
 * ikisini de TEKRAR test ETMEZ (role-journey.e2e-spec.ts zaten kapsıyor) — burada
 * yalnız (a) kaldırılan ucun GERÇEKTEN gittiği ve (b) kalan tek yolun bıraktığı
 * İLİŞKİSEL invaryantı (fabrikasyon-agreementId sınıfının artık MÜMKÜN OLMADIĞI)
 * pinler.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';
import { BudgetService } from '../src/modules/shared/budget/budget.service';

describe('Budget Reserve — kaldırılan uç + kanonik-yol invaryantı (T-289, K6c/d)', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
    dataSource = app.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await closeTestApp();
  });

  it('BR-01: POST /budget/reserve artık MEVCUT DEĞİL (404) — ADMIN dahil', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const res = await request(app.getHttpServer())
      .post('/budget/reserve')
      .set(admin.authHeader())
      .send({
        envelopeId: randomUUID(),
        agreementId: randomUUID(),
        amount: 100,
        currency: 'TRY',
      });

    expect(res.status).toBe(404);
  });

  it('BR-02: POST /budget/reserve artık MEVCUT DEĞİL (404) — PLANNER dahil (eski çağıran rol)', async () => {
    const planner = await loginAs(app, 'PLANNER');
    const res = await request(app.getHttpServer())
      .post('/budget/reserve')
      .set(planner.authHeader())
      .send({
        envelopeId: randomUUID(),
        agreementId: randomUUID(),
        amount: 100,
        currency: 'TRY',
      });

    expect(res.status).toBe(404);
  });

  it('BR-03: BudgetService#reserveBudget metodu artık YOK (mekanizma kaldırıldı, sadece rota değil)', () => {
    const budgetService = app.get(BudgetService);
    expect(
      (budgetService as unknown as Record<string, unknown>).reserveBudget,
    ).toBeUndefined();
  });

  // ⛔ BAŞLIK DÜZELTİLDİ (code-reviewer, 2026-08-26) — ve düzeltmenin sebebi
  // MUTASYONLA ölçüldü: uç + servis + DTO TAMAMEN GERİ YÜKLENDİĞİNDE
  // `BR-01/02/03` kırmızıya döndü ama **BR-04 YEŞİL KALDI**.
  //
  // Sebep koddan okunur: bu test yalnız DB'yi sorguluyor, KALDIRILAN YOLU
  // HİÇ ÇAĞIRMIYOR. Ve mevcut dört satırın dördü de değişiklikten ÖNCE
  // doğmuş — yani iddia SİLMEDEN ÖNCE DE DOĞRUYDU.
  //
  // ⇒ Eski başlık ("...sınıfı artık YAPISAL OLARAK imkânsız") bir şey
  //   KANITLAMIYORDU ve altı ay sonra "invaryant pinli" diye okunurdu.
  //   `DISIPLIN` — pin kör-nokta ailesi #1 (kaynak-yanlış): test, üretimin
  //   okuduğu yerden BAŞKA bir yeri ölçüyor.
  //
  // 📌 `K6(d)` (tek-yol pini) bugün `BR-01/02/03` tarafından KARŞILANIYOR —
  //   BR-04 tarafından DEĞİL. BR-04 bir BÜTÜNLÜK GÖZLEMİDİR.
  //
  // ⚠️ Gerçek bir ilişki-pini suite'in KENDİ fixture'ını kurmasını ister
  //   (yeni bir agreement yarat + onayla → kanonik motor koşsun → doğan
  //   satırın bağı ölçülsün). O zaman pin motoru GERÇEKTEN çalıştırır ve
  //   paylaşılan DB'ye de yaslanmaz. Kayıt: [[T-300]].
  it(
    'BR-04 (BÜTÜNLÜK GÖZLEMİ — kaldırmayı BR-01/02/03 pinler): tenant ' +
      "içindeki her AGREEMENT-kaynaklı RESERVE satırının source_id'si gerçek " +
      'bir agreements satırına karşılık geliyor (seed + kanonik yolun bıraktığı ' +
      'durum). ⚠️ Bu test kaldırılan yolu ÇAĞIRMAZ — mutasyonda yeşil kalır',
    async () => {
      const rows: { source_id: string }[] = await dataSource.query(
        `SELECT bt.source_id
           FROM main.budget_transactions bt
          WHERE bt.tenant_id = $1
            AND bt.tx_type = 'RESERVE'
            AND bt.source_type = 'AGREEMENT'`,
        [fixture.tenantId],
      );

      // Sıfır satır da geçerli bir ölçümdür (DISIPLIN: "satır yok" bir ÖLÇÜMDÜR,
      // sessiz geçilmez) — ama fixture seed'i en az bir AGREEMENT-RESERVE satırı
      // taşıyor olmalı, yoksa bu test hiçbir şeyi ayırt etmez (pozitif kontrol).
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        const match = await dataSource.query(
          `SELECT id FROM main.agreements WHERE id = $1 AND tenant_id = $2`,
          [row.source_id, fixture.tenantId],
        );
        expect(match.length).toBe(1);
      }
    },
  );
});

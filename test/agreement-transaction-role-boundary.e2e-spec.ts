/**
 * agreement-transaction-role-boundary.e2e-spec.ts
 *
 * `T-277` / `Z35` — `POST /agreement-transactions` `{ADMIN,PLANNER,FINANCE}`'ten
 * `{ADMIN,FINANCE}`'e DARALTILDI. Bu suite daraltmanın **doğru kararı** verdiğini
 * pinler, "çalıştığını" değil.
 *
 * ── NEDEN DARALTILDI — üç ölçüm, bağımsız yollardan aynı yere ────────────────
 *
 *  YAPISAL     `create ≡ batchImport` — `service.ts:264 → :285` AYNI METOT.
 *              Yani tekil uç, `/batch` ucunun (zaten `{ADMIN,FINANCE}`)
 *              **DOSYASIZ KAPISIYDI**: dosya yükleme PLANNER'a kapalıyken
 *              aynı defter yazımı tek satır hâlinde AÇIKTI.
 *  NORMATİF    `K-2.6.14` yürürlükteki fazı: *"Bugün — yalnız finans + yönetici"*.
 *              Kuralın kendi gerekçesi: *"görev ayrılığı VERİ GİRİŞİNİ değil
 *              FİNANSAL KARARI korur"* — ve `ledger_entries` DEBIT AYNI ÇAĞRIDA
 *              yazılıyor (`service.ts:238`), araya eşleştirme/onay girmiyor.
 *  TAKSONOMİK  `K-2.6.4`'ten PLANNER cümlesi YAZILAMIYOR: *"hacim girişi"* PLAN
 *              hacmidir, fatura tutarı değil.
 *
 *  Kayıt: `docs/brd-v2/04_KARAR_KAYDI.md` `Z35`
 *  `L2` kapsam açıklığı: `K-2.6.14` — *"içe aktarma"* bir KANAL adı değil, SINIF
 *  adıdır; ayırt edici **defter etkisidir**.
 *
 * ── PİNİN ŞEKLİ — ve NE ÖLÇMEDİĞİ ───────────────────────────────────────────
 *
 * Her pin İKİ GİRDİ / İKİ ÇIKTI (`CLAUDE.md §2.7 #6`): `403` tek başına kanıt
 * değildir — reddin SEBEBİ ancak `403` ALMAYAN bir kardeş vaka yanında yazılıysa
 * ayırt edilir.
 *
 * ⚠️ Bu suite **YETKİ SINIRINI** ölçer, yazma yolunu DEĞİL. İzinli roller için
 * beklenen `400` (DTO doğrulaması) — ve bu KASITLIDIR:
 *
 *     PLANNER   →  403   RolesGuard reddediyor, gövde HİÇ okunmuyor
 *     FINANCE   →  400   Guard GEÇİRDİ, ValidationPipe reddetti
 *     ADMIN     →  400   aynı
 *
 * `403` ↔ `400` farkı, kapının hangi rolde açıldığının **tam kanıtıdır**, ve
 * suite bu sayede `agreement_transactions`/`ledger_entries`'e **HİÇBİR SATIR
 * YAZMAZ** — `T-047/T-060` satır sayısı invaryantı yapısal olarak korunur.
 *
 * 📌 Yazma yolunun kendisi `src/database/seeds/test-happy-path.ts` adım 7/10'da
 * koşuyor (`Z35` ile token `finance`'a taşındı — o adımlar tam olarak bu yazma
 * yolunu, ledger + idempotency'yi kanıtlamak için var).
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

/**
 * Guard'ı geçen ama ValidationPipe'a takılan gövde: `agreementId` UUID değil.
 * Kasıtlı — hiçbir satır yazılmasın diye (yukarıdaki başlık notu).
 */
const GUARD_PASSING_INVALID_BODY = {
  agreementId: 'not-a-uuid',
  invoiceNo: 'T277-BOUNDARY',
  invoiceDate: '2026-01-15',
  amount: 100,
};

describe('T-277/Z35 — agreement-transactions YAZMA yetkisi {ADMIN,FINANCE}', () => {
  let app: INestApplication;
  let planner: LoginResult;
  let finance: LoginResult;
  let admin: LoginResult;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    planner = await loginAs(app, 'PLANNER');
    finance = await loginAs(app, 'FINANCE');
    admin = await loginAs(app, 'ADMIN');
  }, 60000);

  afterAll(async () => {
    await closeTestApp();
  });

  describe('POST /agreement-transactions (tekil — DOSYASIZ KAPI)', () => {
    it('(a) PLANNER → 403 · daraltmanın ta kendisi', async () => {
      await request(app.getHttpServer())
        .post('/agreement-transactions')
        .set(planner.authHeader())
        .send(GUARD_PASSING_INVALID_BODY)
        .expect(403);
    });

    it('(d) POZ.KONTROL — FINANCE guard’ı GEÇİYOR (400, 403 DEĞİL)', async () => {
      const res = await request(app.getHttpServer())
        .post('/agreement-transactions')
        .set(finance.authHeader())
        .send(GUARD_PASSING_INVALID_BODY);
      // 400 = guard geçti, ValidationPipe reddetti. 403 olsaydı daraltma FAZLA gitmişti.
      expect(res.status).toBe(400);
    });

    it('(d) POZ.KONTROL — ADMIN guard’ı GEÇİYOR (400, 403 DEĞİL)', async () => {
      const res = await request(app.getHttpServer())
        .post('/agreement-transactions')
        .set(admin.authHeader())
        .send(GUARD_PASSING_INVALID_BODY);
      expect(res.status).toBe(400);
    });
  });

  /**
   * (b) `create ≡ batchImport` ölçümünün TEST HÂLİ.
   *
   * İki uç AYNI yazma yolunu paylaşıyor (`service.ts:285`). Bir gün rol kümeleri
   * AYRIŞIRSA bu bir REGRESYONdur — dosyasız kapı yeniden açılmış demektir.
   */
  describe('POST /agreement-transactions/batch — AYNI yazma yolu, AYNI küme', () => {
    it('(b) PLANNER → 403 · tekil uçla AYNI davranış', async () => {
      await request(app.getHttpServer())
        .post('/agreement-transactions/batch')
        .set(planner.authHeader())
        .send({ transactions: [GUARD_PASSING_INVALID_BODY] })
        .expect(403);
    });

    it('(b) POZ.KONTROL — FINANCE batch’te de guard’ı GEÇİYOR', async () => {
      const res = await request(app.getHttpServer())
        .post('/agreement-transactions/batch')
        .set(finance.authHeader())
        .send({ transactions: [GUARD_PASSING_INVALID_BODY] });
      expect(res.status).not.toBe(403);
    });
  });
});

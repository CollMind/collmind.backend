/**
 * approval-current-user.e2e-spec.ts
 *
 * T-256 — `@CurrentUser('id')` argümanını YOK SAYIYORDU (dekoratör fabrikası
 * `data`'yı hiç okumuyor, `request.user` OBJESİNİ dönüyordu). Bu suite
 * düzeltmenin "çalıştığını" değil, **DOĞRU KARARI verdiğini** pinler.
 *
 * ⚠️ Her pin İKİ GİRDİ / İKİ ÇIKTI şeklindedir (CLAUDE.md §2.7 #6): bir
 * testin yeşil olması, ayırt ettiği anlamına gelmez. Örn. `403` tek başına
 * kanıt değildir — `403`'ün SEBEBİ (sahiplik/self-approval) ancak pozitif
 * kontrol (`201` dönen kardeş vaka) yanında yazılıysa ayırt edilir.
 *
 * Düzeltmeden ÖNCEKİ davranış — MUTASYONLA ÖLÇÜLDÜ (2026-08-21; dekoratör
 * gövdesi düzeltme öncesi hâline döndürülüp bu suite koşuldu). Yeşil kalan
 * TEK grup: argümansız `@CurrentUser()` regresyon pinleri, `pending`
 * bulgu-ölçümü ve "başkasınınkini iptal edemez" — sonuncusu tek başına
 * AYIRT ETMEZ, çünkü düzeltme öncesi HERKES 403 alıyordu (pozitif kontrolü
 * bu yüzden var). Argümanlı yolun her pini kırmızıya döndü:
 *   GET  /approvals/my-requests   → 500
 *   POST /approvals/:id/cancel    → gerçek sahip bile 403 (string !== obje)
 *   POST /approvals/:id/approve   → 500
 *   POST /approvals/:id/reject    → 500
 * Üçünün de tek hata metni:
 *   `QueryFailedError: invalid input syntax for type uuid:
 *    "{"id":"…","sub":"…","email":"planner@wella.com",…}"`
 *
 * ⚠️ ÖNEMLİ DÜZELTME — `approve` FAIL-OPEN DEĞİLDİ, MASKELİYDİ.
 * Self-approval yüklemi (`request.requestedById === approverId`) gerçekten
 * hiçbir zaman `true` olmuyordu, AMA istek koruma yerine bir satır sonra
 * yazma aşamasında patlıyordu: `updatedBy`/`approvedById` alanlarına OBJE
 * gidiyor ve `uuid` kolonu reddediyor. Yani `/approvals/:id/approve`
 * üzerinden self-approval BUGÜN DE mümkün değildi — ikinci bir kusur
 * tarafından KAZARA kapatılmıştı (CLAUDE.md: "bir kusur, BAŞKA bir kusur
 * tarafından örtülebilir"; `INV-C-*` sınıfı: koruma bir tasarım değil, bir
 * arıza). Düzeltmeden sonra koruma GERÇEKTEN çalışır — bu suite onu pinler.
 *
 * 📌 `ApprovalService.approve`'un plan/agreement iç çağrıları (agreement.
 * service.ts:760 · approval-workflow.service.ts:546 · plan.service.ts:1602)
 * bu kusurdan HİÇ etkilenmedi: onlar `@CurrentUser()` (argümansız) →
 * `user.id` ile GERÇEK bir string taşıyor. Kusur yalnız `@CurrentUser('id')`
 * yazan 6 çağrı yerini vurdu (approval.controller.ts:57,72,100,112,123 +
 * admin-audit.controller.ts:29).
 *
 * ── T-047/T-060 SATIR SAYISI İNVARYANTI ──────────────────────────────────
 * `main.approval_requests` invaryantın İZLEDİĞİ tablolardan biridir
 * (test/helpers/e2e-row-count.js). Bu suite kendi fixture satırlarını
 * `beforeAll`'da INSERT eder ve `afterAll`'da id bazında DELETE eder —
 * ve DELETE'i bir SORGUYLA doğrular (fire-and-forget SQL değil; `m-3`
 * dersi: T-249 turunda bir ölçüm koşumu `main.admin_audit_logs`'ta 7 öksüz
 * satır bırakıp invaryantın tabanını sessizce yükseltmişti).
 *
 * Fixture satırları SENTETİK'tir (`entity_type='PLAN'`, rastgele
 * `entity_id`): `approval_requests.entity_id`'nin FK'sı YOKTUR (polimorfik
 * — bkz. cleanupTestPlans JSDoc'u), ve `ApprovalService.approve/reject/
 * cancel` yalnız `approval_requests` satırını okur/yazar; plan tarafına
 * hiç dokunmaz. Yani gerçek bir plan submit akışı kurmak bu davranışı
 * ölçmek için GEREKMEZ ve dört tabloya daha satır sızdırırdı.
 *
 * ── T-257 GÜNCELLEMESİ (2026-08-21) ──────────────────────────────────────
 * `POST /approvals/:id/{approve,reject,cancel}` genel HTTP uçları
 * KALDIRILDI (ölçüldü: 0 tüketici — frontend 0 çağrı, backend'de tek
 * çağıran kendi controller'ıydı — VE `approve`/`reject` `K-2.5.6`'nın
 * atomikliğini ihlal ediyordu: approval_requests=APPROVED yazılırken
 * plan/agreement durum makinesi ve bütçe taahhüdü hiç yazılmıyordu).
 * Yukarıdaki paragraflar hâlâ doğru — T-256'nın düzelttiği kusuru ve o
 * turdaki ölçümü anlatıyorlar — ama artık TARİHSEL kayıt: bu dosyada o
 * üç ucu sınayan describe blokları yok. K-2.5.11 (self-approval) ve
 * self-rejection pinleri `test/role-journey.e2e-spec.ts`'e (C7 · C9b)
 * TAŞINDI — bkz. `.claude/backlog/tasks/T-257.md`.
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';

/** `createRequest`'in ürettiği varsayılan seviye — birebir aynı şekil. */
const DEFAULT_LEVELS = [{ order: 1, role: 'MANAGER', status: 'PENDING' }];

describe("T-256 — @CurrentUser('id') aktör kimliği (approvals)", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantId: string;

  let planner: LoginResult;
  let planner2: LoginResult;
  let categoryManager: LoginResult;

  /** Bu suite'in yarattığı TÜM approval_requests id'leri — afterAll siler. */
  const createdIds: string[] = [];

  /**
   * Sentetik bir PENDING approval_request yaratır ve id'sini temizlik
   * listesine ekler. `requestedById` testin ayırt etmek istediği eksendir —
   * fixture bu eksende FARKLI değerler taşımalıdır, yoksa test hiçbir şey
   * ölçemez (CLAUDE.md: "fixture, ayırt etmek istediği iki tarafta FARKLI
   * değer taşımalı").
   */
  async function seedRequest(requestedById: string): Promise<string> {
    const rows = await dataSource.query(
      `INSERT INTO main.approval_requests
         (tenant_id, request_type, entity_type, entity_id,
          requested_by_id, requested_at, approval_levels, current_level,
          status, created_by, metadata)
       VALUES ($1, 'PLAN', 'PLAN', uuid_generate_v4(),
               $2, CURRENT_TIMESTAMP, $3::jsonb, 1,
               'PENDING', $2, '{"e2e":"T-256"}'::jsonb)
       RETURNING id`,
      [tenantId, requestedById, JSON.stringify(DEFAULT_LEVELS)],
    );
    const id: string = rows[0].id;
    createdIds.push(id);
    return id;
  }

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());

    planner = await loginAs(app, 'PLANNER');
    planner2 = await loginAs(app, 'PLANNER2');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    tenantId = planner.tenantId;

    // Ön koşul: aktörler GERÇEKTEN farklı kullanıcılar olmalı — aynı
    // olsalardı "kendi" / "başkasının" ayrımı ölçülemezdi.
    expect(planner.userId).toBeTruthy();
    expect(planner2.userId).toBeTruthy();
    expect(categoryManager.userId).toBeTruthy();
    expect(planner.userId).not.toBe(planner2.userId);
    expect(planner.userId).not.toBe(categoryManager.userId);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized && createdIds.length > 0) {
      await dataSource.query(
        `DELETE FROM main.approval_requests WHERE id = ANY($1::uuid[])`,
        [createdIds],
      );
      // T-047: DELETE'in SONUCU ölçülür, komutun çalıştığı değil.
      const left = await dataSource.query(
        `SELECT count(*)::int AS c FROM main.approval_requests
          WHERE id = ANY($1::uuid[])`,
        [createdIds],
      );
      expect(left[0].c).toBe(0);
    }
    await closeTestApp();
  });

  describe('GET /approvals/my-requests — READ_OWN', () => {
    it('200 döner ve YALNIZ kendi taleplerini verir (başkasınınki listede YOK)', async () => {
      const mine = await seedRequest(planner.userId);
      const theirs = await seedRequest(planner2.userId);

      const res = await request(app.getHttpServer())
        .get('/approvals/my-requests')
        .set(planner.authHeader());

      // Düzeltmeden önce burası 500'dü (obje uuid kolonuna bağlanıyordu).
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const ids: string[] = res.body.map((r: { id: string }) => r.id);
      expect(ids).toContain(mine); //  pozitif kontrol: yüklem eşleşiyor
      expect(ids).not.toContain(theirs); //  ayırt edicilik: filtre GERÇEK

      // Ve dönen her satır gerçekten bu kullanıcının olmalı — "içeriyor"
      // testi tek başına, filtresiz bir sorguda da yeşil olurdu.
      for (const row of res.body) {
        expect(row.requestedById).toBe(planner.userId);
      }
    });

    it('başka bir kullanıcı için AYNI uç farklı bir küme döner', async () => {
      const res = await request(app.getHttpServer())
        .get('/approvals/my-requests')
        .set(planner2.authHeader());

      expect(res.status).toBe(200);
      const ids: string[] = res.body.map((r: { id: string }) => r.id);
      // planner2'nin listesi planner'ın satırını İÇERMEZ — aynı uç, farklı
      // aktör, farklı sonuç. "Sinyal sabitse, sinyal değildir."
      expect(ids.length).toBeGreaterThan(0);
      for (const row of res.body) {
        expect(row.requestedById).toBe(planner2.userId);
      }
    });
  });

  // T-257: `POST /approvals/:id/cancel` · `:id/approve` · `:id/reject`
  // KALDIRILDI (0 tüketici — İlke 1). Bu üç describe bloğu buradaydı ve
  // silindi. K-2.5.11 (self-approval) ve self-rejection pinleri
  // `test/role-journey.e2e-spec.ts`'e (C7 · C9b, agreement domain akışı)
  // TAŞINDI — agreement.service.ts'in approve/reject'inin KENDİ guard'ı
  // olmadığı, koruma tamamen ApprovalService'in paylaşılan kontrolüne
  // dayandığı için domain akışında sınanmaları GEREKİYORDU (CLAUDE.md
  // T-257 ŞART 2). "Başkasının talebini iptal edemez" ve entity-doğrulamayan
  // `approve` BULGUSU (T-256 kapsamı dışı) genel uçla birlikte gitti — o
  // uç artık yok, o davranış artık yok. Bkz. `.claude/backlog/tasks/T-257.md`.

  describe('REGRESYON — argümansız @CurrentUser() bozulmadı', () => {
    it('GET /agreements (kapsam çözümü user.id/user.role üzerinden) → 200', async () => {
      // agreement.controller.ts:71 `@CurrentUser() user: { id, role }` →
      // `{ userId: user.id, role: user.role }` ile kapsam filtresi kurar.
      // Argümansız yol OBJE dönmeye devam etmeli; alan bazına düşseydi
      // burası patlardı.
      const res = await request(app.getHttpServer())
        .get('/agreements')
        .set(planner.authHeader());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /notifications (argümansız user.id tüketicisi) → 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set(planner.authHeader());

      expect(res.status).toBe(200);
    });
  });

  describe("BULGU (düzeltilmedi) — GET /approvals/pending userId'yi KULLANMIYOR", () => {
    it('iki farklı aktör AYNI kümeyi alıyor — JSDoc "for current user" diyor', async () => {
      // ⚠️ Bu bir PIN DEĞİL, bir ÖLÇÜMDÜR. T-256 kapsamı dışında bırakıldı:
      // `ApprovalRepository.findPendingForUser` `userId` parametresini alıp
      // WHERE'e HİÇ koymuyor (approval.repository.ts, `findPendingForUser`
      // gövdesinde yalnız tenantId/status/deletedAt var) — yani uç,
      // tenant'ın TÜM PENDING talepleriniverir. Hangisinin doğru olduğu
      // (JSDoc mu davranış mı) bir ÜRÜN KARARIDIR, bir hata düzeltmesi
      // değil. Bu test bugünkü davranışı KAYDEDER; karar verildiğinde
      // bilerek kırmızıya dönmesi beklenir.
      const cmRes = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set(categoryManager.authHeader());
      const roRes = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set((await loginAs(app, 'READONLY')).authHeader());

      expect(cmRes.status).toBe(200);
      expect(roRes.status).toBe(200);

      const cmIds = cmRes.body.map((r: { id: string }) => r.id).sort();
      const roIds = roRes.body.map((r: { id: string }) => r.id).sort();
      // Boş iki liste de `toEqual` geçerdi — ölçümün ayırt edici olması için
      // küme DOLU olmalı (bu suite'in 403 alan iki self-approval satırı
      // hâlâ PENDING'dir).
      expect(cmIds.length).toBeGreaterThan(0);
      expect(cmIds).toEqual(roIds); // ← aktörden BAĞIMSIZ (bugünkü hâl)
    });
  });
});

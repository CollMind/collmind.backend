/**
 * notification-recipient-scope.e2e-spec.ts
 *
 * [[T-275]] — CANLI çapraz-kullanıcı sızıntısı. `POST /notifications/:id/read`
 * çağıranın `recipientId`'sini hiç sormuyordu: `notification.repository.ts`
 * `findById(tenantId, id)` yalnız tenant ile daralıyordu, `findByRecipient`/
 * `findUnreadByRecipient`/`countUnread` kardeşlerinin ikisi de zaten
 * `recipientId`'yi WHERE'e katıyordu — eksik olan bir yetenek değil, bir
 * satırdı.
 *
 * `T-249` bunu bilerek ERTELEMİŞTİ: `app_runtime`'ın GRANT'i olmadığı için
 * uç `500` veriyordu, ve o `500` içteki kusuru ÖRTÜYORDU (CLAUDE.md — "bir
 * kusur başka bir kusur tarafından örtülebilir"). `T-249`'un GRANT'i örtüyü
 * kaldırınca kusur CANLI hâle geldi.
 *
 * ── KIRMIZI KANIT (bu dosyadan ÖNCE, manuel HTTP, task raporunda tam
 * transkript) ─────────────────────────────────────────────────────────
 *   PLANNER2, ADMIN'in bildirimini `POST /notifications/:id/read` ile
 *   işaretledi → `200`, DB'de `status PENDING → READ`, yanıt gövdesi
 *   ADMIN'in `subject`/`body`/`recipientEmail` alanlarını taşıyordu.
 *
 * Bu dosya YEŞİL (düzeltme sonrası) durumu kalıcı pinler — kırmızı adımı
 * kendi içinde tekrar simüle etmez (t249-app-runtime-live-route-grants.
 * e2e-spec.ts'in aynı gerekçesi: CLAUDE.md §2.6/§2.7 "bir kez ölç, kaydet").
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache } from './helpers/auth';
import { loadE2EFixture, E2EFixture } from './helpers/seed-e2e';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';

describe('T-275 — /notifications/:id/read recipientId scope', () => {
  let app: INestApplication;
  let fixture: E2EFixture;
  const insertedNotificationIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    clearTokenCache();
    fixture = await loadE2EFixture(app);
  });

  afterAll(async () => {
    if (insertedNotificationIds.length > 0) {
      const admin = await getAdminDataSource();
      await admin.query(
        `DELETE FROM main.notifications WHERE id = ANY($1::uuid[])`,
        [insertedNotificationIds],
      );
    }
    await closeTestApp();
    await closeAdminDataSource();
  });

  beforeEach(() => clearTokenCache());

  /**
   * app_runtime'ın `notifications` üzerinde INSERT hakkı yok (T-249: canlı
   * INSERT yolu yok, `createNotification` ölü kod) — fixture satırları
   * `app_migrate` bağlantısıyla (getAdminDataSource) yazılır, aynı desen
   * t249-app-runtime-live-route-grants.e2e-spec.ts'de.
   */
  async function insertNotification(
    recipientId: string,
    recipientEmail: string,
    subject: string,
    body: string,
  ): Promise<string> {
    const admin = await getAdminDataSource();
    const rows: Array<{ id: string }> = await admin.query(
      `INSERT INTO main.notifications
         (tenant_id, type, recipient_id, recipient_email, recipient_name,
          channel, priority, status, subject, body)
       VALUES ($1, 'APPROVAL_REQUESTED', $2, $3, 'T-275 e2e',
               'IN_APP', 'MEDIUM', 'PENDING', $4, $5)
       RETURNING id`,
      [fixture.tenantId, recipientId, recipientEmail, subject, body],
    );
    const id = rows[0].id;
    insertedNotificationIds.push(id);
    return id;
  }

  it("DAVRANIŞSAL: kullanıcı A (PLANNER) kullanıcı B (ADMIN)'nin bildirimini /read ile işaretleyemez — 404, DB DEĞİŞMEZ, içerik SIZMAZ", async () => {
    const admin = await loginAs(app, 'ADMIN');
    const planner = await loginAs(app, 'PLANNER');

    const secretSubject = 'T-275 GİZLİ KONU — yalnız ADMIN görmeli';
    const secretBody = 'T-275 GİZLİ İÇERİK — yalnız ADMIN görmeli';
    const notifId = await insertNotification(
      admin.userId,
      'admin@wella.com',
      secretSubject,
      secretBody,
    );

    const res = await request(app.getHttpServer())
      .post(`/notifications/${notifId}/read`)
      .set(planner.authHeader());

    expect(res.status).toBe(404);
    // İçerik sızmamalı — ne başlıkta ne gövdede
    expect(JSON.stringify(res.body)).not.toContain(secretSubject);
    expect(JSON.stringify(res.body)).not.toContain(secretBody);
    expect(JSON.stringify(res.body)).not.toContain('admin@wella.com');

    // DB: çapraz-kullanıcı yazma OLMADI — durum hâlâ PENDING
    const admin2 = await getAdminDataSource();
    const rows: Array<{ status: string; read_at: Date | null }> =
      await admin2.query(
        `SELECT status, read_at FROM main.notifications WHERE id = $1`,
        [notifId],
      );
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].read_at).toBeNull();
  });

  it('POZ.KONTROL: kendi bildirimini işaretlemek çalışmaya devam eder — 200, DB status READ', async () => {
    const admin = await loginAs(app, 'ADMIN');

    const notifId = await insertNotification(
      admin.userId,
      'admin@wella.com',
      'T-275 poz.kontrol konu',
      'T-275 poz.kontrol içerik',
    );

    const res = await request(app.getHttpServer())
      .post(`/notifications/${notifId}/read`)
      .set(admin.authHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('READ');

    const admin2 = await getAdminDataSource();
    const rows: Array<{ status: string; read_at: Date | null }> =
      await admin2.query(
        `SELECT status, read_at FROM main.notifications WHERE id = $1`,
        [notifId],
      );
    expect(rows[0].status).toBe('READ');
    expect(rows[0].read_at).not.toBeNull();
  });

  it('var olmayan id ve başkasına ait id AYNI yanıt şeklini verir — varlık sızmaz (404, ikisi de)', async () => {
    const admin = await loginAs(app, 'ADMIN');
    const planner = await loginAs(app, 'PLANNER');

    const othersNotifId = await insertNotification(
      admin.userId,
      'admin@wella.com',
      'T-275 varlık-sızıntısı konu',
      'T-275 varlık-sızıntısı içerik',
    );
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    const resOthers = await request(app.getHttpServer())
      .post(`/notifications/${othersNotifId}/read`)
      .set(planner.authHeader());
    const resMissing = await request(app.getHttpServer())
      .post(`/notifications/${nonExistentId}/read`)
      .set(planner.authHeader());

    expect(resOthers.status).toBe(404);
    expect(resMissing.status).toBe(404);
    expect(resOthers.body.statusCode).toBe(resMissing.body.statusCode);
  });
});

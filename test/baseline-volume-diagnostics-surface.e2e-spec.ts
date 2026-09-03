/**
 * `BL-4` (`docs/process/BL4_YUZEY_BRIEF.md`) — YÜZEY testsiz push edilmişti:
 * `code-reviewer` ölçtü, `grep -rn "baseline-volumes" test/` → **0 eşleşme**.
 * Bu dosya HTTP yüzeyini gerçek DB'ye kadar sınar — `test/`de KAPSANMASI
 * ZORUNLU olanlardan K2/K3/K5/K6 (K1/K4 controller/repository UNIT
 * seviyesinde `baseline-volume.controller.spec.ts` /
 * `baseline-volume.repository.spec.ts`'te, DB'siz).
 *
 * ── K2 — `getBatchRows` DOĞRU TABLOYU okuyor ────────────────────────────
 * `code-reviewer` bulgusu `S1`: `main.baseline_volume_import_batch_rows`
 * BUGÜN 0 SATIR — düzeltmenin (yanlış tablodan doğru tabloya) davranışsal
 * kanıtı YOKTU (`T-273` körlüğü: "verinin yokluğu örter"). Bu suite kalıcı
 * bir fixture kurar: `SKU_NOT_FOUND` + `CPL_NOT_FOUND` + `MISSING_REQUIRED_
 * FIELD` + `NEGATIVE_VOLUME` satırlı bir batch, ve bu satırların teşhis
 * raporunda GÖRÜNDÜĞÜNÜ ölçer. "Ayırt etme gücü" (yanlış tabloya dönülürse
 * kırmızı yanar mı) MUTASYONLA `baseline-volume.repository.spec.ts`'te
 * (izole `git worktree`, DB'siz) ayrıca kanıtlandı — bu dosya CANLI DB
 * KANITIdır, ikisi TAMAMLAYICI.
 *
 * Bu satırlar hiçbirinin key'i (sku/cpl/period) `baseline_volumes`'a
 * ACCEPTED olarak GİRMEZ — yani `findExistingGrainKeys` uniqueness
 * kontrolüne HİÇ takılmazlar (yalnız ACCEPTED adaylarına uygulanır,
 * `baseline-volume.service.ts` ADIM 3). RUN_ID önekiyle hangi koşumun
 * hangi satırı ürettiği İZLENEBİLİR kalır.
 *
 * ── TEMİZLİK — DÜZELTİLDİ (Team Lead ölçtü, 2026-09-03) ─────────────────
 * İLK SÜRÜM bu suite'in DB'ye satır SIZDIRDIĞINI (T-047/T-060/T-319
 * invaryantı, tam e2e koşumunda ölçüldü: `baseline_volumes` +2 ·
 * `baseline_volume_import_batch_rows` +4 · `baseline_volume_import_batches`
 * +1 · `admin_audit_logs` +1) GÖRMÜYORDU — çünkü o ölçüm alındığında
 * `app_runtime`'ın GRANT'ı eksikti, `upload` `500` veriyordu, HİÇBİR satır
 * yazılmıyordu (`CLAUDE.md §2.7`: kurulum, ölçmek istediği durumu hiç
 * kuramadığı için "temiz" görünüyordu). GRANT düzeltildikten sonra (bkz.
 * `beforeAll` yorumu, altyapı kusuru ARTIK KAPALI) satırlar GERÇEKTEN
 * yazılıyor — bu yüzden AŞAĞIDAKİ `afterAll` dört tabloyu da temizler.
 * `baseline_volume_import_batch_rows` TASARIM GEREĞİ IMMUTABLE
 * (`app_runtime`'ın UPDATE/DELETE hakkı YOK) — temizlik `app_migrate`
 * bağlantısıyla (`getAdminDataSource()`, `K-2.6.13 KARAR 1` deseni) yapılır,
 * `admin_audit_logs` de AYNI korunmuş-tablo ailesinde, aynı bağlantıyla.
 *
 * ── `BL-4` KAPANIŞ TURU (2026-09-03) — GRANT UYGULANDI, BLOK YEŞİL ───────
 * ⚠️ `code-reviewer` 🟡-A: aşağıdaki nested describe'ın JSDoc'u ("bu blok
 * BUGÜN BAŞARISIZ olur") ve bu paragrafın "GRANT düzeltildi" cümlesi AYNI
 * DOSYADA ÇELİŞİYORDU — biri eski, biri yeni. `F12` deseni: eski metin
 * SİLİNMEDİ (aşağıda üstü çizili duruyor), ama artık YÜRÜRLÜKTE DEĞİL.
 * Kanıt: `npm run db:roles:grants` koşuldu (ürün sahibi onayıyla),
 * `docs/verification/GRANT_UZLASTIRMA_2026-09-03.md` (tablo düzeyi
 * 530→532, kolon 6966→6994, kaybolan 0). Bu dosyanın kendi ölçümü: aynı
 * gün, GRANT SONRASI, 19/19 test yeşil (iki ardışık koşum, ikisi de
 * `EXIT:0`, `[T-047 invariant] PASS`).
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestApp, closeTestApp } from './helpers/app-bootstrap';
import { loginAs, clearTokenCache, LoginResult } from './helpers/auth';
import {
  getAdminDataSource,
  closeAdminDataSource,
} from './helpers/admin-datasource';
import { BASELINE_VOLUME_REMEDIATION } from '../src/modules/master-data/baseline-volume/services/baseline-volume-remediation';

const RUN_TS = Date.now();
const RUN_ID = `${RUN_TS}-${Math.random().toString(36).slice(2, 7)}`;
const NONEXISTENT_SKU_CODE = `E2E-BL4-${RUN_ID}-NOPE-SKU`;
const NONEXISTENT_CPL_CODE = `E2E-BL4-${RUN_ID}-NOPE-CPL`;
const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * `main.baseline_volumes`'un `UQ_baseline_volumes_tenant_sku_cpl_period`
 * kısıtı ACCEPTED/REJECTED AYIRT ETMEZ (tüm satırlar bu tabloya yazılır,
 * yalnız `keyUnresolvedRows` hariç — bkz. `baseline-volume.service.ts`
 * JSDoc'u). Sabit bir period (`2026-01` gibi) bu yüzden İKİNCİ bir koşumda
 * (ya da önceki bir koşumun temizlenmemiş artığında — bu suite'in
 * DÜZELTMEDEN ÖNCEKİ hâlinin ÜRETTİĞİ TAM OLARAK bu çakışmayla ölçüldü,
 * `2026-02`/`2026-03` sabitleri) `duplicate key value violates unique
 * constraint` ile PATLAR. `runPeriod(offset)` her koşum için (RUN_TS
 * tabanlı) TEKİL bir `YYYY-MM` üretir — gerçek takvime bakmaz (parser
 * yalnız `^\d{4}-\d{2}$` formatını denetler), yalnız ÇAKIŞMASIZLIK şartı.
 */
function runPeriod(offset: number): string {
  const year = 2200 + ((RUN_TS + offset) % 700); // dört haneli, hep 2200-2899
  const month = String(((RUN_TS + offset) % 12) + 1).padStart(2, '0');
  return `${year}-${month}`;
}

describe('BL-4 yüzey — coverage + teşhis raporu (GET rotaları)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: LoginResult;
  let finance: LoginResult;
  let planner: LoginResult;
  let categoryManager: LoginResult;
  let readonly: LoginResult;
  let realSkuCode: string;
  let realCplCode: string;
  // Bu suite'in ürettiği batch'ler — `afterAll` bunları (ve türettiği
  // baseline_volumes/batch_rows/admin_audit_logs satırlarını) siler.
  const createdBatchIds: string[] = [];

  // ⚠️ `it.each` TOPLAMA ANINDA (describe gövdesi koşarken, `beforeAll`
  // BAŞLAMADAN ÖNCE) değerlendirilir — buraya `beforeAll`'da doldurulacak
  // bir dizi KOYMAK boş bir tabloyla `it.each` çağırır (Jest: "called with
  // an empty Array of table data"). Rol ANAHTARLARI (string) statiktir,
  // `LoginResult`'ı HER TESTTE `loginAs` ile (token cache'li, ucuz) çöz.
  const ALL_READ_ROLE_KEYS = [
    'ADMIN',
    'FINANCE',
    'PLANNER',
    'CATEGORY_MANAGER',
    'READONLY',
  ] as const;

  beforeAll(async () => {
    clearTokenCache();
    app = await createTestApp();
    dataSource = app.get<DataSource>(getDataSourceToken());
    admin = await loginAs(app, 'ADMIN');
    finance = await loginAs(app, 'FINANCE');
    planner = await loginAs(app, 'PLANNER');
    categoryManager = await loginAs(app, 'CATEGORY_MANAGER');
    readonly = await loginAs(app, 'READONLY');

    const sku = await dataSource.query(
      `SELECT code FROM main.skus WHERE tenant_id = $1 AND is_active = true LIMIT 1`,
      [admin.tenantId],
    );
    if (!sku || sku.length === 0) {
      throw new Error(
        'E2E fixture eksik: aktif SKU bulunamadı. `npm run seed` çalıştırın.',
      );
    }
    realSkuCode = sku[0].code;

    const cpl = await dataSource.query(
      `SELECT code FROM main.cpls WHERE tenant_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [admin.tenantId],
    );
    if (!cpl || cpl.length === 0) {
      throw new Error(
        'E2E fixture eksik: aktif CPL bulunamadı. `npm run seed` çalıştırın.',
      );
    }
    realCplCode = cpl[0].code;
  }, 60000);

  afterAll(async () => {
    if (createdBatchIds.length > 0) {
      const adminDataSource = await getAdminDataSource();

      const before = await adminDataSource.query(
        `SELECT
           (SELECT COUNT(*)::int FROM main.baseline_volume_import_batch_rows WHERE batch_id = ANY($1::uuid[])) AS batch_rows,
           (SELECT COUNT(*)::int FROM main.baseline_volumes WHERE import_batch_id = ANY($1::uuid[])) AS baseline_volumes,
           (SELECT COUNT(*)::int FROM main.baseline_volume_import_batches WHERE id = ANY($1::uuid[])) AS batches,
           (SELECT COUNT(*)::int FROM main.admin_audit_logs WHERE entity_type = 'BaselineVolumeImportBatch' AND entity_id::text = ANY($1::text[])) AS audit_logs`,
        [createdBatchIds],
      );

      // Sıra FK RESTRICT'e uyar: önce ÇOCUKLAR (batch_rows, baseline_volumes),
      // sonra EBEVEYN (batch), sonra bağımsız denetim kaydı (admin_audit_logs).
      // `baseline_volume_import_batch_rows`/`admin_audit_logs` `app_runtime`'da
      // DELETE hakkı taşımaz (K-2.6.13 KARAR 1) — `app_migrate` bağlantısı şart.
      await adminDataSource.query(
        `DELETE FROM main.baseline_volume_import_batch_rows WHERE batch_id = ANY($1::uuid[])`,
        [createdBatchIds],
      );
      await adminDataSource.query(
        `DELETE FROM main.baseline_volumes WHERE import_batch_id = ANY($1::uuid[])`,
        [createdBatchIds],
      );
      await adminDataSource.query(
        `DELETE FROM main.baseline_volume_import_batches WHERE id = ANY($1::uuid[])`,
        [createdBatchIds],
      );
      await adminDataSource.query(
        `DELETE FROM main.admin_audit_logs WHERE entity_type = 'BaselineVolumeImportBatch' AND entity_id::text = ANY($1::text[])`,
        [createdBatchIds],
      );

      // ⛔ DELETE'in `affected` dönüş değeri yazdığının KANITI DEĞİL
      // (DISIPLIN) — temizlik sonrası sayıyı GERÇEKTEN OKU.
      const after = await adminDataSource.query(
        `SELECT
           (SELECT COUNT(*)::int FROM main.baseline_volume_import_batch_rows WHERE batch_id = ANY($1::uuid[])) AS batch_rows,
           (SELECT COUNT(*)::int FROM main.baseline_volumes WHERE import_batch_id = ANY($1::uuid[])) AS baseline_volumes,
           (SELECT COUNT(*)::int FROM main.baseline_volume_import_batches WHERE id = ANY($1::uuid[])) AS batches,
           (SELECT COUNT(*)::int FROM main.admin_audit_logs WHERE entity_type = 'BaselineVolumeImportBatch' AND entity_id::text = ANY($1::text[])) AS audit_logs`,
        [createdBatchIds],
      );

      // eslint-disable-next-line no-console
      console.log(
        'baseline-volume-diagnostics-surface afterAll temizlik ÖNCESİ/SONRASI:',
        JSON.stringify({ before: before[0], after: after[0] }),
      );

      if (
        after[0].batch_rows > 0 ||
        after[0].baseline_volumes > 0 ||
        after[0].batches > 0 ||
        after[0].audit_logs > 0
      ) {
        throw new Error(
          `baseline-volume-diagnostics-surface: afterAll temizliği BEKLENEN etkiyi yaratmadı — ` +
            `sonrası ${JSON.stringify(after[0])}. Sessizce devam edilmiyor (§2.5).`,
        );
      }

      await closeAdminDataSource();
    }

    await closeTestApp();
  });

  // ── K5 · RBAC — MASTER_DATA_READ (5/5), BASELINE_WRITE ({ADMIN,FINANCE}) ──
  describe('RBAC sınırı', () => {
    // ⚠️ `code-reviewer` 🟡-B (2026-09-03): İLK SÜRÜM `expect(res.status)
    // .not.toBe(403)` kullanıyordu — bu TUR BULUNAN kusur sınıfının kendisi
    // (GRANT yok ⇒ `500`) bu şekilden KAÇARDI (`500 !== 403` de geçerdi).
    // `MASTER_DATA_READ` beş role de açık olduğu için DOĞRU beklenti
    // `toBe(200)`'dür — GÜÇLENDİRİLDİ. Ölçüldü (`beforeAll`'daki GRANT
    // düzeltmesi sonrası): beş rolün BEŞİ de `200` döner (bkz. bu suite'in
    // e2e koşum çıktısı — 19/19 yeşil, bu blok dahil, iki ardışık koşumda).
    it.each(ALL_READ_ROLE_KEYS)(
      'GET /master-data/baseline-volumes/coverage — %s 200 döner (MASTER_DATA_READ 5/5, 403 DEĞİL 500 DE DEĞİL)',
      async (roleKey) => {
        const user = await loginAs(app, roleKey);
        const res = await request(app.getHttpServer())
          .get('/master-data/baseline-volumes/coverage')
          .set(user.authHeader());
        expect(res.status).toBe(200);
      },
    );

    it('POST /master-data/baseline-volumes/upload — PLANNER 403 ALIR (BASELINE_WRITE = {ADMIN,FINANCE}, PLANNER YOK)', async () => {
      const res = await request(app.getHttpServer())
        .post('/master-data/baseline-volumes/upload')
        .set(planner.authHeader())
        .attach(
          'file',
          Buffer.from('sku_code,cpl_code,period,base_volume\n'),
          'planner-attempt.csv',
        );
      expect(res.status).toBe(403);
    });

    it('POST /master-data/baseline-volumes/upload — CATEGORY_MANAGER/READONLY 403 ALIR', async () => {
      for (const user of [categoryManager, readonly]) {
        const res = await request(app.getHttpServer())
          .post('/master-data/baseline-volumes/upload')
          .set(user.authHeader())
          .attach(
            'file',
            Buffer.from('sku_code,cpl_code,period,base_volume\n'),
            'attempt.csv',
          );
        expect(res.status).toBe(403);
      }
    });

    it('POST /master-data/baseline-volumes/upload — FINANCE 201 ALIR (BASELINE_WRITE = {ADMIN,FINANCE}, FINANCE DAHİL — negatif yarının tamamlayıcısı, ADMIN dışında ikinci pozitif kanıt)', async () => {
      // ⚠️ Tek satır ANAHTARI ÇÖZÜLEMEZSE `ingest()` `NO_RESOLVABLE_ROWS`
      // (400) fırlatır (`acceptedOrRejected.length === 0 && keyUnresolvedRows
      // .length > 0` dalı, `baseline-volume.service.ts`) — RBAC pozitif
      // kanıtı bunu YANLIŞLIKLA `403`'ün simetriği sanabilir, DEĞİL. İkinci
      // satır (gerçek sku+cpl, değer hatası) `acceptedOrRejected`'i BOŞ
      // BIRAKMAZ — yazma yolunun kendisi (guard'ı GEÇTİKTEN sonrası) test
      // edilsin diye ZORUNLU, RBAC'ın parçası değil.
      const csv = [
        'sku_code,cpl_code,period,base_volume',
        `${NONEXISTENT_SKU_CODE}-FIN,${realCplCode},${runPeriod(100)},10`,
        `${realSkuCode},${realCplCode},${runPeriod(101)},-1`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post('/master-data/baseline-volumes/upload')
        .set(finance.authHeader())
        .attach('file', Buffer.from(csv), `e2e-bl4-fin-${RUN_ID}.csv`)
        .expect(201);

      expect(res.body.batchId).toBeTruthy();
      createdBatchIds.push(res.body.batchId);
    });
  });

  // ── K2/K3/K6 — gerçek batch üzerinden teşhis raporu ────────────────────
  describe('teşhis ekranı — gerçek fixture (SKU_NOT_FOUND + CPL_NOT_FOUND + MISSING_REQUIRED_FIELD + NEGATIVE_VOLUME)', () => {
    let batchId: string;

    /**
     * ⛔ ~~BİLİNEN ALTYAPI KUSURU (QA ölçtü, 2026-09-03) — bu blok bugün
     * BAŞARISIZ olur, KODUN değil GRANT'IN eksikliğinden:~~
     *
     * ~~`app_runtime` rolünün `main.baseline_volume_import_batch_rows`
     * üzerinde HİÇBİR yetkisi yok (`information_schema.role_table_grants`
     * ile ölçüldü — sıfır satır). Kardeş tablo `baseline_volumes`'ta
     * `app_runtime: SELECT,INSERT` VAR. `GRANT` cümlesi kaynakta duruyor
     * (`scripts/db-roles/02-runtime-grants.sql:724`) ama bu DB'ye hiç
     * UYGULANMAMIŞ — migration `1823`'ün tablo YARATMASI ile grant
     * script'inin ÇALIŞTIRILMASI arasında bir adım eksik.~~
     *
     * ~~Sonuç: `POST /baseline-volumes/upload` transaction'ı
     * `insertBatchRowsChunked`'da `permission denied for table
     * baseline_volume_import_batch_rows` ile PATLAR, `500` döner,
     * transaction ROLLBACK olur — BL-2/BL-3/BL-4'ün TAMAMI bu ortamda
     * uçtan uca ÇALIŞMIYOR (`CLAUDE.md` "mekanizma var, yol yok" sınıfı,
     * `T-108` BudgetAlertConfiguration emsali).~~
     *
     * ~~BU TESTİ KIRMIZI BIRAKMAK BİLİNÇLİDİR — kırmızı, kusurun kendisidir.
     * Düzeltme `data-engineer`/altyapı işi: `scripts/db-roles/
     * 02-runtime-grants.sql`'i (ya da en azından ilgili GRANT satırını)
     * bu ortamda ÇALIŞTIRMAK. QA bu dosyayı DEĞİŞTİRMEZ (rol ayrılığı).~~
     *
     * ✅ **`BL-4` kapanış turu (2026-09-03) — GRANT uygulandı, blok YEŞİL.**
     * Yukarıdaki paragraf `F12` deseniyle SİLİNMEDİ (o anın gerçek, ölçülmüş
     * teşhisiydi) — üstü çizili, artık YÜRÜRLÜKTE DEĞİL. `npm run
     * db:roles:grants` koşuldu (ürün sahibi onayı), kanıt:
     * `docs/verification/GRANT_UZLASTIRMA_2026-09-03.md` (tablo düzeyi
     * 530→532, kolon 6966→6994, kaybolan 0). Bu blok bugün GERÇEKTEN 201
     * dönüyor ve `afterAll` kendi ürettiği satırları ölçerek temizliyor
     * (bkz. dosya başı JSDoc'u) — iki ardışık koşumda doğrulandı.
     */
    beforeAll(async () => {
      const csv = [
        'sku_code,cpl_code,period,base_volume',
        // 1) SKU_NOT_FOUND — sku katalogda YOK, cpl gerçek
        `${NONEXISTENT_SKU_CODE},${realCplCode},${runPeriod(1)},10`,
        // 2) CPL_NOT_FOUND — sku gerçek, cpl katalogda YOK
        `${realSkuCode},${NONEXISTENT_CPL_CODE},${runPeriod(2)},10`,
        // 3) MISSING_REQUIRED_FIELD (value-aşaması: anahtar çözüldü, base_volume boş)
        `${realSkuCode},${realCplCode},${runPeriod(3)},`,
        // 4) NEGATIVE_VOLUME
        `${realSkuCode},${realCplCode},${runPeriod(4)},-5`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post('/master-data/baseline-volumes/upload')
        .set(admin.authHeader())
        .attach('file', Buffer.from(csv), `e2e-bl4-${RUN_ID}.csv`)
        .expect(201);

      batchId = res.body.batchId;
      expect(batchId).toBeTruthy();
      createdBatchIds.push(batchId);
      // Sanity — dört satırın DÖRDÜ de reddedildi, HİÇBİRİ kabul edilmedi
      // (K2 fixture'ının EVRENİ: hiçbiri baseline_volumes'a ACCEPTED
      // yazmıyor, yani grain-uniqueness'a hiç dokunmuyor — tekrar-koşulabilir).
      expect(res.body.acceptedRows).toBe(0);
      expect(res.body.keyUnresolvedRows).toHaveLength(2); // SKU_NOT_FOUND + CPL_NOT_FOUND
      expect(res.body.formatRejectedRows).toHaveLength(2); // MISSING_REQUIRED_FIELD + NEGATIVE_VOLUME
    });

    it('K2 — GET batches/:id/rows SKU_NOT_FOUND satırını DOĞRU TABLODAN döner (0-satır körlüğü kırıldı)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
        .set(admin.authHeader())
        .query({ reason: 'SKU_NOT_FOUND' })
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe('REJECTED');
      expect(res.body[0].reason).toBe('SKU_NOT_FOUND');
      expect(res.body[0].resolvedSkuId).toBeNull();
      expect(res.body[0].resolvedCplId).toBeNull();
      expect(res.body[0].raw.sku_code).toBe(NONEXISTENT_SKU_CODE);
    });

    it('K2 — GET batches/:id/rows CPL_NOT_FOUND satırını döner, resolvedSkuId DOLU/resolvedCplId NULL (entity JSDoc invaryantı)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
        .set(admin.authHeader())
        .query({ reason: 'CPL_NOT_FOUND' })
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].resolvedSkuId).not.toBeNull();
      expect(res.body[0].resolvedCplId).toBeNull();
    });

    it('K6 — HER reddedilen satır kendi remediation cümlesini taşır (BASELINE_VOLUME_REMEDIATION ÇAĞRILIYOR, yeniden yazılmıyor)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
        .set(admin.authHeader())
        .expect(200);

      expect(res.body).toHaveLength(4);
      for (const row of res.body) {
        expect(row.status).toBe('REJECTED');
        expect(row.remediation).toBe(
          BASELINE_VOLUME_REMEDIATION[
            row.reason as keyof typeof BASELINE_VOLUME_REMEDIATION
          ],
        );
      }
      // NEGATIVE_VOLUME ≠ INVALID_VOLUME_FORMAT cümlesi ekranda da AYRIŞIYOR
      // (Z87 §F12 gerekçesi bu satırda BOŞA GİTMİYOR).
      const negativeRow = res.body.find(
        (r: { reason: string }) => r.reason === 'NEGATIVE_VOLUME',
      );
      expect(negativeRow.remediation).toContain('negatif');
    });

    it('K3 (Z92 sınıfı) — ?reason=toString / constructor / __proto__ / hasOwnProperty → 400', async () => {
      for (const pollutionValue of [
        'toString',
        'constructor',
        '__proto__',
        'hasOwnProperty',
      ]) {
        const res = await request(app.getHttpServer())
          .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
          .set(admin.authHeader())
          .query({ reason: pollutionValue })
          .expect(400);
        expect(res.body.message).toMatch(/Tanınmayan reason/);
      }
    });

    it('K3 — ?status=toString → 400, ?status=ACCEPTED / REJECTED → 200', async () => {
      await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
        .set(admin.authHeader())
        .query({ status: 'toString' })
        .expect(400);

      const accepted = await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
        .set(admin.authHeader())
        .query({ status: 'ACCEPTED' })
        .expect(200);
      expect(accepted.body).toHaveLength(0); // bu batch'te ACCEPTED YOK (fixture'ın tanımı)

      const rejected = await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
        .set(admin.authHeader())
        .query({ status: 'REJECTED' })
        .expect(200);
      expect(rejected.body).toHaveLength(4);
    });

    it('GET batches/:id — sourceMatch payda>0, oran 0/4 (payda>0 dalı — UNMEASURABLE ile AYNI koşumda AYRIŞIR)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${batchId}`)
        .set(admin.authHeader())
        .expect(200);

      expect(res.body.sourceMatch.totalCount).toBe(4);
      expect(res.body.sourceMatch.matchedCount).toBe(0);
      expect(res.body.sourceMatch.sourceMatchRatio).toBe(0);
      expect(res.body.sourceMatch.sourceMatchRatio).not.toBeNull();
      expect(res.body).not.toHaveProperty('coverageRatio'); // §5a: iki metrik karışmaz
    });

    it('K5 — PLANNER teşhis raporunu OKUYABİLİR (MASTER_DATA_READ), yazma ucuna DOKUNAMAZ', async () => {
      const res = await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
        .set(planner.authHeader())
        .expect(200);
      expect(res.body).toHaveLength(4);
    });

    it('rowNo doğrulaması — negatif/sıfır/ondalık/harf → 400', async () => {
      for (const badRowNo of ['0', '-1', '1.5', 'abc']) {
        await request(app.getHttpServer())
          .get(`/master-data/baseline-volumes/batches/${batchId}/rows`)
          .set(admin.authHeader())
          .query({ rowNo: badRowNo })
          .expect(400);
      }
    });
  });

  // ⚠️ `code-reviewer` 🟡-C (2026-09-03): İLK SÜRÜMÜN başlığı ("GREEN/
  // UNMEASURABLE dönerse BAĞLAMA YANLIŞ") testin ÖLÇMEDİĞİ bir iddia
  // taşıyordu — assertion `['GREEN','RED','UNMEASURABLE']).toContain(...)`
  // ÜÇÜNÜ DE geçirir, yani başlığın öne sürdüğü ayırt etme gücü YOKTU
  // (`§2.7 #6`). İki seçenek vardı: başlığı daralt (bugünkü sabit `RED`
  // cevabına kilitle) YA DA testi veri-BAĞIMSIZ hale getir (kapının
  // FORMÜLÜNÜ, bir anlık sonucu değil, ölç). İKİNCİSİ seçildi — gerekçe:
  // bugünkü `RED` (`0/59.160`) ileride bir baseline yüklemesiyle DEĞİŞİR;
  // sabit `toBe('RED')` o gün KIRILGAN bir test bırakırdı. Bunun yerine
  // `/coverage`'ın döndürdüğü PAY/PAYDA'yı AYNI ANDA, AYRI bir sorguyla
  // (uygulamanın kendi servis kodunu ÇAĞIRMADAN, ham SQL'le) yeniden
  // hesaplayıp KARŞILAŞTIRIYORUZ — bu, "kapı doğru hesaplıyor mu"yu
  // veriden bağımsız ölçer; mutasyon kanıtı: eşik `>=`'i `>`'ye çevirsen
  // ya da payda formülünü bozsan bu test KIRILIR, tek bir sabit değeri
  // ezberleyen bir test KIRILMAZDI.
  describe('coverage — canlı DB cevabı, KAPI FORMÜLÜ bağımsız sorguyla çapraz-doğrulanır (sabit sonuca DEĞİL)', () => {
    it('GET /coverage — üç değerden BİRİNİ döner, coverageRatio null XOR sayısal (asla NaN)', async () => {
      const res = await request(app.getHttpServer())
        .get('/master-data/baseline-volumes/coverage')
        .set(admin.authHeader())
        .expect(200);

      expect(['GREEN', 'RED', 'UNMEASURABLE']).toContain(res.body.outcome);
      if (res.body.outcome === 'UNMEASURABLE') {
        expect(res.body.coverageRatio).toBeNull();
      } else {
        expect(typeof res.body.coverageRatio).toBe('number');
        expect(Number.isNaN(res.body.coverageRatio)).toBe(false);
      }
    });

    it('GET /coverage — outcome + coverageRatio BAĞIMSIZ SQL ile TÜRETİLEN pay/paydayla EŞLEŞİR (formülün kendisi ölçülüyor, bir tarih değil)', async () => {
      const [{ sku_count: activeSkuCount }] = await dataSource.query(
        `SELECT COUNT(*)::int AS sku_count FROM main.skus WHERE tenant_id = $1 AND is_active = true`,
        [admin.tenantId],
      );
      const [{ cpl_count: activeCplCount }] = await dataSource.query(
        `SELECT COUNT(*)::int AS cpl_count FROM main.cpls WHERE tenant_id = $1 AND status = 'ACTIVE'`,
        [admin.tenantId],
      );
      const [{ accepted_count: acceptedCount }] = await dataSource.query(
        `SELECT COUNT(*)::int AS accepted_count FROM main.baseline_volumes WHERE tenant_id = $1 AND acceptance_status = 'ACCEPTED'`,
        [admin.tenantId],
      );

      const expectedUniverse = activeSkuCount * activeCplCount * 12;
      const expectedOutcome =
        expectedUniverse === 0
          ? 'UNMEASURABLE'
          : acceptedCount / expectedUniverse >= 0.95
            ? 'GREEN'
            : 'RED';

      const res = await request(app.getHttpServer())
        .get('/master-data/baseline-volumes/coverage')
        .set(admin.authHeader())
        .expect(200);

      expect(res.body.activeSkuCount).toBe(activeSkuCount);
      expect(res.body.activeCplCount).toBe(activeCplCount);
      expect(res.body.catalogUniverse).toBe(expectedUniverse);
      expect(res.body.acceptedCount).toBe(acceptedCount);
      expect(res.body.outcome).toBe(expectedOutcome);

      if (expectedOutcome === 'UNMEASURABLE') {
        expect(res.body.coverageRatio).toBeNull();
      } else {
        expect(res.body.coverageRatio).toBeCloseTo(
          acceptedCount / expectedUniverse,
          10,
        );
      }

      // Bugünkü canlı ölçüm (raporlanır, gerekçe değildir): 170 aktif SKU ×
      // 29 aktif CPL × 12 = 59.160, kabul edilmiş 0 ⇒ 0/59.160 < 0.95 ⇒ RED.
      // eslint-disable-next-line no-console
      console.log(
        'coverage çapraz-doğrulama:',
        JSON.stringify({
          activeSkuCount,
          activeCplCount,
          expectedUniverse,
          acceptedCount,
          expectedOutcome,
        }),
      );
    });
  });

  describe('404 sınırı', () => {
    it('GET batches/:id (var olmayan uuid) → 404, DB’ye HİÇ dokunmadan önce', async () => {
      await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${NONEXISTENT_UUID}`)
        .set(admin.authHeader())
        .expect(404);
    });

    it('GET batches/:id/rows (var olmayan uuid) → 404 (getBatch önce çağrılır, service.ts)', async () => {
      await request(app.getHttpServer())
        .get(`/master-data/baseline-volumes/batches/${NONEXISTENT_UUID}/rows`)
        .set(admin.authHeader())
        .expect(404);
    });
  });
});

/**
 * TARGET-ROI EKSENİ — **TEK NOKTA** (`Z71 §1`, ürün sahibi 2026-08-31).
 *
 * ── NEDEN AYRI BİR EKSEN ─────────────────────────────────────────────────
 * `Q6` yasası üçüncü kez: **bir çelişki, iki eksenin tek kaleme
 * sıkışmasından doğar.** Kadran öncesi RAG iki soruyu tek renge eziyordu:
 *
 * ```
 * YÖN        kazanıyor mu?     (ciro arttı mı · kâr etti mi)
 * BÜYÜKLÜK   ne kadar?         (hedefe göre nerede)
 * ⇒ "zarar eden plan" ile "kârlı ama az kârlı plan" AYNI `RED`'i giyiyordu
 * ```
 *
 * `Q7` kadranı **yön** eksenini temiz aldı (`rag-quadrant.ts`). Bu dosya
 * **büyüklük** eksenidir — ve o eksen zaten sistemde vardı, adı
 * `Target ROI`.
 *
 * ⛔ **Ve kadranın inişi bu ekseni ZORUNLU KILDI, süs yapmadı.** Ölçülmüş
 * geçiş matrisi (`Z71 §1a`, `GP_ROI_PCT` eşikleri `green=20 · amber=10`):
 *
 * ```
 * iTO > 0 dilimi        ÖNCE     SONRA    kadran-sonrası kapsama
 * iGP ≤ 0 (ROI ≤ 0)     RED   →  AMBER    kadran konuşuyor
 * 0 < ROI < 10          RED   →  GREEN    ⛔ BU EKSEN olmasa SESSİZLEŞİRDİ
 * 10 ≤ ROI < 20         AMBER →  GREEN    ⛔ BU EKSEN olmasa SESSİZLEŞİRDİ
 * ```
 *
 * > Uyarının yerine **sessizlik** değil, **karşı yönde güvence** konuyordu:
 * > ekranda **"İYİ"**. `DISIPLIN`: *"beklenen yöne yanılan hata, ters yöne
 * > yanılandan tehlikelidir"* — bu onun en pahalı hâli.
 *
 * ⭐ Ekran `GREEN` **ve** *"hedefin altında"* rozetini **birlikte** gösterir.
 * Bu bir çelişki değil, **iki eksenin ayrı konuşmasıdır** — `S1`'in
 * (tanımlı-yokluk) deseniyle aynı: üçüncü durum, **tanımlı ve görünür**.
 */

/** Hedefin okunduğu KPI — eşik `kpis.target_roi_threshold` alanında yaşar. */
export const TARGET_ROI_KPI_CODE = 'GP_ROI_PCT' as const;

export type TargetRoiEvaluation =
  | { kind: 'BELOW_TARGET'; roi: number; threshold: number }
  | { kind: 'AT_OR_ABOVE_TARGET'; roi: number; threshold: number }
  | { kind: 'NOT_EVALUABLE'; reason: 'ROI_NULL' | 'THRESHOLD_NOT_CONFIGURED' };

/**
 * ⛔ **`decimal` KOLONLARI BU KODA DİZGE OLARAK GELİR.**
 *
 * Ölçüldü (canlı DB, 2026-08-31): `main.kpis.target_roi_threshold`
 * `pg_typeof = numeric`, `pg` sürücüsünün döndürdüğü `typeof === 'string'`,
 * değer `"20.0000"`. `Kpi` entity'sinde **transformer YOK** ve bu bilinçli
 * bir DUR kararı (`kpi.entity.ts`, `T-197/T-221` ikinci yarısı) — yani
 * dizge şekli **kalıcı**, bir kaza değil.
 *
 * ### Bu fonksiyon `T-343`'ün EN PAHALI HATASINI kapatır.
 * İlk yazımda normalizasyon **yoktu** ve zincir şöyleydi:
 * ```
 * entity transformer YOK           → threshold = "20.0000"
 * Number.isNaN("20.0000")          → false   ⇒ §2.5 kapısı HİÇ ÇALIŞMIYOR
 * 10.5 < "20.0000"                 → true    ⇒ karşılaştırma TESADÜFEN doğru
 * threshold.toFixed(1)             → ⛔ TypeError: not a function
 * ```
 * Reprodüksiyon koşuldu ve çökme **görüldü** (`T-343` kapanış raporu).
 *
 * 📌 Ve bu tam `§7.1`'in vakasıdır: kaldırılan `determineRagStatus`
 * **tam bu yüzden** `Number(greenThreshold)` yazıyordu, korunan
 * `plan.service.ts` bugün hâlâ `Number(...)` yapıyor — **yeni yol o
 * dönüşümü taşımadı.** Dönüşüm artık **tek noktada**, çağıranlarda değil.
 *
 * ⚠️ Bu bir sessiz varsayılan DEĞİL: çözülemeyen bir girdi `0` olmaz,
 * `null` olur ve çağıran `NOT_EVALUABLE` görür.
 */
function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Bir planın ROI'sini hedefine göre konumlar.
 *
 * ⛔ **Varsayılan eşik YOK** (`§2.5`). Hedef konfigüre edilmemişse cevap
 * *"hedefin altında"* değil, **`NOT_EVALUABLE`**'dır: bir eşiğin yokluğunda
 * *"altında"* demek, uydurulmuş bir hedefe göre yargı vermektir. Çağıran
 * bu dalda **uyarı üretmez** — ve bu bir sessiz-sıfır değil, ölçülemeyen
 * bir sorunun dürüst cevabıdır.
 *
 * Sınır: `roi === threshold` **hedefin ALTINDA DEĞİLDİR** (`<`, `<=` değil).
 */
export function evaluateTargetRoi(
  /** `plans.overall_roi` — `decimal`; transformer'ı var ama dizge de kabul edilir. */
  roi: number | string | null | undefined,
  /** `kpis.target_roi_threshold` — `decimal`, **transformer YOK** ⇒ DİZGE gelir. */
  threshold: number | string | null | undefined,
): TargetRoiEvaluation {
  // ⛔ Normalizasyon BURADA, çağıranlarda DEĞİL. Her çağıranın kendi
  // `Number(...)`'ını yazması `F8` ailesidir: bir çağıran unutur ve
  // kusur yalnız O yolda yaşar (tam olarak bu oldu).
  const roiNum = toFiniteNumber(roi);
  if (roiNum === null) {
    return { kind: 'NOT_EVALUABLE', reason: 'ROI_NULL' };
  }
  const thresholdNum = toFiniteNumber(threshold);
  if (thresholdNum === null) {
    return { kind: 'NOT_EVALUABLE', reason: 'THRESHOLD_NOT_CONFIGURED' };
  }
  // ⚠️ Karşılaştırma NORMALİZE edilmiş sayılar üzerinde. Dizgeyle de
  // "çalışıyordu" (JS zorlaması) — ama tesadüfen; `"9" < "20.0000"`
  // dizge karşılaştırması olsaydı FALSE derdi.
  return roiNum < thresholdNum
    ? { kind: 'BELOW_TARGET', roi: roiNum, threshold: thresholdNum }
    : { kind: 'AT_OR_ABOVE_TARGET', roi: roiNum, threshold: thresholdNum };
}

/**
 * `Z71 §1`'in kapısı: *"**`GREEN`** ∧ ROI < hedef"*.
 *
 * ⚠️ Neden yalnız `GREEN`: `RED`/`AMBER` planlar **kadran** tarafından zaten
 * konuşuluyor; onlara ikinci bir uyarı eklemek aynı planı iki kez saymak
 * olurdu. Renk `null` ise (kısmi kapsama ya da **değerlendirme dışı**) hiçbir
 * yargı verilmez — `S1`'in bu eksendeki karşılığı.
 */
export function isBelowTargetRoi(
  ragStatus: string | null | undefined,
  evaluation: TargetRoiEvaluation,
): boolean {
  return ragStatus === 'GREEN' && evaluation.kind === 'BELOW_TARGET';
}

/** Kullanıcıya gösterilen tek cümle — uyarı ve rozet AYNI kaynaktan. */
export function belowTargetRoiMessage(roi: number, threshold: number): string {
  return (
    `Hedefin altında: GP ROI %${roi.toFixed(1)}, hedef %${threshold.toFixed(1)}. ` +
    `Plan kâr üretiyor (RAG yeşil) ama hedeflenen getirinin altında.`
  );
}

import { FindOperator, In } from 'typeorm';

/**
 * `[]`'İN ANLAMI — TEK TANIM ([[T-254]]).
 *
 * Bir dizi filtresinin ÜÇ durumu vardır ve üçü de AYRI anlamlıdır:
 *
 * ```
 *   undefined / null  →  FİLTRE YOK          (bu boyut kısıtlanmıyor)
 *   []                →  BOŞ KÜME            (HİÇBİR SATIR)
 *   [a, b]            →  yalnız a, b
 * ```
 *
 * ⛔ Bu dosya, ikinci satırın bir kez yazıldığı yerdir. [[T-254]] öncesinde
 * aynı `[]` değeri iki katmanda ZIT yorumlanıyordu:
 *
 * ```
 *   dashboard.service.ts       `cplIds !== null`     → `[]` "filtre VAR"  → gönderilir
 *   finance-reporting.service  `cplIds.length > 0`   → `[]` "filtre YOK"  → KISIT DÜŞER
 * ```
 *
 * Sonuç canlı bir FAIL-OPEN'dı: kapsamı `PATCH /users/:id/scope`
 * (`intent: REVOKE_ALL`, [[T-242a]]) ile boşaltılmış bir kullanıcı
 * `/dashboard/summary`'nin `budgetUtilization` bölümünde TÜM TENANT'ın bütçe
 * tahsislerini görüyordu. Yani bir ERİŞİM KALDIRMA işlemi, o yüzeyde erişimi
 * GENİŞLETİYORDU.
 *
 * Bağlayıcı kural — `K-2.6.8a` (`docs/brd-v2/03_IS_KURALLARI/L2_03`):
 * *"Boş kapsam = ERİŞİM YOK. Tüm veriye erişim, açık bir joker atamasıyla..."*
 * Bu yüzden `[]` burada "hiçbir şey"dir; "her şey" DEĞİLDİR. `.length > 0`
 * ile kapı tutan her kontrol tam olarak bunun tersini yapar.
 *
 * ⚠️ Kısıtsızlık (`null`/`undefined`) ile boş küme (`[]`) arasındaki farkı
 * ÇAĞIRAN taşır. `AccessScopeService` bu ayrımı zaten üretiyor:
 * `UNRESTRICTED` → `null`, `pairs.length === 0` → `[]`
 * (`dashboard.service.ts#cplIdsFromScope`, R-2 fail-closed).
 *
 * 📌 `In([])`'in ürettiği SQL ÖLÇÜLDÜ (typeorm 0.3.28,
 * `node_modules/typeorm/query-builder/QueryBuilder.js`, `case "in"`):
 * parametre listesi boşsa literal `0=1` basılır — yani boş küme veritabanı
 * seviyesinde de fail-closed'dır, `IN ()` gibi geçersiz bir SQL ya da sessizce
 * düşen bir kısıt değil.
 */

/** `undefined`/`null` = filtre yok · `[]` = boş küme · dolu dizi = o küme. */
export type ArrayFilter<T> = readonly T[] | null | undefined;

/**
 * TypeORM `where` nesnesine spread edilecek parçayı üretir.
 *
 * ```ts
 * where: {
 *   tenantId,
 *   ...arrayFilterWhere('cplId', filters.cplIds),
 * }
 * ```
 *
 * `undefined`/`null` → `{}` (kısıt eklenmez) · `[]` → `In([])` → `0=1`.
 */
export function arrayFilterWhere<K extends string, T>(
  column: K,
  values: ArrayFilter<T>,
): { [P in K]?: FindOperator<T> } {
  if (values === undefined || values === null) {
    return {} as { [P in K]?: FindOperator<T> };
  }
  // Computed key + generic K: TS bunu `{ [x: string]: ... }` olarak çıkarır,
  // bu yüzden dönüş tipine daraltılıyor. Değer tarafı cast EDİLMİYOR.
  return { [column]: In([...values]) } as { [P in K]?: FindOperator<T> };
}

/**
 * Bir filtre DTO'suna spread edilecek alanı üretir — `arrayFilterWhere`'in
 * GÖNDERME tarafındaki eşi. İki katman böylece aynı sözleşmeyi okur.
 *
 * ```ts
 * const filters: ReportFilters = {
 *   startDate,
 *   endDate,
 *   ...arrayFilterField('cplIds', cplIds), // null → alan hiç yok · [] → []
 * };
 * ```
 *
 * ⚠️ Alanın YOKLUĞU ile `[]` farkı bilinçli: DTO alanı `undefined` ise alıcı
 * "bu boyut kısıtlanmamış" okur; `[]` ise "boş küme" okur. Bu yüzden `null`
 * için alan hiç yazılmaz — `{ cplIds: undefined }` yazmak, JSON serileştirme
 * ve `Object.keys` tabanlı kontrollerde iki durumu birbirine karıştırır.
 */
export function arrayFilterField<K extends string, T>(
  key: K,
  values: ArrayFilter<T>,
): { [P in K]?: T[] } {
  if (values === undefined || values === null) {
    return {} as { [P in K]?: T[] };
  }
  return { [key]: [...values] } as { [P in K]?: T[] };
}

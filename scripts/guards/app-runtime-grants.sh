#!/usr/bin/env bash
#
# Guard: app-runtime-grants  ([[T-250]], K-2.6.13f · [[T-362]] ÜÇÜNCÜ KAYNAK)
#
# [[T-249]] turunda ÜÇ vaka tek taramada çıktı: `notifications` · `brands` ·
# `mechanic_spend_breakdown` tablolarında `app_runtime`'ın SIFIR ayrıcalığı
# vardı ve üçünün de CANLI rotası vardı → her biri 500. Bu guard'ın değeri
# diğerlerinden FARKLI: statik olarak tespit EDİLEMEYEN bir sınıfı yakalar —
#
#     kod DOĞRU · rota CANLI · tablo VAR · izin YOK
#
# `tsc` görmez · `lint` görmez · unit testler görmez (repository mock'lu) ·
# e2e yalnız o uca dokunan bir spec varsa görür (T-249'un üç vakasında da
# yoktu). Sınıf: T-052/T-062'nin ("mekanizma var, yol yok") TERSİ — burada
# yol var, izin yok.
#
# --- [[T-362]] — İKİ KAYNAK DA KODDU, ORTAM HİÇ ÖLÇÜLMÜYORDU ----------------
#
# `02-runtime-grants.sql:724` bir GRANT'i BEYAN EDİYORDU, canlı DB'de
# `app_runtime`'ın SIFIR ayrıcalığı VARDI, bu guard (o zamanki hâliyle,
# yalnız A\B) YEŞİLDİ, ve `POST /master-data/baseline-volumes/upload` her
# çağrıda 500 döndü. Kaynak A (kod-ihtiyacı) ve kaynak B (SQL-beyanı) —
# ikisi de KODDU, hiçbiri KOŞAN SİSTEM değildi. Ürün sahibi hükmü (`Z93 §3`,
# T-362 brief): TEK kapı, ÜÇ kaynak — kaynak C = CANLI DB. İkinci bir guard
# AÇILMADI (evreni böler, "ihlal hangisinde?" sorusu doğar).
#
# --- Guard'ın ŞEKLİ (ürün sahibi tarafından belirlendi) ----------------------
#
#   kaynak A   modüllerde TypeOrmModule.forFeature([...]) İLE
#              @InjectRepository(...) İLE dataSource.getRepository(...) İLE
#              enjekte/erişilen entity'lerin TABLO adları
#              (@Entity({ name: '...' })'den — sınıf adından DEĞİL,
#              CLAUDE.md: "tanımının yaşadığı yüzeyde ara")
#   kaynak B   scripts/db-roles/02-runtime-grants.sql'in app_runtime'a
#              GRANT verdiği tablo adları
#   kaynak C   CANLI DB'de app_runtime'ın GERÇEKTEN sahip olduğu tablo
#              ayrıcalıkları (has_table_privilege — bkz. aşağıdaki not)
#   kontrol    A \ C = ∅  (BUGÜNÜN VAKASI — kod ihtiyaç duyuyor, DB'de YOK)
#              B \ C = ∅  ("betik uygulanmamış" — SQL beyan ediyor, DB'de YOK)
#              C \ B = ∅  (KAYIT-DIŞI hak — DB'de var, beyanda YOK, Z51 ihlali)
#              A \ B = ∅  (MEVCUT kontrol — DEĞİŞMEDİ, T-250'den beri aynı)
#
#   ⛔ B \ A (beyan var, kod ihtiyaç duymuyor = fazla yetki) BİLEREK EKLENMEDİ.
#   `T-362` turunda ÖLÇÜLDÜ: bugün 2 satır (`lta_plan_overrides`,
#   `v_budget_summary`) — SIFIR DEĞİL. Brief §2: "sıfır değilse DUR ve
#   raporla — kırmızı doğan kapı ölür, ve bu ürün sahibinin kararı." Bu
#   yön product-owner kararı BEKLİYOR (T-362 raporunda PİN 6 ayrıntılı);
#   guard'a eklenmedi.
#
# Çıkarım mantığı üç companion .awk dosyasında (SABİT PENCERE YOK — blok
# sınırıyla, T-249'un `grep -A2` tuzağının tekrarı önlenir):
#   app-runtime-grants-source.awk    (kaynak A, ÜÇ kanal — bkz. o dosyanın
#                                      başlığı: DUR #1, T-250, `budget.
#                                      repository.ts:488,502`'de ölçülen kör
#                                      nokta kapatıldı)
#   app-runtime-grants-entities.awk  (sınıf → tablo eşlemesi)
#   app-runtime-grants-grants.awk    (kaynak B)
#
# --- kaynak C — BAĞLANTI DESENİ (§7: ÖNCE ARA, yeni desen YAZILMADI) --------
#
# `app-operator-grants.sh` / `view-security-invoker.sh` / `bypassrls-
# hygiene.sh` üçü de aynı `db_query()` şeklini kullanıyor: env override
# (test/self-test için) yoksa `docker exec -i collmind-tpm-postgres psql
# -U app_operator -d collmind_tpm ...`. Bu guard AYNI deseni, AYNI rolle
# (`app_operator`) kullanıyor — yeni bir bağlantı deseni YAZILMADI.
#
# ⚠️ ROL SEÇİMİ ÖLÇÜLDÜ (T-362): `information_schema.role_table_grants`
# `grantee='app_runtime'` filtresiyle `app_operator` bağlantısından SIFIR
# satır döner (Postgres bu view'ı yalnız "grantor/grantee = mevcut etkin
# rol, ya da o role admin option" ile sınırlar — `app_operator`'ın
# `app_runtime` ile böyle bir ilişkisi yok). Süperüzer (`postgres`) ile
# AYNI sorgu 110 satır döndü — yani `app_operator` ile `role_table_grants`
# kullanmak SESSİZCE eksik bir kaynak C üretirdi (§2.7 #4/#9 sınıfı: "kod
# doğru görünüyor, evren eksik"). Bunun yerine `has_table_privilege(role,
# oid, priv)` kullanılıyor — bu fonksiyon rol-görünürlüğü kısıtına TABİ
# DEĞİL (her rol, herhangi bir rol için sorabilir) ve kolon-düzeyi
# ayrıcalığı da tablo-düzeyinde SAYAR (aynı "kolon düzeyi kapsam dışı"
# sınırıyla TUTARLI — yukarıdaki "İKİ SINIR" notu). `app_operator`
# bağlantısıyla ölçüldü: 43/43 eşleşme, üç sıfır fark (bkz. T-362 raporu).
#
# --- ⛔ İKİ SINIR — bilerek KAPSAM DIŞI (ürün sahibi) ------------------------
#
#   1. KOLON DÜZEYİ — `M1`'de `user_scopes` kolon-kısıtlı GRANT aldı
#      (`GRANT UPDATE (created_by, ...) ON ...`). Bu guard yalnız "tablo
#      listede mi" sorar, "hangi kolonlar" sormaz. Bir tablonun HERHANGİ bir
#      ayrıcalığı varsa (SELECT/INSERT/UPDATE/DELETE, tablo VEYA kolon
#      düzeyinde) kaynak B/C'de sayılır.
#   2. SELECT vs INSERT/UPDATE/DELETE AYRIMI — guard "hiç ayrıcalık yok"u
#      yakalar; "okuyor ama yazamıyor" (ör. yalnız SELECT verilmiş bir
#      tabloya INSERT gerektiren yeni bir yol eklenmesi) durumunu YAKALAMAZ.
#
#   İkisi de DAHA DAR bir kusur sınıfı, ve bugün vakası yok (İlke 1).
#
# --- ÜÇÜNCÜ KANAL (kaynak A) — DUR #1 kapatıldı (ürün sahibi kararı, T-250) -
#
#   `BudgetSummaryView` (`src/database/entities/budget-summary.view-entity.ts`)
#   ne `forFeature` ne `InjectRepository` ile enjekte ediliyordu — YALNIZ
#   `budget.repository.ts:488,502`'de `this.dataSource.getRepository(
#   BudgetSummaryView)` DOĞRUDAN çağrısıyla kullanılıyordu (İKİ çağrı yeri,
#   ürün sahibi tarafından ayrıca ölçüldü). Kaynak A artık bu kanalı
#   KAPSIYOR — bkz. `app-runtime-grants-source.awk`'ın `scan_dr` fonksiyonu.
#
#   `manager.getRepository(X)` / `m.getRepository(X)` (transaction-içi
#   çağrılar) DÖRDÜNCÜ bir kanal olarak EKLENMEDİ — 14 sınıf ölçüldü, hepsi
#   zaten forFeature/InjectRepository birleşiminde MEVCUTTU (`comm -23` → 0
#   fark). ~~Bugün eklemek kaynak A'yı DEĞİŞTİRMEZ~~; ölçüm `*-source.awk`'ın
#   başlığında ayrıntılı.
#
#   ⛔ ⛔ O ÖLÇÜM ESKİDİ — `T-372` (2026-09-04, `Z95`). `F12`: üstteki cümle
#   SİLİNMEDİ, üstü çizildi. Kaynak C eklenince `B \ A` = 2 satır çıktı ve
#   ikisi de FAZLA YETKİ DEĞİL, kaynak A'nın KÖR NOKTASI:
#
#     v_budget_summary      forFeature/InjectRepository = 0  (ÖLÇÜLDÜ)
#                           erişim: budget-tier-notification.service.ts:129
#                           `manager.getRepository(BudgetSummaryView)`
#                           ⇒ DÖRDÜNCÜ KANAL artık kaynak A'yı DEĞİŞTİRİYOR
#
#     lta_plan_overrides    lta.module.ts:16 — forFeature'a BİLEREK konmadı
#                           erişim: lta-agreement.repository.ts:128
#                           `.leftJoinAndSelect('lta.planOverrides', …)`
#                           ⇒ BEŞİNCİ KANAL: İLİŞKİ YÜKLEMESİ. Bir `@OneToMany`
#                             relation'ı üzerinden SELECT edilen tablo, ÜÇ
#                             kanalın HİÇBİRİNDE görünmez.
#
#   📌 Ve iki GRANT'ın da o satırlarda olma SEBEBİ ölçülmüş bir `500`'dü
#   (`lta-agreement.repository.ts:120-127` yorumu: *"yalnız join eklenseydi bu
#   sorgu YENİ bir 500 verirdi — `lta_plan_overrides` SELECT'i app_runtime'da
#   YOKTU"*). Yani SQL BEYANI, koddan türetilen A kümesinden DAHA DOĞRUYDU.
#
#   ⇒ `B \ A` (fazla yetki) yönü bu yüzden guard'a EKLENMEDİ: kaynak A kör
#     olduğu sürece o yön MEŞRU GRANT'ları kırmızı yakar. Önce `T-372`
#     türetmeyi genişletir, SONRA yön eklenir. (Ürün sahibi kararı, 2026-09-04.)
#
# --- POZİTİF KONTROL (self-test'te ayrıca ölçülür) --------------------------
#
#   1. Bilinen bir tabloyu GRANT listesinden çıkarmak KIRMIZI vermeli.
#   2. Kaynak A boş türetilirse (desen bozulmuşsa) SESSİZCE YEŞİL DEĞİL,
#      SETUP HATASI (exit 2) vermeli — aksi hâlde `A \ ∅ = ∅` guard'ı
#      sessizce köreltir.
#   3. [[T-362]] Kaynak C BOŞ türetilebilir ve bu bir SETUP HATASI DEĞİLDİR
#      (canlıda gerçekten sıfır ayrıcalık olabilir — TAM OLARAK bugünün
#      vakası). `A \ ∅ = A` olduğu için boş C sessizce yeşile DÜŞMEZ, tam
#      tersi: A'nın TAMAMI bulgu üretir. Yalnız DB'ye ULAŞILAMAMASI (db_query
#      non-zero exit) ÖLÇEMEDİM'dir (exit 2) — boş SONUÇ değil.
#
# GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
# Allowlist parse hatası        → exit 2 (her iki modda da)
# Setup hatası (A veya B boş türetildi, ya da dizin/dosya yok) → exit 2
# DB'ye ulaşılamadı (kaynak C)  → exit 2 ("ÖLÇEMEDİM", SESSİZ YEŞİL DEĞİL)
set -uo pipefail

GUARD_NAME="app-runtime-grants"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"
cd "$ROOT"

validate_allowlist "$ALLOWLIST" || exit 2

# Fixture yönlendirmesi için (self-test) — üretimde set edilmez, varsayılan
# davranış değişmez. migration-schema.sh'in GUARD_MIG_DIR deseniyle aynı aile.
SRC_DIR="${GUARD_ARTG_SRC_DIR:-$ROOT/src}"
ENTITIES_DIR="${GUARD_ARTG_ENTITIES_DIR:-$ROOT/src/database/entities}"
GRANTS_SQL="${GUARD_ARTG_GRANTS_SQL:-$ROOT/scripts/db-roles/02-runtime-grants.sql}"

if [ ! -d "$SRC_DIR" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: kaynak dizini bulunamadı: $SRC_DIR — ölçüm YAPILMADI" >&2
  exit 2
fi
if [ ! -d "$ENTITIES_DIR" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: entities dizini bulunamadı: $ENTITIES_DIR — ölçüm YAPILMADI" >&2
  exit 2
fi
if [ ! -f "$GRANTS_SQL" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: grants.sql bulunamadı: $GRANTS_SQL — ölçüm YAPILMADI" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

AWK_SOURCE="$ROOT/scripts/guards/app-runtime-grants-source.awk"
AWK_ENTITIES="$ROOT/scripts/guards/app-runtime-grants-entities.awk"
AWK_GRANTS="$ROOT/scripts/guards/app-runtime-grants-grants.awk"

# --- kaynak A, adım 1: sınıf adları (forFeature ∪ InjectRepository ∪ ----------
#                        dataSource.getRepository — DUR #1, T-250) -----------
# `src/database/seeds/` HARİÇ TUTULUR: seed script'leri `app_migrate` (DDL-
# yetkili CLI rolü) ile çalışır, `app_runtime` ile DEĞİL (K-2.6.13). O dizin
# `dataSource.getRepository(X)`'i YOĞUN kullanıyor (ölçüldü: 30+ çağrı, 20
# dosya) — dahil edilseydi app_runtime'ın hiç dokunmadığı tablolar (ör.
# `BudgetPolicy`/`FiscalPeriod`, yalnız seed'de) sahte bulgu üretirdi. Bkz.
# app-runtime-grants-source.awk'ın başlık notu (aynı gerekçe orada da yazılı).
: > "$TMP/classes.txt"
while IFS= read -r -d '' f; do
  awk -f "$AWK_SOURCE" "$f" >> "$TMP/classes.txt"
done < <(find "$SRC_DIR" -type f -name "*.ts" ! -name "*.spec.ts" ! -path "*/database/seeds/*" -print0)
sort -u "$TMP/classes.txt" -o "$TMP/classes.txt"

# --- kaynak A, adım 2: sınıf → tablo eşlemesi (@Entity name:) ----------------
: > "$TMP/entity-map.txt"
: > "$TMP/unmapped.txt"
for f in "$ENTITIES_DIR"/*.entity.ts; do
  [ -f "$f" ] || continue
  awk -f "$AWK_ENTITIES" "$f" >> "$TMP/entity-map.txt" 2>> "$TMP/unmapped.txt"
done

# --- kaynak A, adım 3: sınıf adlarını tablo adlarına çevir -------------------
awk 'NR==FNR { map[$1]=$2; next } { if ($1 in map) print map[$1] }' \
  "$TMP/entity-map.txt" "$TMP/classes.txt" | sort -u > "$TMP/a-tables.txt"

A_COUNT="$(wc -l < "$TMP/a-tables.txt" | tr -d ' ')"
if [ "$A_COUNT" -eq 0 ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: kaynak A boş türetildi (0 tablo)." >&2
  echo "!! Bu, deseni bozan bir değişikliğin sonucu olabilir (T-249'da tam" >&2
  echo "!! bu şekilde 11 tablonun 11'i 'entity=YOK' çıkmıştı). A \\ ∅ = ∅" >&2
  echo "!! olduğu için bu durumu sessizce geçmek guard'ı köreltir — ölçüm YAPILMADI." >&2
  exit 2
fi

# --- kaynak B: GRANT verilen tablolar -----------------------------------------
awk -f "$AWK_GRANTS" "$GRANTS_SQL" 2>"$TMP/grants-stderr.txt" | sort -u > "$TMP/b-tables.txt"

B_COUNT="$(wc -l < "$TMP/b-tables.txt" | tr -d ' ')"
if [ "$B_COUNT" -eq 0 ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: kaynak B boş türetildi (0 tablo) —" >&2
  echo "!! $GRANTS_SQL ayrıştırılamadı ya da beklenmedik bir biçimde. Ölçüm YAPILMADI." >&2
  exit 2
fi
if [ -s "$TMP/grants-stderr.txt" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: $GRANTS_SQL'de kapanmamış bir GRANT ifadesi bulundu." >&2
  cat "$TMP/grants-stderr.txt" >&2
  exit 2
fi

# --- kaynak C: CANLI DB'de app_runtime'ın gerçekten sahip olduğu tablolar ---
# `GUARD_ARTG_DB_QUERY` (self-test için, app-operator-grants/view-security-
# invoker ile AYNI aile) yoksa `docker exec ... psql -U app_operator` ile
# gerçek bağlantı. `has_table_privilege` seçimi ve gerekçesi başlıkta.
db_query() {
  local sql="$1"
  if [ -n "${GUARD_ARTG_DB_QUERY:-}" ] && [ -x "$GUARD_ARTG_DB_QUERY" ]; then
    "$GUARD_ARTG_DB_QUERY" "$sql"
    return $?
  fi
  docker exec -i collmind-tpm-postgres psql -U app_operator -d collmind_tpm \
    -v ON_ERROR_STOP=1 -t -A -c "$sql" 2>/dev/null
  return $?
}

C_SQL="SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'main' AND c.relkind IN ('r','v','m','p') AND (has_table_privilege('app_runtime', c.oid, 'SELECT') OR has_table_privilege('app_runtime', c.oid, 'INSERT') OR has_table_privilege('app_runtime', c.oid, 'UPDATE') OR has_table_privilege('app_runtime', c.oid, 'DELETE')) ORDER BY 1;"

if ! C_ROWS="$(db_query "$C_SQL")"; then
  echo "!! [$GUARD_NAME] ÖLÇEMEDİM: canlı DB'ye ulaşılamadı (docker kapalı olabilir) — kaynak C ölçülemedi, exit 2" >&2
  echo "!! SESSİZ YEŞİL DEĞİL: DB ulaşılamazken A\\C/B\\C/C\\B kontrol EDİLEMEZ, guard bunu 'temiz' saymaz." >&2
  exit 2
fi
printf '%s\n' "$C_ROWS" | awk 'NF' | sort -u > "$TMP/c-tables.txt"
# NOT: c-tables.txt BOŞ olabilir ve bu bir SETUP HATASI DEĞİLDİR (yukarıdaki
# başlık notu #3) — canlıda gerçekten sıfır ayrıcalık, T-362'nin vakası.

scan_ab() {
  comm -23 "$TMP/a-tables.txt" "$TMP/b-tables.txt" | while IFS= read -r tbl; do
    [ -z "$tbl" ] && continue
    echo "[$GUARD_NAME] table:$tbl"
    echo "  app_runtime bu tabloya erişen bir entity enjekte ediliyor (forFeature/InjectRepository)"
    echo "  ama $GRANTS_SQL bu tabloya app_runtime için HİÇBİR ayrıcalık vermiyor"
    echo "  > kod DOĞRU olabilir, rota CANLI olabilir — tablo VAR, izin YOK (T-249 sınıfı)"
  done
}

scan_ac() {
  comm -23 "$TMP/a-tables.txt" "$TMP/c-tables.txt" | while IFS= read -r tbl; do
    [ -z "$tbl" ] && continue
    echo "[$GUARD_NAME] table:$tbl:not-live"
    echo "  app_runtime bu tabloya erişen bir entity enjekte ediliyor (forFeature/InjectRepository)"
    echo "  ama CANLI DB'de app_runtime bu tabloda HİÇBİR ayrıcalığa sahip DEĞİL"
    echo "  > kod DOĞRU, SQL beyanı doğru bile olabilir — ORTAM uygulanmamış (T-362 sınıfı, upload-500 vakası)"
  done
}

scan_bc() {
  comm -23 "$TMP/b-tables.txt" "$TMP/c-tables.txt" | while IFS= read -r tbl; do
    [ -z "$tbl" ] && continue
    echo "[$GUARD_NAME] table:$tbl:not-applied"
    echo "  $GRANTS_SQL bu tabloya app_runtime için ayrıcalık BEYAN ediyor"
    echo "  ama CANLI DB'de app_runtime bu tabloda HİÇBİR ayrıcalığa sahip DEĞİL"
    echo "  > betik yazılmış ama UYGULANMAMIŞ (npm run db:roles:grants koşulmamış olabilir)"
  done
}

scan_cb() {
  comm -23 "$TMP/c-tables.txt" "$TMP/b-tables.txt" | while IFS= read -r tbl; do
    [ -z "$tbl" ] && continue
    echo "[$GUARD_NAME] table:$tbl:undeclared-live"
    echo "  CANLI DB'de app_runtime bu tabloda bir ayrıcalığa sahip"
    echo "  ama $GRANTS_SQL bunu HİÇ beyan etmiyor"
    echo "  > kayıt-dışı canlı GRANT sapması (Z51 §2 sınıfının tekrarı, app_runtime'da)"
  done
}

report_guard "$(scan_ab; scan_ac; scan_bc; scan_cb)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

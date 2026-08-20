#!/usr/bin/env bash
#
# Guard: app-runtime-grants  ([[T-250]], K-2.6.13f)
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
# --- Guard'ın ŞEKLİ (ürün sahibi tarafından belirlendi) ----------------------
#
#   kaynak A   modüllerde TypeOrmModule.forFeature([...]) İLE
#              @InjectRepository(...) İLE dataSource.getRepository(...) İLE
#              enjekte/erişilen entity'lerin TABLO adları
#              (@Entity({ name: '...' })'den — sınıf adından DEĞİL,
#              CLAUDE.md: "tanımının yaşadığı yüzeyde ara")
#   kaynak B   scripts/db-roles/02-runtime-grants.sql'in app_runtime'a
#              GRANT verdiği tablo adları
#   kontrol    A \ B = ∅
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
# --- ⛔ İKİ SINIR — bilerek KAPSAM DIŞI (ürün sahibi) ------------------------
#
#   1. KOLON DÜZEYİ — `M1`'de `user_scopes` kolon-kısıtlı GRANT aldı
#      (`GRANT UPDATE (created_by, ...) ON ...`). Bu guard yalnız "tablo
#      listede mi" sorar, "hangi kolonlar" sormaz. Bir tablonun HERHANGİ bir
#      ayrıcalığı varsa (SELECT/INSERT/UPDATE/DELETE, tablo VEYA kolon
#      düzeyinde) kaynak B'de sayılır.
#   2. SELECT vs INSERT/UPDATE/DELETE AYRIMI — guard "hiç ayrıcalık yok"u
#      yakalar; "okuyor ama yazamıyor" (ör. yalnız SELECT verilmiş bir
#      tabloya INSERT gerektiren yeni bir yol eklenmesi) durumunu YAKALAMAZ.
#
#   İkisi de DAHA DAR bir kusur sınıfı, ve bugün vakası yok (İlke 1).
#
# --- ÜÇÜNCÜ KANAL — DUR #1 kapatıldı (ürün sahibi kararı, T-250) ------------
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
#   fark). Bugün eklemek kaynak A'yı DEĞİŞTİRMEZ; ölçüm `*-source.awk`'ın
#   başlığında ayrıntılı.
#
# --- POZİTİF KONTROL (self-test'te ayrıca ölçülür) --------------------------
#
#   1. Bilinen bir tabloyu GRANT listesinden çıkarmak KIRMIZI vermeli.
#   2. Kaynak A boş türetilirse (desen bozulmuşsa) SESSİZCE YEŞİL DEĞİL,
#      SETUP HATASI (exit 2) vermeli — aksi hâlde `A \ ∅ = ∅` guard'ı
#      sessizce köreltir.
#
# GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
# Allowlist parse hatası        → exit 2 (her iki modda da)
# Setup hatası (A veya B boş türetildi, ya da dizin/dosya yok) → exit 2
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

scan() {
  comm -23 "$TMP/a-tables.txt" "$TMP/b-tables.txt" | while IFS= read -r tbl; do
    [ -z "$tbl" ] && continue
    echo "[$GUARD_NAME] table:$tbl"
    echo "  app_runtime bu tabloya erişen bir entity enjekte ediliyor (forFeature/InjectRepository)"
    echo "  ama $GRANTS_SQL bu tabloya app_runtime için HİÇBİR ayrıcalık vermiyor"
    echo "  > kod DOĞRU olabilir, rota CANLI olabilir — tablo VAR, izin YOK (T-249 sınıfı)"
  done
}

report_guard "$(scan)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

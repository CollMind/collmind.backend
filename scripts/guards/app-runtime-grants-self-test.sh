#!/usr/bin/env bash
#
# self-test — app-runtime-grants ([[T-250]]).
#
# Gerçek guard'ı (`app-runtime-grants.sh`) kendi ENV override'ları
# (`GUARD_ARTG_SRC_DIR` / `GUARD_ARTG_ENTITIES_DIR` / `GUARD_ARTG_GRANTS_SQL`)
# ile fixture ağacına yönlendirerek çağırır — mantığın hiçbir parçasını
# yeniden UYGULAMAZ (ADR 0007 E16: kontrolünü kendi kopyasıyla sınayan bir
# self-test, kopyadaki regresyona kördür).
#
# Fixture kaynak dosyaları `.ts.fixture` uzantısıyla saklanır (self-test.sh'in
# aynı gerekçesi: `tsconfig.json`'da include/exclude yok, `scripts/` altında
# gerçek bir `.ts` dosyası `npm run lint`/`tsc`'ye sessizce girerdi — ölçüldü,
# T-250 hazırlığında `changed-ts.sh` bu üç dosyayı `.ts` uzantısıyla YAKALADI).
# Bu script onları geçici bir dizine GERÇEK `.ts` adıyla kopyalar, guard'ı
# oraya yönlendirir.
#
# fixtures/app-runtime-grants/entities/fixture.entity.ts.fixture DOKUZ entity taşır.
# ÜÇ KANALIN HER BİRİ kendi "GRANT'li" (bulgu OLMAMALI) ve "GRANT'siz/
# detector-alive" (HER ZAMAN bulgu) çiftini taşır — ürün sahibinin ek şartı:
# "fixture iki kanalda birden görünürse test hangisinin çalıştığını ayırt
# edemez" (§2.7 #6), o yüzden HER sınıf tek bir kanaldan erişilir:
#   kanal 1 (forFeature)              FixtureGranted          → bulgu YOK
#                                      FixtureIndexed (dekoratör arası —
#                                      T-249 pini)             → bulgu YOK
#                                      FixtureMissing           → HER ZAMAN bulgu
#   kanal 2 (@InjectRepository)       FixtureInjected          → bulgu YOK
#                                      FixtureInjectedMissing   → HER ZAMAN bulgu
#   kanal 3 (dataSource.getRepository — DUR #1, T-250)
#                                      FixtureDirectGranted     → bulgu YOK
#                                      FixtureDirectMissing     → HER ZAMAN bulgu
#   (hiçbiri)                         FixtureGhost — yalnız yorumda anılır
#                                      → kaynak A'ya hiç girmemeli
#
# "HER ZAMAN bulgu" sınıfları (lint-ratchet-self-test.sh'in "error fixture"ıyla
# aynı rol) hem STANDING assertion olarak (case 1/10/11) hem de KANAL
# BAĞIMSIZLIĞI mutasyon testinde (case 13-15: her kanalın kendi deseni
# BOZULUR, YALNIZ o kanalın pini kaybolmalı, diğer ikisi etkilenmemeli)
# kullanılır.
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/app-runtime-grants.sh"
FIXDIR="$DIR/fixtures/app-runtime-grants"
FIX_SRC="$FIXDIR/src"
FIX_ENTITIES="$FIXDIR/entities"
GRANTS_COMPLETE="$FIXDIR/grants-complete.sql"
GRANTS_FULL="$FIXDIR/grants-full.sql"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: $GUARD yok" >&2
  exit 1
fi
if [ ! -d "$FIX_SRC" ] || [ ! -d "$FIX_ENTITIES" ] || [ ! -f "$GRANTS_COMPLETE" ] || [ ! -f "$GRANTS_FULL" ]; then
  echo "!! self-test: fixtures/app-runtime-grants/ eksik — guard doğrulanamıyor" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# `.ts.fixture` → gerçek `.ts` adıyla geçici ağaca kopyala (yukarıdaki
# başlık notu — repo'nun gerçek `src`/`tsc`/`lint` kapsamına asla girmemeli).
SRC_DIR="$TMP/src"
ENTITIES_DIR="$TMP/entities"
mkdir -p "$SRC_DIR" "$ENTITIES_DIR"
for f in "$FIX_SRC"/*.ts.fixture; do
  cp "$f" "$SRC_DIR/$(basename "$f" .fixture)"
done
for f in "$FIX_ENTITIES"/*.entity.ts.fixture; do
  cp "$f" "$ENTITIES_DIR/$(basename "$f" .fixture)"
done

# [[T-362]] — kaynak C (CANLI DB) mock'ları. Case 1-15 yalnız A\B semantiğini
# sınıyor; kaynak C'yi mock'lamazsak `run()` gerçek `docker exec`'e düşer —
# hem hermetik-olmayan bir self-test üretir hem de fixture tabloları canlı
# DB'de HİÇ olmadığı için (var olmaları da beklenmez) A\C/B\C her çağrıda
# gürültülü bulgu üretir. Çözüm: kaynak C'yi İLGİLİ .sql fixture'ının kaynak
# B'siyle AYNI tutan bir mock — böylece eski assertion'lar (hepsi `$`
# ile ÇAPALI, `:not-live`/`:not-applied`/`:undeclared-live` sonekli yeni
# anahtarlarla ÇAKIŞMAZ) davranışını KORUR. Kaynak C'ye özgü yönler (PIN
# 2-5) ayrı, adanmış case'lerde (16-19) sınanıyor.
mk_db_mock() { # <hedef-dosya> <tablo1> <tablo2> ...
  local f="$1"; shift
  {
    echo '#!/usr/bin/env bash'
    printf 'printf '\''%%s\\n'\'' '
    for t in "$@"; do printf "'%s' " "$t"; done
    echo
    echo 'exit 0'
  } > "$f"
  chmod +x "$f"
}

DB_MOCK_COMPLETE="$TMP/db-mock-complete.sh"
mk_db_mock "$DB_MOCK_COMPLETE" fixture_granted fixture_indexed fixture_injected fixture_direct_granted

DB_MOCK_FULL="$TMP/db-mock-full.sh"
mk_db_mock "$DB_MOCK_FULL" fixture_granted fixture_indexed fixture_injected \
  fixture_injected_missing fixture_direct_granted fixture_direct_missing fixture_missing

FAIL=0

run() { # <grants-sql> [mode] [db-mock]
  local dbmock="${3:-}"
  if [ -z "$dbmock" ]; then
    case "$1" in
      "$GRANTS_COMPLETE") dbmock="$DB_MOCK_COMPLETE" ;;
      "$GRANTS_FULL")     dbmock="$DB_MOCK_FULL" ;;
      *)
        echo "!! self-test SETUP HATASI: run() üçüncü argümansız, tanınmayan bir grants-sql ile çağrıldı: $1" >&2
        echo "!! (mutasyon üreten her call site DB mock'unu AÇIKÇA üçüncü argümanla vermeli — sessiz varsayılan YOK)" >&2
        exit 2
        ;;
    esac
  fi
  GUARD_ARTG_SRC_DIR="$SRC_DIR" GUARD_ARTG_ENTITIES_DIR="$ENTITIES_DIR" \
    GUARD_ARTG_GRANTS_SQL="$1" GUARD_ARTG_DB_QUERY="$dbmock" GUARD_MODE="${2:-report}" bash "$GUARD"
}

# --- case 1: detector alive — FixtureMissing HER ZAMAN bulgu vermeli --------
OUT1="$(run "$GRANTS_COMPLETE" report)"; RC1=$?
if [ "$RC1" -ne 0 ]; then
  echo "!! self-test FAIL [case 1]: report modu exit 0 bekleniyordu, $RC1 bulundu" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi
if ! grep -q '^\[app-runtime-grants\] table:fixture_missing$' <<< "$OUT1"; then
  echo "!! self-test FAIL [case 1: detector-alive]: 'table:fixture_missing' bulgusu YOK" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# --- case 2: dekoratör arası (FixtureIndexed) — T-249 pini -----------------
# İKİ yönlü kontrol, tek yönlü DEĞİL: "bulgu YOK" tek başına yetersiz —
# FixtureIndexed kaynak A'dan SESSİZCE düşse (mapping kırılsa) de aynı "bulgu
# yok" sonucunu verir, YANLIŞ NEDENLE (§2.7: "desen çalışır, evren eksik").
# Bu yüzden GRANT'i MUTE EDİP FixtureIndexed'in GERÇEKTEN kaynak A'da
# İZLENDİĞİNİ (yani şimdi bulgu VERMESİ gerektiğini) de kanıtla — tam olarak
# case 7'nin tekniği, T-249'un asıl regresyonuna uygulanmış hâli.
if grep -q '^\[app-runtime-grants\] table:fixture_indexed$' <<< "$OUT1"; then
  echo "!! self-test FAIL [case 2a: GRANT'li ama bulgu var]: 'fixture_indexed' GRANT'li olmasına rağmen bulgu verdi" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi
MUTATED_IDX="$TMP/grants-mutated-indexed.sql"
grep -v 'fixture_indexed' "$GRANTS_COMPLETE" > "$MUTATED_IDX"
if grep -q 'fixture_indexed' "$MUTATED_IDX"; then
  echo "!! self-test SETUP HATASI [case 2b]: mutasyon uygulanmadı, 'fixture_indexed' hâlâ dosyada" >&2
  FAIL=1
else
  OUT2B="$(run "$MUTATED_IDX" report "$DB_MOCK_COMPLETE")"
  if ! grep -q '^\[app-runtime-grants\] table:fixture_indexed$' <<< "$OUT2B"; then
    echo "!! self-test FAIL [case 2b: T-249 sabit-pencere tuzağı geri geldi]: GRANT satırı silindi ama 'table:fixture_indexed' bulgusu YOK — FixtureIndexed muhtemelen kaynak A'dan SESSİZCE düştü (dekoratör-arası eşleme kırık)" >&2
    printf '%s\n' "$OUT2B" >&2
    FAIL=1
  fi
fi

# --- case 3: kanal 2 (@InjectRepository) tek başına yeterli — İKİ yönlü ----
# Aynı gerekçe case 2b ile: "bulgu yok" tek başına kanal 2'nin çalıştığını
# KANITLAMAZ — kanal tamamen kırılsa (hiç tetiklenmese) da FixtureInjected
# kaynak A'ya hiç girmez ve sonuç yine "bulgu yok" olur, YANLIŞ NEDENLE.
if grep -q '^\[app-runtime-grants\] table:fixture_injected$' <<< "$OUT1"; then
  echo "!! self-test FAIL [case 3a: InjectRepository kanalı]: 'fixture_injected' GRANT'li olmasına rağmen bulgu verdi" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi
MUTATED_INJ="$TMP/grants-mutated-injected.sql"
grep -v 'fixture_injected' "$GRANTS_COMPLETE" > "$MUTATED_INJ"
if grep -q 'fixture_injected' "$MUTATED_INJ"; then
  echo "!! self-test SETUP HATASI [case 3b]: mutasyon uygulanmadı, 'fixture_injected' hâlâ dosyada" >&2
  FAIL=1
else
  OUT3B="$(run "$MUTATED_INJ" report "$DB_MOCK_COMPLETE")"
  if ! grep -q '^\[app-runtime-grants\] table:fixture_injected$' <<< "$OUT3B"; then
    echo "!! self-test FAIL [case 3b: InjectRepository kanalı ölü]: GRANT satırı silindi ama 'table:fixture_injected' bulgusu YOK — kanal 2 muhtemelen hiç tetiklenmiyor" >&2
    printf '%s\n' "$OUT3B" >&2
    FAIL=1
  fi
fi

# --- case 4: yalnız yorumda geçen sınıf (FixtureGhost) kaynak A'ya SIZMAMALI
if grep -q 'fixture_ghost' <<< "$OUT1"; then
  echo "!! self-test FAIL [case 4: yorum sızıntısı]: 'fixture_ghost' hiçbir kanalda enjekte edilmiyor ama bulgu/A'da göründü" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# --- case 5: normal (GRANT'li) fixture bulgu ÜRETMEMELİ ---------------------
if grep -q '^\[app-runtime-grants\] table:fixture_granted$' <<< "$OUT1"; then
  echo "!! self-test FAIL [case 5]: 'fixture_granted' GRANT'li olmasına rağmen bulgu verdi" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# --- case 6: tam temiz ağaç (grants-full.sql) → SIFIR bulgu, exit 0 ---------
OUT6="$(run "$GRANTS_FULL" report)"; RC6=$?
if [ "$RC6" -ne 0 ]; then
  echo "!! self-test FAIL [case 6]: report modu exit 0 bekleniyordu, $RC6 bulundu" >&2
  FAIL=1
fi
if grep -q '^\[app-runtime-grants\]' <<< "$OUT6"; then
  echo "!! self-test FAIL [case 6: temiz ağaç]: grants-full.sql ile SIFIR bulgu bekleniyordu" >&2
  printf '%s\n' "$OUT6" >&2
  FAIL=1
fi
run "$GRANTS_FULL" block > /dev/null 2>&1; RC6B=$?
if [ "$RC6B" -ne 0 ]; then
  echo "!! self-test FAIL [case 6b]: block modu temiz ağaçta exit 0 bekleniyordu, $RC6B bulundu" >&2
  FAIL=1
fi

# --- case 7: POZİTİF KONTROL — bilinen GRANT'li bir tabloyu listeden çıkar,
#     KIRMIZI vermeli (§2.7 #9: "sinyal sabitse sinyal değildir"). GRANT-full
#     baz alınır (fixture_missing zaten granted), "fixture_granted" satırı
#     silinir.
MUTATED="$TMP/grants-mutated.sql"
grep -v 'fixture_granted' "$GRANTS_FULL" > "$MUTATED"
if grep -q 'fixture_granted' "$MUTATED"; then
  echo "!! self-test SETUP HATASI [case 7]: mutasyon uygulanmadı, 'fixture_granted' hâlâ dosyada" >&2
  FAIL=1
else
  OUT7="$(run "$MUTATED" report "$DB_MOCK_FULL")"
  if ! grep -q '^\[app-runtime-grants\] table:fixture_granted$' <<< "$OUT7"; then
    echo "!! self-test FAIL [case 7: pozitif kontrol]: GRANT satırı silindi ama 'table:fixture_granted' bulgusu YOK" >&2
    printf '%s\n' "$OUT7" >&2
    FAIL=1
  fi
  run "$MUTATED" block "$DB_MOCK_FULL" > /dev/null 2>&1
  if [ $? -ne 1 ]; then
    echo "!! self-test FAIL [case 7b]: mutasyon sonrası block modu exit 1 bekleniyordu" >&2
    FAIL=1
  fi
fi

# --- case 8: kaynak A boş türetilirse SETUP HATASI (exit 2), SESSİZ YEŞİL DEĞİL
EMPTY_SRC="$TMP/empty-src"
mkdir -p "$EMPTY_SRC"
cat > "$EMPTY_SRC/noop.module.ts" << 'EOF'
export class NoopModule {}
EOF
GUARD_ARTG_SRC_DIR="$EMPTY_SRC" GUARD_ARTG_ENTITIES_DIR="$ENTITIES_DIR" \
  GUARD_ARTG_GRANTS_SQL="$GRANTS_COMPLETE" GUARD_MODE=report bash "$GUARD" > /dev/null 2>&1
RC8=$?
if [ "$RC8" -ne 2 ]; then
  echo "!! self-test FAIL [case 8: boş kaynak A]: exit 2 (SETUP HATASI) bekleniyordu, $RC8 bulundu — A \\ ∅ = ∅ sessizce yeşile dönüyor olabilir" >&2
  FAIL=1
fi

# --- case 9: kaynak B boş türetilirse SETUP HATASI (exit 2) -----------------
EMPTY_GRANTS="$TMP/empty-grants.sql"
printf -- '-- hiçbir GRANT içermeyen dosya\n' > "$EMPTY_GRANTS"
GUARD_ARTG_SRC_DIR="$SRC_DIR" GUARD_ARTG_ENTITIES_DIR="$ENTITIES_DIR" \
  GUARD_ARTG_GRANTS_SQL="$EMPTY_GRANTS" GUARD_MODE=report bash "$GUARD" > /dev/null 2>&1
RC9=$?
if [ "$RC9" -ne 2 ]; then
  echo "!! self-test FAIL [case 9: boş kaynak B]: exit 2 (SETUP HATASI) bekleniyordu, $RC9 bulundu" >&2
  FAIL=1
fi

# --- case 10: kanal 2'nin KENDİ "detector alive" pini ------------------------
# case 3a/3b FixtureInjected'i (GRANT'li) MUTE EDEREK dolaylı ölçüyordu — bu,
# doğrudan bir "her zaman bulgu" standing assertion, case 1'in kanal 2 eşdeğeri.
if ! grep -q '^\[app-runtime-grants\] table:fixture_injected_missing$' <<< "$OUT1"; then
  echo "!! self-test FAIL [case 10: kanal 2 detector-alive]: 'table:fixture_injected_missing' bulgusu YOK" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# --- case 11: kanal 3'ün (dataSource.getRepository) "detector alive" pini ---
if ! grep -q '^\[app-runtime-grants\] table:fixture_direct_missing$' <<< "$OUT1"; then
  echo "!! self-test FAIL [case 11: kanal 3 detector-alive]: 'table:fixture_direct_missing' bulgusu YOK — DUR #1 kanalı köreldi mi?" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# --- case 12: kanal 3, GRANT'li uç → bulgu ÜRETMEMELİ (yanlış pozitif kontrolü)
if grep -q 'table:fixture_direct_granted' <<< "$OUT1"; then
  echo "!! self-test FAIL [case 12]: 'fixture_direct_granted' GRANT'li olmasına rağmen bulgu verdi" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# =============================================================================
# KANAL BAĞIMSIZLIĞI — ürün sahibinin ek şartı (T-250, DUR #1 sonrası).
#
# Kaynak A üç kanaldan besleniyor ve BİRLEŞİM (∪) olarak toplanıyor. Bir
# kanalın deseni bozulursa (BSD grep farkı, çok satırlı yazım, bir yeniden
# adlandırma), diğer iki kanal hâlâ eleman üretebilir → A boş ÇIKMAZ →
# A \ B = ∅ → guard YEŞİL verir, ve o kanalın körlüğü GİZLENİR. Bu, case 2/3'ün
# ilk taslağında yakalanan kör self-test'le AYNI sınıf ("bulgu yok" iki farklı
# sebepten gelebiliyordu) — burada "A dolu" üç farklı sebepten gelebilir.
#
# Her kanalın kendi TETİKLEYİCİ deseninde bir mutasyon yapılır (üç ayrı
# mutasyon, SIRAYLA — bir öncekinin geri alındığı doğrulanmadan bir sonrakine
# geçilmez), ve YALNIZ o kanalın "detector alive" pini kaybolmalı — diğer
# ikisi ETKİLENMEMİŞ kalmalı. Bu, kanalların birbirinden BAĞIMSIZ
# ölçüldüğünün kanıtı.
# =============================================================================
SOURCE_AWK="$DIR/app-runtime-grants-source.awk"
SOURCE_AWK_BACKUP="$TMP/app-runtime-grants-source.awk.orig"
cp "$SOURCE_AWK" "$SOURCE_AWK_BACKUP"
SOURCE_AWK_SHA="$(shasum -a 256 "$SOURCE_AWK_BACKUP" | awk '{print $1}')"

restore_source_awk() {
  cp "$SOURCE_AWK_BACKUP" "$SOURCE_AWK"
  printf '%s  %s\n' "$SOURCE_AWK_SHA" "$SOURCE_AWK" | shasum -a 256 -c - > /dev/null 2>&1
}

detector_alive() { # <table>
  local report_out
  report_out="$(run "$GRANTS_COMPLETE" report)"
  grep -q "^\[app-runtime-grants\] table:$1\$" <<< "$report_out"
}

channel_independence_check() { # <case-etiketi> <hedef-kanalın-tablosu>
  local label="$1" target="$2" others rc=0
  others="fixture_missing fixture_injected_missing fixture_direct_missing"

  if detector_alive "$target"; then
    echo "!! self-test FAIL [$label]: mutasyon uygulanmış olmasına rağmen '$target' HÂLÂ bulgu veriyor — mutasyon hedefine düşmedi" >&2
    rc=1
  fi
  for t in $others; do
    [ "$t" = "$target" ] && continue
    if ! detector_alive "$t"; then
      echo "!! self-test FAIL [$label: YAN ETKİ]: hedef kanal DIŞINDA '$t' de bulgu üretmiyor — mutasyon başka bir kanalı da kırdı" >&2
      rc=1
    fi
  done
  if [ "$rc" -eq 0 ]; then
    echo "-- [$label] mutasyon YALNIZ hedef kanalı kırdı, diğer ikisi bağımsız kaldı"
  fi
  return $rc
}

# --- case 13: kanal 1 (forFeature) — köşeli parantez tetikleyicisini boz ----
python3 - "$SOURCE_AWK" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = 'if (c == "[") { ff_depth = 1; ff_buf = "" }'
assert s.count(marker) == 1, f"case13 marker count={s.count(marker)}"
open(p, "w").write(s.replace(marker, 'if (c == "{") { ff_depth = 1; ff_buf = "" }', 1))
PY
echo "-- [case 13 mutasyon] değiştirilen satır:"
grep -n 'ff_depth = 1; ff_buf' "$SOURCE_AWK"
channel_independence_check "case 13: kanal 1 (forFeature) mutasyonu" fixture_missing || FAIL=1
restore_source_awk || { echo "!! self-test SETUP HATASI [case 13 geri alma]: shasum uyuşmuyor" >&2; FAIL=1; }
echo "-- [case 13] geri alındı, satır:"
grep -n 'ff_depth = 1; ff_buf' "$SOURCE_AWK"

# --- case 14: kanal 2 (@InjectRepository) — tetikleyici regex'i boz --------
python3 - "$SOURCE_AWK" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = "} else if (match(line, /InjectRepository[ \\t]*\\(/)) {"
assert s.count(marker) == 1, f"case14 marker count={s.count(marker)}"
open(p, "w").write(s.replace(marker, "} else if (match(line, /InjectRepositoryXX[ \\t]*\\(/)) {", 1))
PY
echo "-- [case 14 mutasyon] değiştirilen satır:"
grep -n 'InjectRepository' "$SOURCE_AWK" | grep 'match(line'
channel_independence_check "case 14: kanal 2 (@InjectRepository) mutasyonu" fixture_injected_missing || FAIL=1
restore_source_awk || { echo "!! self-test SETUP HATASI [case 14 geri alma]: shasum uyuşmuyor" >&2; FAIL=1; }
echo "-- [case 14] geri alındı, satır:"
grep -n 'InjectRepository' "$SOURCE_AWK" | grep 'match(line'

# --- case 15: kanal 3 (dataSource.getRepository) — tetikleyici regex'i boz -
python3 - "$SOURCE_AWK" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = "(^|[^A-Za-z0-9_])dataSource[ \\t]*\\.[ \\t]*getRepository[ \\t]*\\("
assert s.count(marker) == 1, f"case15 marker count={s.count(marker)}"
open(p, "w").write(s.replace(marker, "(^|[^A-Za-z0-9_])dataSourceXX[ \\t]*\\.[ \\t]*getRepository[ \\t]*\\(", 1))
PY
echo "-- [case 15 mutasyon] değiştirilen satır:"
grep -n 'dataSource' "$SOURCE_AWK" | grep 'match(line'
channel_independence_check "case 15: kanal 3 (dataSource.getRepository) mutasyonu" fixture_direct_missing || FAIL=1
restore_source_awk || { echo "!! self-test SETUP HATASI [case 15 geri alma]: shasum uyuşmuyor" >&2; FAIL=1; }
echo "-- [case 15] geri alındı, satır:"
grep -n 'dataSource' "$SOURCE_AWK" | grep 'match(line'

# =============================================================================
# [[T-362]] — KAYNAK C (CANLI DB). Bilinen-yeşil BİLE VAR (case 1-15, kaynak
# C = kaynak B mock'landığı için A\C/B\C/C\B hep boş) — burası bilinen-KIRMIZI
# tarafı (`Z83` doğum şartı). GRANTS_FULL kullanılıyor (A\B = ∅), yani her
# bulgu SADECE kaynak C yönlerinden geliyor — A\B ile karışamaz.
# =============================================================================

# --- case 16: A\C — kaynak C BOŞ (canlıda sıfır ayrıcalık) → A'nın TÜMÜ
#     ":not-live" bulgusu vermeli. TAM OLARAK T-362'nin brief'teki vakası
#     (baseline_volume_import_batch_rows: beyan var, canlı SIFIR). ⚠️ Boş C
#     bir SETUP HATASI DEĞİL (exit 2 değil) — GERÇEK bir bulgu kümesi.
DB_MOCK_EMPTY="$TMP/db-mock-empty.sh"
mk_db_mock "$DB_MOCK_EMPTY"
OUT16="$(run "$GRANTS_FULL" report "$DB_MOCK_EMPTY")"; RC16=$?
if [ "$RC16" -ne 0 ]; then
  echo "!! self-test FAIL [case 16]: report modu exit 0 bekleniyordu (boş C bir bulgu kümesidir, SETUP HATASI değil), $RC16 bulundu" >&2
  printf '%s\n' "$OUT16" >&2
  FAIL=1
fi
for t in fixture_granted fixture_indexed fixture_injected fixture_injected_missing fixture_direct_granted fixture_direct_missing fixture_missing; do
  if ! grep -q "^\[app-runtime-grants\] table:${t}:not-live\$" <<< "$OUT16"; then
    echo "!! self-test FAIL [case 16: A\\C]: 'table:${t}:not-live' bulgusu YOK — kaynak C boşken A'nın TAMAMI bulgu vermeli" >&2
    printf '%s\n' "$OUT16" >&2
    FAIL=1
  fi
done
run "$GRANTS_FULL" block "$DB_MOCK_EMPTY" > /dev/null 2>&1
if [ $? -ne 1 ]; then
  echo "!! self-test FAIL [case 16b]: boş C ile block modu exit 1 bekleniyordu" >&2
  FAIL=1
fi

# --- case 17: B\C — SQL beyan ediyor, kaynak C'de YOK ("betik uygulanmamış").
#     Aynı DB_MOCK_EMPTY çalıştırmasını (case 16 ile PAYLAŞILAN OUT16) kullanır
#     — GRANTS_FULL'ün yedi tablosunun HEPSİ B'de var, C'de YOK.
for t in fixture_granted fixture_indexed fixture_injected fixture_injected_missing fixture_direct_granted fixture_direct_missing fixture_missing; do
  if ! grep -q "^\[app-runtime-grants\] table:${t}:not-applied\$" <<< "$OUT16"; then
    echo "!! self-test FAIL [case 17: B\\C]: 'table:${t}:not-applied' bulgusu YOK" >&2
    printf '%s\n' "$OUT16" >&2
    FAIL=1
  fi
done

# --- case 18: C\B — kaynak C'de bir tablo var ama SQL HİÇ beyan etmiyor
#     ("kayıt-dışı canlı GRANT", Z51 §2 sınıfı). Kaynak C = kaynak B (temiz)
#     + bir "rogue" tablo — A\C ve B\C SIFIR olmalı, yalnız C\B bulgu vermeli.
DB_MOCK_ROGUE="$TMP/db-mock-rogue.sh"
mk_db_mock "$DB_MOCK_ROGUE" fixture_granted fixture_indexed fixture_injected \
  fixture_injected_missing fixture_direct_granted fixture_direct_missing fixture_missing \
  fixture_rogue_grant
OUT18="$(run "$GRANTS_FULL" report "$DB_MOCK_ROGUE")"; RC18=$?
if [ "$RC18" -ne 0 ]; then
  echo "!! self-test FAIL [case 18]: report modu exit 0 bekleniyordu, $RC18 bulundu" >&2
  printf '%s\n' "$OUT18" >&2
  FAIL=1
fi
if ! grep -q '^\[app-runtime-grants\] table:fixture_rogue_grant:undeclared-live$' <<< "$OUT18"; then
  echo "!! self-test FAIL [case 18: C\\B]: 'table:fixture_rogue_grant:undeclared-live' bulgusu YOK" >&2
  printf '%s\n' "$OUT18" >&2
  FAIL=1
fi
if grep -qE ':not-live$|:not-applied$' <<< "$OUT18"; then
  echo "!! self-test FAIL [case 18: yan etki]: C=B+rogue temizken A\\C/B\\C SIFIR bulgu bekleniyordu, ama var" >&2
  printf '%s\n' "$OUT18" >&2
  FAIL=1
fi
run "$GRANTS_FULL" block "$DB_MOCK_ROGUE" > /dev/null 2>&1
if [ $? -ne 1 ]; then
  echo "!! self-test FAIL [case 18b]: rogue C ile block modu exit 1 bekleniyordu" >&2
  FAIL=1
fi

# --- case 19: DB'ye ulaşılamıyor → exit 2 ("ÖLÇEMEDİM"), SESSİZ YEŞİL DEĞİL -
DB_MOCK_UNREACHABLE="$TMP/db-mock-unreachable.sh"
cat > "$DB_MOCK_UNREACHABLE" << 'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$DB_MOCK_UNREACHABLE"
run "$GRANTS_FULL" report "$DB_MOCK_UNREACHABLE" > /tmp/artg-case19-out.$$ 2>&1
RC19=$?
if [ "$RC19" -ne 2 ]; then
  echo "!! self-test FAIL [case 19: DB ulaşılamaz]: exit 2 (ÖLÇEMEDİM) bekleniyordu, $RC19 bulundu" >&2
  cat /tmp/artg-case19-out.$$ >&2
  FAIL=1
fi
rm -f /tmp/artg-case19-out.$$

if [ "$FAIL" -ne 0 ]; then
  {
    echo "!!"
    echo "!! app-runtime-grants self-test'i kendi fixture matrisini geçemedi. Bu,"
    echo "!! üretim grants.sql'inin temiz olduğu anlamına GELMEZ — guard'ın ölçüm"
    echo "!! yaptığı anlamına gelmez. Fixture'lar T-250'nin task raporunda gerekçeli."
  } >&2
  exit 1
fi

echo "app-runtime-grants self-test: case 1-19 tutuyor (kaynak C — A\\C/B\\C/C\\B/ÖLÇEMEDİM dahil, [[T-362]])"
exit 0

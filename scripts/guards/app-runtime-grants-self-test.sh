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

FAIL=0

run() { # <grants-sql> [mode]
  GUARD_ARTG_SRC_DIR="$SRC_DIR" GUARD_ARTG_ENTITIES_DIR="$ENTITIES_DIR" \
    GUARD_ARTG_GRANTS_SQL="$1" GUARD_MODE="${2:-report}" bash "$GUARD"
}

# --- case 1: detector alive — FixtureMissing HER ZAMAN bulgu vermeli --------
OUT1="$(run "$GRANTS_COMPLETE" report)"; RC1=$?
if [ "$RC1" -ne 0 ]; then
  echo "!! self-test FAIL [case 1]: report modu exit 0 bekleniyordu, $RC1 bulundu" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi
if ! printf '%s\n' "$OUT1" | grep -q '^\[app-runtime-grants\] table:fixture_missing$'; then
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
if printf '%s\n' "$OUT1" | grep -q '^\[app-runtime-grants\] table:fixture_indexed$'; then
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
  OUT2B="$(run "$MUTATED_IDX" report)"
  if ! printf '%s\n' "$OUT2B" | grep -q '^\[app-runtime-grants\] table:fixture_indexed$'; then
    echo "!! self-test FAIL [case 2b: T-249 sabit-pencere tuzağı geri geldi]: GRANT satırı silindi ama 'table:fixture_indexed' bulgusu YOK — FixtureIndexed muhtemelen kaynak A'dan SESSİZCE düştü (dekoratör-arası eşleme kırık)" >&2
    printf '%s\n' "$OUT2B" >&2
    FAIL=1
  fi
fi

# --- case 3: kanal 2 (@InjectRepository) tek başına yeterli — İKİ yönlü ----
# Aynı gerekçe case 2b ile: "bulgu yok" tek başına kanal 2'nin çalıştığını
# KANITLAMAZ — kanal tamamen kırılsa (hiç tetiklenmese) da FixtureInjected
# kaynak A'ya hiç girmez ve sonuç yine "bulgu yok" olur, YANLIŞ NEDENLE.
if printf '%s\n' "$OUT1" | grep -q '^\[app-runtime-grants\] table:fixture_injected$'; then
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
  OUT3B="$(run "$MUTATED_INJ" report)"
  if ! printf '%s\n' "$OUT3B" | grep -q '^\[app-runtime-grants\] table:fixture_injected$'; then
    echo "!! self-test FAIL [case 3b: InjectRepository kanalı ölü]: GRANT satırı silindi ama 'table:fixture_injected' bulgusu YOK — kanal 2 muhtemelen hiç tetiklenmiyor" >&2
    printf '%s\n' "$OUT3B" >&2
    FAIL=1
  fi
fi

# --- case 4: yalnız yorumda geçen sınıf (FixtureGhost) kaynak A'ya SIZMAMALI
if printf '%s\n' "$OUT1" | grep -q 'fixture_ghost'; then
  echo "!! self-test FAIL [case 4: yorum sızıntısı]: 'fixture_ghost' hiçbir kanalda enjekte edilmiyor ama bulgu/A'da göründü" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# --- case 5: normal (GRANT'li) fixture bulgu ÜRETMEMELİ ---------------------
if printf '%s\n' "$OUT1" | grep -q '^\[app-runtime-grants\] table:fixture_granted$'; then
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
if printf '%s\n' "$OUT6" | grep -q '^\[app-runtime-grants\]'; then
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
  OUT7="$(run "$MUTATED" report)"
  if ! printf '%s\n' "$OUT7" | grep -q '^\[app-runtime-grants\] table:fixture_granted$'; then
    echo "!! self-test FAIL [case 7: pozitif kontrol]: GRANT satırı silindi ama 'table:fixture_granted' bulgusu YOK" >&2
    printf '%s\n' "$OUT7" >&2
    FAIL=1
  fi
  run "$MUTATED" block > /dev/null 2>&1
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
if ! printf '%s\n' "$OUT1" | grep -q '^\[app-runtime-grants\] table:fixture_injected_missing$'; then
  echo "!! self-test FAIL [case 10: kanal 2 detector-alive]: 'table:fixture_injected_missing' bulgusu YOK" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# --- case 11: kanal 3'ün (dataSource.getRepository) "detector alive" pini ---
if ! printf '%s\n' "$OUT1" | grep -q '^\[app-runtime-grants\] table:fixture_direct_missing$'; then
  echo "!! self-test FAIL [case 11: kanal 3 detector-alive]: 'table:fixture_direct_missing' bulgusu YOK — DUR #1 kanalı köreldi mi?" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# --- case 12: kanal 3, GRANT'li uç → bulgu ÜRETMEMELİ (yanlış pozitif kontrolü)
if printf '%s\n' "$OUT1" | grep -q 'table:fixture_direct_granted'; then
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
  printf '%s\n' "$(run "$GRANTS_COMPLETE" report)" | grep -q "^\[app-runtime-grants\] table:$1\$"
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

if [ "$FAIL" -ne 0 ]; then
  {
    echo "!!"
    echo "!! app-runtime-grants self-test'i kendi fixture matrisini geçemedi. Bu,"
    echo "!! üretim grants.sql'inin temiz olduğu anlamına GELMEZ — guard'ın ölçüm"
    echo "!! yaptığı anlamına gelmez. Fixture'lar T-250'nin task raporunda gerekçeli."
  } >&2
  exit 1
fi

exit 0

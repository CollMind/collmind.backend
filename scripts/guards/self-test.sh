#!/usr/bin/env bash
#
# Guard self-test — guard'lar her koşumda kendi doğruluklarını kanıtlar.
#
# NEDEN VAR: "guard'ı olmayan invariant temenniyse, testi olmayan guard da
# temennidir." Bu guard'lar iki code review turunda üst üste sessiz yanlış
# negatif üretti; her seferinde kusur elle yazılan geçici bir fixture ile
# bulundu, sonra fixture silindi. Yani en değerli çıktı hiçbir yere kaydolmadı.
# `fixtures/` o kaydı kalıcı yapar, bu script de onu her koşumda uygular.
#
# ÖZELLİKLE POZİTİF KONTROL: bir guard'ın awk programı bozulursa (ör. bash tek
# tırnağını kapatan bir Türkçe kesme işareti — 1. turda tam olarak bu oldu)
# guard sessizce 0 bulgu döner ve her şey yeşil görünür. `ledger-ordering-probe`
# bilerek ihlal içerir; bulgu vermiyorsa guard çalışmıyordur.
#
# Fixture'lar `.ts.fixture` uzantısıyla saklanır ve buradan geçici bir dizine
# `.ts` olarak kopyalanır. Gerekçe: `tsconfig.json`'da include/exclude yok, yani
# `scripts/` altındaki bir `.ts` dosyası derlemeye ve lint'e girerdi. Fixture'lar
# bilerek tuhaf kod içerir; build konfigürasyonunu onlara göre esnetmek yanlış olur.
#
# exit 0 = matris tutuyor · exit 1 = guard'lar beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
FIXTURES="$DIR/fixtures"

if [ ! -d "$FIXTURES" ]; then
  echo "!! self-test: fixtures/ dizini yok — guard'lar doğrulanamıyor" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# migration-schema `migrations` adlı bir dizin bekler; diğerleri modül ağacı.
mkdir -p "$TMP/migrations" "$TMP/modules"
for f in "$FIXTURES"/*.ts.fixture; do
  base="$(basename "$f" .ts.fixture)"
  case "$base" in
    ledger-ordering-probe) cp "$f" "$TMP/modules/$base.ts" ;;
    *)                     cp "$f" "$TMP/migrations/$base.ts" ;;
  esac
done

# Beklenen matris: <guard>|<fixture>|<bulgu sayısı>
EXPECTED="
migration-schema|star-line|2
migration-schema|comment-backtick|1
migration-schema|midline-comment|0
migration-schema|schema-safe|1
financial-ordering|ledger-ordering-probe|1
ledger-direction|ledger-ordering-probe|1
"

# Guard'ları fixture ağacına yönlendirerek bir kez koştur, çıktıyı sakla.
cd "$ROOT"
OUT_MIG="$(GUARD_MODE=report GUARD_MIG_DIR="$TMP/migrations" bash "$DIR/migration-schema.sh" 2>&1)"
OUT_FIN="$(GUARD_MODE=report GUARD_MODULES_DIR="$TMP/modules" bash "$DIR/financial-ordering.sh" 2>&1)"
OUT_LED="$(GUARD_MODE=report GUARD_SRC_DIR="$TMP/modules" bash "$DIR/ledger-direction.sh" 2>&1)"

FAIL=0
while IFS='|' read -r guard fixture want; do
  [ -z "${guard:-}" ] && continue
  case "$guard" in
    migration-schema)   out="$OUT_MIG" ;;
    financial-ordering) out="$OUT_FIN" ;;
    ledger-direction)   out="$OUT_LED" ;;
    *) echo "!! self-test: bilinmeyen guard '$guard'" >&2; FAIL=1; continue ;;
  esac

  got="$(printf '%s\n' "$out" | grep -c "^\[$guard\] .*/$fixture\.ts:" || true)"
  if [ "$got" != "$want" ]; then
    echo "!! self-test BAŞARISIZ: $guard × $fixture → beklenen $want, bulunan $got" >&2
    printf '%s\n' "$out" | grep "/$fixture\.ts:" >&2 || echo "   (hiç bulgu yok)" >&2
    FAIL=1
  fi
done <<< "$EXPECTED"

if [ "$FAIL" -ne 0 ]; then
  {
    echo "!!"
    echo "!! Guard'lar kendi fixture matrisini geçemedi. Bu, üretim kodunun temiz"
    echo "!! olduğu anlamına GELMEZ — guard'ların ölçüm yaptığı anlamına gelmez."
    echo "!! Her fixture bir code review turunda bulunmuş gerçek bir kusurun kaydıdır;"
    echo "!! gerekçeleri dosyaların başındadır. Beklentiyi değiştirmeden önce oku."
  } >&2
  exit 1
fi

exit 0

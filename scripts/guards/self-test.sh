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
mkdir -p "$TMP/migrations" "$TMP/modules" "$TMP/domainA" "$TMP/domainB"
for f in "$FIXTURES"/*.ts.fixture; do
  base="$(basename "$f" .ts.fixture)"
  case "$base" in
    ledger-ordering-probe) cp "$f" "$TMP/modules/$base.ts" ;;
    # money-float: Domain A fixtures go inside the declared domain, the
    # Domain B fixture deliberately stays OUTSIDE it (boundary control).
    money-float-domain-b)  cp "$f" "$TMP/domainB/$base.ts" ;;
    money-float-*)         cp "$f" "$TMP/domainA/$base.ts" ;;
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
money-float|money-float-positive|4
money-float|money-float-decorator|0
money-float|money-float-domain-b|0
"

# Guard'ları fixture ağacına yönlendirerek bir kez koştur, çıktıyı sakla.
cd "$ROOT"
OUT_MIG="$(GUARD_MODE=report GUARD_MIG_DIR="$TMP/migrations" bash "$DIR/migration-schema.sh" 2>&1)"
OUT_FIN="$(GUARD_MODE=report GUARD_MODULES_DIR="$TMP/modules" bash "$DIR/financial-ordering.sh" 2>&1)"
OUT_LED="$(GUARD_MODE=report GUARD_SRC_DIR="$TMP/modules" bash "$DIR/ledger-direction.sh" 2>&1)"

# money-float reads its scope from a declared list, not a path regex, so the
# self-test hands it a temporary list pointing at the fixture tree. The
# Domain B fixture is intentionally absent from that list.
echo "$TMP/domainA" > "$TMP/domain-list.txt"
OUT_MF="$(GUARD_MODE=report MONEY_FLOAT_DOMAIN_LIST="$TMP/domain-list.txt" bash "$DIR/money-float.sh" 2>&1)"

# Ratchet control: baseline claims 3 findings for the positive fixture, current
# state has 4. --ratchet must exit non-zero. A ratchet that cannot fail is not
# a ratchet.
printf '%s 3\n' "$TMP/domainA/money-float-positive.ts" > "$TMP/ratchet-baseline.txt"
if GUARD_MODE=report MONEY_FLOAT_DOMAIN_LIST="$TMP/domain-list.txt" \
     MONEY_FLOAT_BASELINE="$TMP/ratchet-baseline.txt" \
     bash "$DIR/money-float.sh" --ratchet >/dev/null 2>&1; then
  echo "!! self-test FAILED: money-float --ratchet accepted an increase (3 -> 4)" >&2
  FAIL_RATCHET=1
else
  FAIL_RATCHET=0
fi

# SKIPPED exit code control (T-212 S-1): SKIPPED must be exit 2, not exit 0 —
# both callers in run-all.sh (the per-guard loop and the dedicated ratchet
# gate) dispatch on this CODE, not on grepping the word "SKIPPED" out of
# stdout. That grep-based version existed once and a one-word mutation
# ("SKIPPED" -> "ATLANDI") silently blinded both callers at once (measured,
# T-212 code-review). This pins the exit code directly so a regression back
# to `exit 0` on either SKIPPED branch turns this self-test red, independent
# of the message text.
GUARD_MODE=report MONEY_FLOAT_DOMAIN_LIST="$TMP/does-not-exist.txt" \
  bash "$DIR/money-float.sh" >/dev/null 2>&1
RC_SKIP_NOFILE=$?
GUARD_MODE=report MONEY_FLOAT_DOMAIN_LIST="$TMP/does-not-exist.txt" \
  bash "$DIR/money-float.sh" --ratchet >/dev/null 2>&1
RC_SKIP_NOFILE_RATCHET=$?
printf '%s\n' "$TMP/no-such-domain-dir" > "$TMP/empty-domain-list.txt"
GUARD_MODE=report MONEY_FLOAT_DOMAIN_LIST="$TMP/empty-domain-list.txt" \
  bash "$DIR/money-float.sh" >/dev/null 2>&1
RC_SKIP_ZEROFILES=$?

FAIL_SKIPPED_CODE=0
for pair in "domain list not found (plain mode)|$RC_SKIP_NOFILE" \
            "domain list not found (--ratchet)|$RC_SKIP_NOFILE_RATCHET" \
            "domain list resolves to zero files|$RC_SKIP_ZEROFILES"; do
  label="${pair%%|*}"; rc="${pair##*|}"
  if [ "$rc" != 2 ]; then
    echo "!! self-test FAILED: money-float SKIPPED ($label) → exit 2 bekleniyordu, $rc bulundu" >&2
    FAIL_SKIPPED_CODE=1
  fi
done

# ---------------------------------------------------------------- mode-split
# E1 guard'ı bir RATCHET'tir: "0 bulgu" hem "temiz" hem "kör" anlamına gelebilir.
# Bu yüzden her durum ayrı ayrı sınanır — ve ikisi POZİTİF KONTROL değil,
# NEGATİF kontroldür (küçülme ve F büyümesi artık kırmızı vermemeli — T-212).
SP="$TMP/split"
mkdir -p "$SP/inner" "$TMP/refs"
printf 'satir1\nsatir2\n' > "$SP/inner/existing.ts"
printf "import { X } from '../split/inner/existing';\n" > "$TMP/refs/referrer.ts"

ms() { GUARD_MODE=report GUARD_SPLIT_DIR="$SP" GUARD_SPLIT_REF_ROOTS="$TMP/refs" \
         MODE_SPLIT_BASELINE="$TMP/ms-baseline.txt" bash "$DIR/mode-split.sh" 2>&1; }
ms_count() { ms | grep -c '^\[mode-split\]' || true; }

GUARD_SPLIT_DIR="$SP" GUARD_SPLIT_REF_ROOTS="$TMP/refs" \
  bash "$DIR/mode-split.sh" --baseline > "$TMP/ms-baseline.txt"

FAIL_MS=0
ms_expect() { # <beklenen> <etiket> [desen]
  local want="$1" label="$2" pat="${3:-}" got
  got="$(ms_count)"
  if [ "$got" != "$want" ]; then
    echo "!! self-test BAŞARISIZ: mode-split × $label → beklenen $want, bulunan $got" >&2
    ms >&2; FAIL_MS=1; return
  fi
  if [ -n "$pat" ]; then
    local ms_out
    ms_out="$(ms)"
    if ! grep -q "$pat" <<< "$ms_out"; then
      echo "!! self-test BAŞARISIZ: mode-split × $label → bulgu var ama '$pat' değil" >&2
      ms >&2; FAIL_MS=1
    fi
  fi
}

ms_expect 0 "dokunulmamış ağaç"

echo 'yeni' > "$SP/inner/yeni.ts";               ms_expect 1 "yeni dosya" "YENİ DOSYA"
rm "$SP/inner/yeni.ts"

# T-212: mevcut bir F (bölme içi) dosyanın satır sayısı BÜYÜMESİ artık bulgu
# DEĞİL — üç ampirik vaka (B dalgası × 2, T-218) guard'ın bunu yanlış
# ölçtüğünü gösterdi. Bu artık NEGATİF kontrol: büyüme sessiz geçmeli.
printf 'satir1\nsatir2\nsatir3\n' > "$SP/inner/existing.ts"
ms_expect 0 "F büyümesi (artık sessiz geçmeli — T-212)"
printf 'satir1\nsatir2\n' > "$SP/inner/existing.ts"

printf "import { Y } from '../split/inner/existing';\n" > "$TMP/refs/yeni-ref.ts"
ms_expect 1 "yeni referans" "YENİ REFERANS"
rm "$TMP/refs/yeni-ref.ts"

# R (bölme dışından referans) T-212'nin KAPSAMI DIŞINDA — sayı olarak
# karşılaştırılmaya devam eder. Var olan referrer.ts'e YENİ bir referans
# satırı eklemek (yeni dosya değil, var olan dosyada artış) hâlâ kırmızı
# vermeli; bu ikisinin farklı davrandığını POZİTİF kontrol eder.
printf "import { X } from '../split/inner/existing';\nimport { Z } from '../split/inner/existing';\n" \
  > "$TMP/refs/referrer.ts"
ms_expect 1 "referans artışı (hâlâ kırmızı — R, F'den farklı)" "REFERANS ARTTI"
printf "import { X } from '../split/inner/existing';\n" > "$TMP/refs/referrer.ts"

# Negatif kontrol: ratchet AŞAĞI dönerken susmalı. Bir ratchet'in her değişikliğe
# kırmızı vermesi, hiç vermemesi kadar işe yaramazdır.
printf 'satir1\n' > "$SP/inner/existing.ts";     ms_expect 0 "küçülme (sessiz geçmeli)"
rm "$SP/inner/existing.ts";                      ms_expect 0 "silme (sessiz geçmeli)"

FAIL=0
while IFS='|' read -r guard fixture want; do
  [ -z "${guard:-}" ] && continue
  case "$guard" in
    migration-schema)   out="$OUT_MIG" ;;
    financial-ordering) out="$OUT_FIN" ;;
    ledger-direction)   out="$OUT_LED" ;;
    money-float)        out="$OUT_MF" ;;
    *) echo "!! self-test: bilinmeyen guard '$guard'" >&2; FAIL=1; continue ;;
  esac

  got="$(printf '%s\n' "$out" | grep -c "^\[$guard\] .*/$fixture\.ts:" || true)"
  if [ "$got" != "$want" ]; then
    echo "!! self-test BAŞARISIZ: $guard × $fixture → beklenen $want, bulunan $got" >&2
    printf '%s\n' "$out" | grep "/$fixture\.ts:" >&2 || echo "   (hiç bulgu yok)" >&2
    FAIL=1
  fi
done <<< "$EXPECTED"

if [ "${FAIL_RATCHET:-0}" -ne 0 ]; then
  FAIL=1
fi

if [ "${FAIL_SKIPPED_CODE:-0}" -ne 0 ]; then
  FAIL=1
fi

if [ "${FAIL_MS:-0}" -ne 0 ]; then
  FAIL=1
fi

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

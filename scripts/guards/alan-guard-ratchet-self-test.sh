#!/usr/bin/env bash
#
# self-test — alan-guard-ratchet (`B4` `A′` keskinleştirme-2, `Z44`)
#
# `roles-ratchet-self-test.sh` ile AYNI desen: gerçek guard'ı FİXTURE
# ağacına ENV override'larıyla (`ALAN_GUARD_RATCHET_SRC_DIR` /
# `ALAN_GUARD_RATCHET_BASELINE`) yönlendirerek çağırır, mantığın hiçbir
# parçasını YENİDEN UYGULAMAZ (`§2.7 #8`). `route-scope`'un kendi
# fixture'ı (`fixtures/route-scope/`) yeniden kullanılır.
#
# CASE A — büyüme YOK: exit 0, bulgu yok.
# CASE B — MUTASYON: baseline'dan `fixture-plain/route-guard` (rota
#          seviyesi ALAN_GUARD) anahtarı SİLİNİR → guard'ın onu YENİ
#          olarak YAKALADIĞINI (exit 1, adıyla) doğrula. Silinen satır
#          BASILIR.
# CASE C — baseline YOK → SKIPPED, exit 0.
# CASE D — bozuk baseline biçimi → exit 2 (SETUP HATASI).
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/alan-guard-ratchet.sh"
ROUTE_SCOPE_GUARD="$DIR/route-scope.sh"
FIXDIR="$DIR/fixtures/route-scope"

if [ ! -f "$GUARD" ] || [ ! -f "$ROUTE_SCOPE_GUARD" ]; then
  echo "!! self-test: alan-guard-ratchet.sh/route-scope.sh yok" >&2
  exit 1
fi
if [ ! -d "$FIXDIR" ]; then
  echo "!! self-test: fixtures/route-scope/ eksik — guard doğrulanamıyor" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SRC_DIR="$TMP/src"
mkdir -p "$SRC_DIR"
for f in "$FIXDIR"/*.controller.ts.fixture; do
  cp "$f" "$SRC_DIR/$(basename "$f" .fixture)"
done

export ROUTE_SCOPE_DOMAIN_GUARDS="FixtureDomainGuard"
export ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1

FAIL=0

BASELINE_GOOD="$TMP/alan-guard-baseline-good.txt"
if ! ALAN_GUARD_RATCHET_SRC_DIR="$SRC_DIR" bash "$GUARD" --baseline > "$BASELINE_GOOD" 2>"$TMP/baseline.err"; then
  echo "!! self-test SETUP: --baseline üretimi başarısız" >&2
  cat "$TMP/baseline.err" >&2
  exit 1
fi

if ! grep -Eq 'fixture-plain/route-guard[[:space:]]' "$BASELINE_GOOD"; then
  echo "!! self-test SETUP: baseline'da beklenen 'route-guard' anahtarı YOK — fixture/guard uyuşmuyor" >&2
  cat "$BASELINE_GOOD" >&2
  exit 1
fi
if ! grep -Eq 'fixture-domain/inherited[[:space:]]' "$BASELINE_GOOD"; then
  echo "!! self-test SETUP: baseline'da beklenen 'inherited' anahtarı YOK — fixture/guard uyuşmuyor" >&2
  cat "$BASELINE_GOOD" >&2
  exit 1
fi

# =============================================================================
# CASE A — büyüme YOK (baseline == bugünkü envanter)
# =============================================================================
OUT_A="$(ALAN_GUARD_RATCHET_SRC_DIR="$SRC_DIR" ALAN_GUARD_RATCHET_BASELINE="$BASELINE_GOOD" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
if [ "$RC_A" -ne 0 ]; then
  echo "!! self-test FAIL [case A]: büyüme yokken exit 0 bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi
if printf '%s\n' "$OUT_A" | grep -q "^\[alan-guard-ratchet\]"; then
  echo "!! self-test FAIL [case A]: büyüme yokken bir bulgu basıldı" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — MUTASYON: baseline'dan 'route-guard' anahtarını SİL → guard'ın
# onu "YENİ ALAN_GUARD rotası" olarak YAKALAMASI beklenir (exit 1).
# =============================================================================
BASELINE_MUTATED="$TMP/alan-guard-baseline-mutated.txt"
grep -Ev 'fixture-plain/route-guard[[:space:]]' "$BASELINE_GOOD" > "$BASELINE_MUTATED"

DELETED_LINE="$(grep -E 'fixture-plain/route-guard[[:space:]]' "$BASELINE_GOOD")"
echo "-- [self-test case B] mutasyon: baseline'dan SİLİNEN satır:"
echo "   ${DELETED_LINE}"
if [ -z "$DELETED_LINE" ]; then
  echo "!! self-test FAIL [case B]: silinecek satır bulunamadı — mutasyon hedefi YANLIŞ" >&2
  FAIL=1
fi

OUT_B="$(ALAN_GUARD_RATCHET_SRC_DIR="$SRC_DIR" ALAN_GUARD_RATCHET_BASELINE="$BASELINE_MUTATED" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 1 ]; then
  echo "!! self-test FAIL [case B]: büyüme VARKEN exit 1 bekleniyordu, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi
if ! printf '%s\n' "$OUT_B" | grep -q "fixture-plain/route-guard"; then
  echo "!! self-test FAIL [case B]: bulgu 'route-guard' anahtarını İSİMLE göstermiyor" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

OUT_B_REPORT="$(ALAN_GUARD_RATCHET_SRC_DIR="$SRC_DIR" ALAN_GUARD_RATCHET_BASELINE="$BASELINE_MUTATED" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC_B_REPORT=$?
if [ "$RC_B_REPORT" -ne 0 ]; then
  echo "!! self-test FAIL [case B report]: report modunda exit 0 bekleniyordu, $RC_B_REPORT bulundu" >&2
  FAIL=1
fi
if ! printf '%s\n' "$OUT_B_REPORT" | grep -q "^\[alan-guard-ratchet\]"; then
  echo "!! self-test FAIL [case B report]: report modunda bulgu BASILMADI" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — baseline YOK → SKIPPED, exit 0
# =============================================================================
OUT_C="$(ALAN_GUARD_RATCHET_SRC_DIR="$SRC_DIR" ALAN_GUARD_RATCHET_BASELINE="$TMP/no-such-baseline.txt" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 0 ]; then
  echo "!! self-test FAIL [case C]: baseline yokken exit 0 (SKIPPED) bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi
if ! printf '%s\n' "$OUT_C" | grep -q "SKIPPED"; then
  echo "!! self-test FAIL [case C]: SKIPPED mesajı basılmadı" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — bozuk baseline (başlıksız) → exit 2 (SETUP HATASI)
# =============================================================================
BASELINE_BROKEN="$TMP/alan-guard-baseline-broken.txt"
printf 'garbage without header\n' > "$BASELINE_BROKEN"
OUT_D="$(ALAN_GUARD_RATCHET_SRC_DIR="$SRC_DIR" ALAN_GUARD_RATCHET_BASELINE="$BASELINE_BROKEN" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_D=$?
if [ "$RC_D" -ne 2 ]; then
  echo "!! self-test FAIL [case D]: bozuk baseline'da exit 2 bekleniyordu, $RC_D bulundu" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "!! alan-guard-ratchet self-test: BİR YA DA DAHA FAZLA VAKA BAŞARISIZ" >&2
  exit 1
fi

echo "-- alan-guard-ratchet self-test: tüm vakalar (A/B/C/D) tutuyor"
exit 0

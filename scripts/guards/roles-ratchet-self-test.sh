#!/usr/bin/env bash
#
# self-test — roles-ratchet (`B4` `A′`, `Z44 §2/§4`)
#
# Gerçek guard'ı (`roles-ratchet.sh`) FİXTURE ağacına ENV override'larıyla
# (`ROLES_RATCHET_SRC_DIR` / `ROLES_RATCHET_BASELINE`) yönlendirerek çağırır
# — mantığın hiçbir parçasını YENİDEN UYGULAMAZ (`§2.7 #8`). Kaynak
# `route-scope.sh --list-roles` olduğu için fixture ağacı da AYNEN
# `route-scope`'un kendi fixture'ını (`fixtures/route-scope/`) kullanır —
# İKİNCİ bir fixture seti YAZILMADI (İlke: mevcut mekanizmayı yeniden kullan).
#
# CASE A — büyüme YOK: fixture'ın ürettiği ROLES anahtarları baseline'la
#          BİREBİR aynıysa → exit 0, bulgu yok.
# CASE B — MUTASYON: baseline'dan `roled` anahtarını SİL (bir @Roles rotası
#          "yeni" görünsün) → guard'ın onu YAKALADIĞINI (exit 1, RAW'da
#          anahtar adıyla) doğrula. Silinen satır `sed -n` ile BASILIR
#          (CLAUDE.md: "değiştirilen satır basılır").
# CASE C — baseline YOK: SKIPPED, exit 0 (mode-split/route-scope ile AYNI
#          sözleşme — ilk --baseline koşumundan ÖNCEki meşru geçiş).
# CASE D — bozuk baseline biçimi (başlıksız) → exit 2 (SETUP HATASI).
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/roles-ratchet.sh"
ROUTE_SCOPE_GUARD="$DIR/route-scope.sh"
FIXDIR="$DIR/fixtures/route-scope"

if [ ! -f "$GUARD" ] || [ ! -f "$ROUTE_SCOPE_GUARD" ]; then
  echo "!! self-test: roles-ratchet.sh/route-scope.sh yok" >&2
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

# fixture-plain'in 'roled'/'roled-multiline' rotaları KASITLI olarak
# RolesGuard'sız (route-scope'un kendi CASE grubunun aynı sebebi) — bu
# kontrolü değil, ROLES sınıflandırmasını sınıyoruz.
export ROUTE_SCOPE_DOMAIN_GUARDS="FixtureDomainGuard"
export ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1

FAIL=0

# --- baseline üret (guard'ın KENDİ --baseline yolu ile, ikinci üretici YOK) -
BASELINE_GOOD="$TMP/roles-baseline-good.txt"
if ! ROLES_RATCHET_SRC_DIR="$SRC_DIR" bash "$GUARD" --baseline > "$BASELINE_GOOD" 2>"$TMP/baseline.err"; then
  echo "!! self-test SETUP: --baseline üretimi başarısız" >&2
  cat "$TMP/baseline.err" >&2
  exit 1
fi

if ! grep -Eq 'fixture-plain/roled[[:space:]]' "$BASELINE_GOOD"; then
  echo "!! self-test SETUP: baseline'da beklenen 'roled' anahtarı YOK — fixture/guard uyuşmuyor" >&2
  cat "$BASELINE_GOOD" >&2
  exit 1
fi

# =============================================================================
# CASE A — büyüme YOK (baseline == bugünkü envanter)
# =============================================================================
OUT_A="$(ROLES_RATCHET_SRC_DIR="$SRC_DIR" ROLES_RATCHET_BASELINE="$BASELINE_GOOD" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
if [ "$RC_A" -ne 0 ]; then
  echo "!! self-test FAIL [case A]: büyüme yokken exit 0 bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi
if grep -q "^\[roles-ratchet\]" <<< "$OUT_A"; then
  echo "!! self-test FAIL [case A]: büyüme yokken bir bulgu basıldı" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — MUTASYON: baseline'dan 'roled' anahtarını SİL → guard'ın onu
# "YENİ @Roles rotası" olarak YAKALAMASI beklenir (exit 1).
# =============================================================================
BASELINE_MUTATED="$TMP/roles-baseline-mutated.txt"
grep -Ev 'fixture-plain/roled[[:space:]]' "$BASELINE_GOOD" > "$BASELINE_MUTATED"

# ⛔ Mutasyonun MEKANİZMAYA uygulandığını doğrula — değiştirilen (silinen)
# satır BASILIR (CLAUDE.md: "mutasyon uygulandıktan sonra DEĞİŞTİRİLEN SATIR
# BASILIR"). Silinen satır tam olarak 'roled' anahtarını taşıyan veri
# satırıydı, bir yorum DEĞİL (grep -v yalnız 'R ' ile başlayan veri
# satırlarını hedefler, '#' başlıklarına dokunmaz).
DELETED_LINE="$(grep -E 'fixture-plain/roled[[:space:]]' "$BASELINE_GOOD")"
echo "-- [self-test case B] mutasyon: baseline'dan SİLİNEN satır:"
echo "   ${DELETED_LINE}"
if [ -z "$DELETED_LINE" ]; then
  echo "!! self-test FAIL [case B]: silinecek satır bulunamadı — mutasyon hedefi YANLIŞ" >&2
  FAIL=1
fi

OUT_B="$(ROLES_RATCHET_SRC_DIR="$SRC_DIR" ROLES_RATCHET_BASELINE="$BASELINE_MUTATED" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 1 ]; then
  echo "!! self-test FAIL [case B]: büyüme VARKEN exit 1 bekleniyordu, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi
if ! grep -q "fixture-plain/roled" <<< "$OUT_B"; then
  echo "!! self-test FAIL [case B]: bulgu 'roled' anahtarını İSİMLE göstermiyor" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

# report modunda da RAW basılmalı ama exit 0 (runner'ın kararı) —
# route-scope/scope-ratchet ile AYNI sözleşme.
OUT_B_REPORT="$(ROLES_RATCHET_SRC_DIR="$SRC_DIR" ROLES_RATCHET_BASELINE="$BASELINE_MUTATED" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC_B_REPORT=$?
if [ "$RC_B_REPORT" -ne 0 ]; then
  echo "!! self-test FAIL [case B report]: report modunda exit 0 bekleniyordu, $RC_B_REPORT bulundu" >&2
  FAIL=1
fi
if ! grep -q "^\[roles-ratchet\]" <<< "$OUT_B_REPORT"; then
  echo "!! self-test FAIL [case B report]: report modunda bulgu BASILMADI" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — baseline YOK → SKIPPED, exit 0
# =============================================================================
OUT_C="$(ROLES_RATCHET_SRC_DIR="$SRC_DIR" ROLES_RATCHET_BASELINE="$TMP/no-such-baseline.txt" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 0 ]; then
  echo "!! self-test FAIL [case C]: baseline yokken exit 0 (SKIPPED) bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi
if ! grep -q "SKIPPED" <<< "$OUT_C"; then
  echo "!! self-test FAIL [case C]: SKIPPED mesajı basılmadı" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — bozuk baseline (başlıksız) → exit 2 (SETUP HATASI)
# =============================================================================
BASELINE_BROKEN="$TMP/roles-baseline-broken.txt"
printf 'garbage without header\n' > "$BASELINE_BROKEN"
OUT_D="$(ROLES_RATCHET_SRC_DIR="$SRC_DIR" ROLES_RATCHET_BASELINE="$BASELINE_BROKEN" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_D=$?
if [ "$RC_D" -ne 2 ]; then
  echo "!! self-test FAIL [case D]: bozuk baseline'da exit 2 bekleniyordu, $RC_D bulundu" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "!! roles-ratchet self-test: BİR YA DA DAHA FAZLA VAKA BAŞARISIZ" >&2
  exit 1
fi

echo "-- roles-ratchet self-test: tüm vakalar (A/B/C/D) tutuyor"
exit 0

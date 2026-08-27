#!/usr/bin/env bash
#
# self-test — domain-guard-parity (`B4` `A′` keskinleştirme-1, `Z44`)
#
# Gerçek guard'ı (`domain-guard-parity.sh`) GEÇİCİ KOPYALARA (KAYNAK A/B'nin
# birer geçici dosya klonuna) ENV override'larıyla
# (`DOMAIN_GUARD_PARITY_ROUTE_SCOPE_SH` / `DOMAIN_GUARD_PARITY_CAPABILITY_
# GUARD_TS`) yönlendirerek çağırır — mantığın hiçbir parçasını YENİDEN
# UYGULAMAZ (`§2.7 #8`).
#
# CASE A — kümeler EŞİT (gerçek repo hâli kopyalanır) → exit 0, bulgu yok.
# CASE B — MUTASYON 1: KAYNAK A'ya (route-scope kopyası) yalnız KAYNAK
#          A'da olan bir isim eklenir (`FooGuard`) → exit 1,
#          `KAYNAK-A-ONLY:FooGuard` adıyla.
# CASE C — MUTASYON 2: KAYNAK B'ye (capability.guard kopyası) yalnız KAYNAK
#          B'de olan bir isim eklenir (`FakeDomainGuard`) → exit 1,
#          `KAYNAK-B-ONLY:FakeDomainGuard` adıyla.
# CASE D — bozuk KAYNAK A (satır yok) → exit 2 (SETUP HATASI).
# CASE E — bozuk KAYNAK B (dizi yok) → exit 2 (SETUP HATASI).
#
# Her mutasyon SONRASI değiştirilen satır BASILIR (CLAUDE.md: "mutasyon
# uygulandıktan sonra DEĞİŞTİRİLEN SATIR BASILIR").
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/domain-guard-parity.sh"
REAL_ROUTE_SCOPE="$DIR/route-scope.sh"
REAL_CAPABILITY_GUARD="$DIR/../../src/common/guards/capability.guard.ts"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: domain-guard-parity.sh yok" >&2
  exit 1
fi
if [ ! -f "$REAL_ROUTE_SCOPE" ] || [ ! -f "$REAL_CAPABILITY_GUARD" ]; then
  echo "!! self-test: kaynak dosyalar eksik — guard doğrulanamıyor" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAIL=0

# =============================================================================
# CASE A — gerçek repo hâlinin BİREBİR kopyası (kümeler eşit olmalı)
# =============================================================================
A_GOOD="$TMP/route-scope-good.sh"
B_GOOD="$TMP/capability-guard-good.ts"
cp "$REAL_ROUTE_SCOPE" "$A_GOOD"
cp "$REAL_CAPABILITY_GUARD" "$B_GOOD"

OUT_A="$(DOMAIN_GUARD_PARITY_ROUTE_SCOPE_SH="$A_GOOD" DOMAIN_GUARD_PARITY_CAPABILITY_GUARD_TS="$B_GOOD" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
if [ "$RC_A" -ne 0 ]; then
  echo "!! self-test FAIL [case A]: eşit kümelerde exit 0 bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi
if printf '%s\n' "$OUT_A" | grep -q "^\[domain-guard-parity\]"; then
  echo "!! self-test FAIL [case A]: eşit kümelerde bir bulgu basıldı" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — MUTASYON: KAYNAK A'ya yalnız-A ismi ekle (FooGuard)
# =============================================================================
A_MUT="$TMP/route-scope-mutA.sh"
cp "$REAL_ROUTE_SCOPE" "$A_MUT"
# macOS/BSD sed -i '' — repo genelinde kullanılan biçim.
sed -i '' "s/ReversalGuard SettlementGuard/ReversalGuard SettlementGuard FooGuard/" "$A_MUT"
MUT_B_LINE="$(grep -n 'KNOWN_DOMAIN_GUARDS=' "$A_MUT")"
echo "-- [self-test case B] mutasyon: KAYNAK A'nın DEĞİŞTİRİLEN satırı:"
echo "   ${MUT_B_LINE}"
if ! printf '%s' "$MUT_B_LINE" | grep -q "FooGuard"; then
  echo "!! self-test FAIL [case B]: mutasyon hedefi YANLIŞ — 'FooGuard' satırda YOK" >&2
  FAIL=1
fi

OUT_B="$(DOMAIN_GUARD_PARITY_ROUTE_SCOPE_SH="$A_MUT" DOMAIN_GUARD_PARITY_CAPABILITY_GUARD_TS="$B_GOOD" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 1 ]; then
  echo "!! self-test FAIL [case B]: fark VARKEN exit 1 bekleniyordu, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi
if ! printf '%s\n' "$OUT_B" | grep -q "KAYNAK-A-ONLY:FooGuard"; then
  echo "!! self-test FAIL [case B]: bulgu 'FooGuard'ı KAYNAK-A-ONLY olarak İSİMLE göstermiyor" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — MUTASYON: KAYNAK B'ye yalnız-B ismi ekle (FakeDomainGuard)
# =============================================================================
B_MUT="$TMP/capability-guard-mutB.ts"
cp "$REAL_CAPABILITY_GUARD" "$B_MUT"
python3 - "$B_MUT" << 'PYEOF'
import sys
p = sys.argv[1]
with open(p) as f:
    c = f.read()
target = "  'SettlementGuard',\n];"
assert target in c, "mutasyon hedefi bulunamadı — capability.guard.ts biçimi DEĞİŞMİŞ"
c = c.replace(target, "  'SettlementGuard',\n  'FakeDomainGuard',\n];")
with open(p, "w") as f:
    f.write(c)
PYEOF
MUT_C_LINE="$(grep -n "FakeDomainGuard" "$B_MUT")"
echo "-- [self-test case C] mutasyon: KAYNAK B'nin EKLENEN satırı:"
echo "   ${MUT_C_LINE}"
if [ -z "$MUT_C_LINE" ]; then
  echo "!! self-test FAIL [case C]: mutasyon hedefi YANLIŞ — 'FakeDomainGuard' satırda YOK" >&2
  FAIL=1
fi

OUT_C="$(DOMAIN_GUARD_PARITY_ROUTE_SCOPE_SH="$A_GOOD" DOMAIN_GUARD_PARITY_CAPABILITY_GUARD_TS="$B_MUT" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 1 ]; then
  echo "!! self-test FAIL [case C]: fark VARKEN exit 1 bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi
if ! printf '%s\n' "$OUT_C" | grep -q "KAYNAK-B-ONLY:FakeDomainGuard"; then
  echo "!! self-test FAIL [case C]: bulgu 'FakeDomainGuard'ı KAYNAK-B-ONLY olarak İSİMLE göstermiyor" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi

# report modunda da RAW basılmalı ama exit 0 (runner'ın kararı).
OUT_C_REPORT="$(DOMAIN_GUARD_PARITY_ROUTE_SCOPE_SH="$A_GOOD" DOMAIN_GUARD_PARITY_CAPABILITY_GUARD_TS="$B_MUT" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC_C_REPORT=$?
if [ "$RC_C_REPORT" -ne 0 ]; then
  echo "!! self-test FAIL [case C report]: report modunda exit 0 bekleniyordu, $RC_C_REPORT bulundu" >&2
  FAIL=1
fi
if ! printf '%s\n' "$OUT_C_REPORT" | grep -q "^\[domain-guard-parity\]"; then
  echo "!! self-test FAIL [case C report]: report modunda bulgu BASILMADI" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — bozuk KAYNAK A (KNOWN_DOMAIN_GUARDS satırı yok) → exit 2
# =============================================================================
A_BROKEN="$TMP/route-scope-broken.sh"
grep -v 'KNOWN_DOMAIN_GUARDS=' "$REAL_ROUTE_SCOPE" > "$A_BROKEN"
OUT_D="$(DOMAIN_GUARD_PARITY_ROUTE_SCOPE_SH="$A_BROKEN" DOMAIN_GUARD_PARITY_CAPABILITY_GUARD_TS="$B_GOOD" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_D=$?
if [ "$RC_D" -ne 2 ]; then
  echo "!! self-test FAIL [case D]: bozuk KAYNAK A'da exit 2 bekleniyordu, $RC_D bulundu" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi

# =============================================================================
# CASE E — bozuk KAYNAK B (KNOWN_DOMAIN_GUARD_NAMES dizisi yok) → exit 2
# =============================================================================
B_BROKEN="$TMP/capability-guard-broken.ts"
grep -v 'KNOWN_DOMAIN_GUARD_NAMES' "$REAL_CAPABILITY_GUARD" > "$B_BROKEN"
OUT_E="$(DOMAIN_GUARD_PARITY_ROUTE_SCOPE_SH="$A_GOOD" DOMAIN_GUARD_PARITY_CAPABILITY_GUARD_TS="$B_BROKEN" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_E=$?
if [ "$RC_E" -ne 2 ]; then
  echo "!! self-test FAIL [case E]: bozuk KAYNAK B'de exit 2 bekleniyordu, $RC_E bulundu" >&2
  printf '%s\n' "$OUT_E" >&2
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "!! domain-guard-parity self-test: BİR YA DA DAHA FAZLA VAKA BAŞARISIZ" >&2
  exit 1
fi

echo "-- domain-guard-parity self-test: tüm vakalar (A/B/C/D/E) tutuyor"
exit 0

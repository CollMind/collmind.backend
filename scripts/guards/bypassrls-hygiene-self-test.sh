#!/usr/bin/env bash
#
# self-test — bypassrls-hygiene (EK 1/a, Z53 §4a)
#
# Gerçek guard'ı `BYPASSRLS_GUARD_DB_QUERY` env override'ıyla ÇAĞIRIR — rol
# karşılaştırma mantığının hiçbir parçasını YENİDEN UYGULAMAZ (§2.7 #8).
#
# CASE A — boş envanter (hiçbir rolde bayrak yok)         → exit 0
# CASE B — yalnız kayıtlı roller (postgres, app_operator) → exit 0
# CASE C — app_runtime'da BYPASSRLS (pozitif kontrol)      → exit 1
# CASE D — kayıtsız yeni bir rolde SUPERUSER (poz. kontrol)→ exit 1
# CASE E — DB'ye ulaşılamıyor (mock exit 1)                → exit 2
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/bypassrls-hygiene.sh"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: bypassrls-hygiene.sh yok" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

mk_mock() {
  cat > "$1" << EOF
#!/usr/bin/env bash
printf '%s' "$2"
exit $3
EOF
  chmod +x "$1"
}

# =============================================================================
# CASE A — boş envanter
# =============================================================================
MOCK_A="$TMP/mock-a.sh"
mk_mock "$MOCK_A" "" 0
OUT_A="$(BYPASSRLS_GUARD_DB_QUERY="$MOCK_A" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
if [ "$RC_A" -ne 0 ]; then
  echo "!! self-test FAIL [case A]: boş envanterde exit 0 bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — yalnız kayıtlı roller (bugünkü canlı durumun aynısı)
# =============================================================================
MOCK_B="$TMP/mock-b.sh"
mk_mock "$MOCK_B" "$(printf 'app_operator|t|f\npostgres|t|t')" 0
OUT_B="$(BYPASSRLS_GUARD_DB_QUERY="$MOCK_B" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 0 ]; then
  echo "!! self-test FAIL [case B]: yalnız kayıtlı rollerde exit 0 bekleniyordu, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — app_runtime'da BYPASSRLS (pozitif kontrol — en tehlikeli vaka)
# =============================================================================
MOCK_C="$TMP/mock-c.sh"
mk_mock "$MOCK_C" "$(printf 'app_operator|t|f\napp_runtime|t|f\npostgres|t|t')" 0
OUT_C="$(BYPASSRLS_GUARD_DB_QUERY="$MOCK_C" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 1 ]; then
  echo "!! self-test FAIL [case C]: app_runtime BYPASSRLS taşırken exit 1 bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi
if ! grep -q '\[bypassrls-hygiene\] role:app_runtime:BYPASSRLS' <<< "$OUT_C"; then
  echo "!! self-test FAIL [case C]: bulgu satırı 'role:app_runtime:BYPASSRLS' ile görünmedi" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — kayıtsız yeni bir rolde SUPERUSER (pozitif kontrol)
# =============================================================================
MOCK_D="$TMP/mock-d.sh"
mk_mock "$MOCK_D" "$(printf 'postgres|t|t\nrenegade_admin|t|t')" 0
OUT_D="$(BYPASSRLS_GUARD_DB_QUERY="$MOCK_D" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_D=$?
if [ "$RC_D" -ne 1 ]; then
  echo "!! self-test FAIL [case D]: kayıtsız SUPERUSER'da exit 1 bekleniyordu, $RC_D bulundu" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi
if ! grep -q '\[bypassrls-hygiene\] role:renegade_admin:SUPERUSER' <<< "$OUT_D"; then
  echo "!! self-test FAIL [case D]: bulgu satırı 'role:renegade_admin:SUPERUSER' ile görünmedi" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi

# =============================================================================
# CASE E — DB'ye ulaşılamıyor → exit 2
# =============================================================================
MOCK_E="$TMP/mock-e.sh"
mk_mock "$MOCK_E" "" 1
OUT_E="$(BYPASSRLS_GUARD_DB_QUERY="$MOCK_E" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_E=$?
if [ "$RC_E" -ne 2 ]; then
  echo "!! self-test FAIL [case E]: DB ulaşılamazken exit 2 bekleniyordu, $RC_E bulundu" >&2
  printf '%s\n' "$OUT_E" >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "bypassrls-hygiene self-test: 5/5 case tutuyor (A boş, B kayıtlı-temiz, C app_runtime-ihlal, D kayıtsız-SUPERUSER, E DB-ulaşılamaz→exit2)"
  exit 0
fi
exit 1

#!/usr/bin/env bash
#
# self-test — app-operator-grants (T-314/A)
#
# Gerçek guard'ı `APP_OP_GRANTS_DB_QUERY` (canlı ayrıcalıklar) ve
# `APP_OP_GRANTS_SQL` (deklare edilen dosya) env override'larıyla ÇAĞIRIR —
# guard'ın parse/karşılaştırma mantığının hiçbir parçasını YENİDEN UYGULAMAZ.
#
# CASE A — canlı boş (0 ayrıcalık, SELECT hariç)         → exit 0, bulgu yok
# CASE B — canlı == deklare (altı tablo, DELETE)          → exit 0, bulgu yok
# CASE C — canlıda deklare EDİLMEMİŞ bir INSERT (ihlal)   → exit 1, pozitif kontrol
# CASE D — canlıda deklare edilmemiş bir DELETE (yedinci tablo) → exit 1
# CASE E — deklare dosyası ayrıştırılamıyor (0 satır)     → exit 2 (SETUP HATASI)
# CASE F — DB'ye ulaşılamıyor (mock exit 1)               → exit 2
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/app-operator-grants.sh"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: app-operator-grants.sh yok" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

mk_mock() {
  # $1 = dosya yolu · $2 = stdout içeriği · $3 = exit kodu
  cat > "$1" << EOF
#!/usr/bin/env bash
printf '%s' "$2"
exit $3
EOF
  chmod +x "$1"
}

# Gerçek dosyaya YAKIN, ama fixture — gerçek dosyayı DEĞİŞTİRMEDEN sınamak
# için ayrı bir SQL fixture'ı kullanılıyor.
DECLARED_SQL="$TMP/03-operator-grants.sql"
cat > "$DECLARED_SQL" << 'EOF'
GRANT SELECT ON ALL TABLES IN SCHEMA :"schema" TO app_operator;
GRANT DELETE ON :"schema".budget_transactions TO app_operator;
GRANT DELETE ON :"schema".plan_approval_history TO app_operator;
GRANT DELETE ON :"schema".plan_mechanic_values TO app_operator;
GRANT DELETE ON :"schema".plan_skus TO app_operator;
GRANT DELETE ON :"schema".plan_fus TO app_operator;
GRANT DELETE ON :"schema".plans TO app_operator;
EOF

# =============================================================================
# CASE A — canlı boş
# =============================================================================
MOCK_A="$TMP/mock-a.sh"
mk_mock "$MOCK_A" "" 0
OUT_A="$(APP_OP_GRANTS_DB_QUERY="$MOCK_A" APP_OP_GRANTS_SQL="$DECLARED_SQL" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
if [ "$RC_A" -ne 0 ]; then
  echo "!! self-test FAIL [case A]: canlı boşken exit 0 bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — canlı == deklare (temiz)
# =============================================================================
MOCK_B="$TMP/mock-b.sh"
mk_mock "$MOCK_B" "$(printf 'budget_transactions|DELETE\nplan_approval_history|DELETE\nplan_mechanic_values|DELETE\nplan_skus|DELETE\nplan_fus|DELETE\nplans|DELETE')" 0
OUT_B="$(APP_OP_GRANTS_DB_QUERY="$MOCK_B" APP_OP_GRANTS_SQL="$DECLARED_SQL" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 0 ]; then
  echo "!! self-test FAIL [case B]: canlı==deklare iken exit 0 bekleniyordu, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — deklare edilmemiş INSERT (pozitif kontrol — kayıtsız canlı sapma)
# =============================================================================
MOCK_C="$TMP/mock-c.sh"
mk_mock "$MOCK_C" "tenants|INSERT" 0
OUT_C="$(APP_OP_GRANTS_DB_QUERY="$MOCK_C" APP_OP_GRANTS_SQL="$DECLARED_SQL" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 1 ]; then
  echo "!! self-test FAIL [case C]: deklare edilmemiş INSERT'te exit 1 bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi
if ! grep -q '\[app-operator-grants\] main.tenants:INSERT' <<< "$OUT_C"; then
  echo "!! self-test FAIL [case C]: bulgu satırı 'main.tenants:INSERT' ile görünmedi" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — deklare edilmemiş yedinci tabloda DELETE (pozitif kontrol)
# =============================================================================
MOCK_D="$TMP/mock-d.sh"
mk_mock "$MOCK_D" "users|DELETE" 0
OUT_D="$(APP_OP_GRANTS_DB_QUERY="$MOCK_D" APP_OP_GRANTS_SQL="$DECLARED_SQL" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_D=$?
if [ "$RC_D" -ne 1 ]; then
  echo "!! self-test FAIL [case D]: deklare edilmemiş DELETE tablosunda exit 1 bekleniyordu, $RC_D bulundu" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi

# =============================================================================
# CASE E — deklare dosyası ayrıştırılamıyor (0 satır) → SETUP HATASI
# =============================================================================
EMPTY_SQL="$TMP/empty.sql"
: > "$EMPTY_SQL"
MOCK_E="$TMP/mock-e.sh"
mk_mock "$MOCK_E" "" 0
OUT_E="$(APP_OP_GRANTS_DB_QUERY="$MOCK_E" APP_OP_GRANTS_SQL="$EMPTY_SQL" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_E=$?
if [ "$RC_E" -ne 2 ]; then
  echo "!! self-test FAIL [case E]: boş deklare dosyasında exit 2 bekleniyordu, $RC_E bulundu" >&2
  printf '%s\n' "$OUT_E" >&2
  FAIL=1
fi

# =============================================================================
# CASE F — DB'ye ulaşılamıyor → exit 2 (SKIPPED/0 DEĞİL)
# =============================================================================
MOCK_F="$TMP/mock-f.sh"
mk_mock "$MOCK_F" "" 1
OUT_F="$(APP_OP_GRANTS_DB_QUERY="$MOCK_F" APP_OP_GRANTS_SQL="$DECLARED_SQL" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_F=$?
if [ "$RC_F" -ne 2 ]; then
  echo "!! self-test FAIL [case F]: DB ulaşılamazken exit 2 bekleniyordu, $RC_F bulundu" >&2
  printf '%s\n' "$OUT_F" >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "app-operator-grants self-test: 6/6 case tutuyor (A boş, B temiz, C INSERT-drift, D DELETE-drift, E parse-hatası→exit2, F DB-ulaşılamaz→exit2)"
  exit 0
fi
exit 1

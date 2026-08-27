#!/usr/bin/env bash
#
# self-test — view-security-invoker (T-308 / Z45 §1)
#
# Gerçek guard'ı (`view-security-invoker.sh`) `VIEW_GUARD_DB_QUERY` env
# override'ıyla ÇAĞIRIR — DB sorgu mantığının hiçbir parçasını YENİDEN
# UYGULAMAZ (`§2.7 #8`), yalnız db_query()'nin gittiği yeri değiştirir.
# Mock script'ler guard'ın kullandığı SQL'i YOK SAYAR, yalnız çıktı/exit-kod
# üretir — bu guard'ın DB ile tek teması SQL metnindeki filtre değil,
# db_query()'nin dönüş DEĞERİ (`Z44 §7` mutasyon-ekseni: davranışı ölç).
#
# CASE A — boş envanter (0 view)                → exit 0, bulgu yok
# CASE B — bir view, security_invoker=true       → exit 0, bulgu yok
# CASE C — bir view, reloptions boş (invoker yok)→ exit 1, "[view-security-invoker] main.v_foo"
# CASE D — ihlal allowlist'te                    → exit 0, SUPPRESSED
# CASE E — DB'ye ulaşılamıyor (mock exit 1)      → exit 2 (SKIPPED/0 DEĞİL)
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/view-security-invoker.sh"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: view-security-invoker.sh yok" >&2
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

# =============================================================================
# CASE A — boş envanter
# =============================================================================
MOCK_A="$TMP/mock-a.sh"
mk_mock "$MOCK_A" "" 0
OUT_A="$(VIEW_GUARD_DB_QUERY="$MOCK_A" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
if [ "$RC_A" -ne 0 ]; then
  echo "!! self-test FAIL [case A]: boş envanterde exit 0 bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — tek view, invoker'lı (temiz)
# =============================================================================
MOCK_B="$TMP/mock-b.sh"
mk_mock "$MOCK_B" "v_budget_summary|security_invoker=true" 0
OUT_B="$(VIEW_GUARD_DB_QUERY="$MOCK_B" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 0 ]; then
  echo "!! self-test FAIL [case B]: invoker'lı view'da exit 0 bekleniyordu, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — tek view, invoker YOK (ihlal — pozitif kontrol)
# =============================================================================
MOCK_C="$TMP/mock-c.sh"
mk_mock "$MOCK_C" "v_foo|" 0
OUT_C="$(VIEW_GUARD_DB_QUERY="$MOCK_C" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 1 ]; then
  echo "!! self-test FAIL [case C]: invoker'sız view'da exit 1 bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi
if ! printf '%s' "$OUT_C" | grep -q '\[view-security-invoker\] main.v_foo'; then
  echo "!! self-test FAIL [case C]: bulgu satırı 'main.v_foo' adıyla görünmedi" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — aynı ihlal allowlist'te (susturulmuş)
# =============================================================================
ALLOW_D="$TMP/allowlist-d.txt"
printf 'view-security-invoker|main.v_foo|geçici — RLS paketi kadar tolere edilen tarihsel örnek, self-test amaçlı\n' > "$ALLOW_D"
# Guard ALLOWLIST'i sabit yoldan okuyor (scripts/guards/allowlist.txt); bu
# case'i sınamak için guard'ı geçici bir kopyada ALLOWLIST değişkenine göre
# çağırmak yerine gerçek allowlist'e GEÇİCİ satır EKLEMEK riskli olurdu
# (paylaşılan dosya, paralel ajan). Onun yerine guard script'inin ALLOWLIST
# değişkenini override eden bir ENV yolu YOK — bu bilinen bir sınır: case D
# bu self-test'te DOĞRUDAN filter_allowlist() ile sınanır (lib.sh, guard'ın
# KULLANDIĞI AYNI fonksiyon — kopya değil).
GUARD_NAME="view-security-invoker"
ALLOWLIST="$ALLOW_D"
# shellcheck source=lib.sh
source "$DIR/lib.sh"
RAW_D="[view-security-invoker] main.v_foo
  security_invoker=true YOK — RLS politikaları bu view üzerinden ATLANABİLİR"
FILTERED_D="$(printf '%s\n' "$RAW_D" | filter_allowlist)"
if [ -n "$FILTERED_D" ]; then
  echo "!! self-test FAIL [case D]: allowlist'teki bulgu filter_allowlist'ten SONRA hâlâ görünüyor" >&2
  printf '%s\n' "$FILTERED_D" >&2
  FAIL=1
fi

# =============================================================================
# CASE E — DB'ye ulaşılamıyor → exit 2, SKIPPED/0 DEĞİL (pozitif kontrol —
# guard'ın en kritik davranışı: "ölçemedim" "temiz" değildir)
# =============================================================================
MOCK_E="$TMP/mock-e.sh"
mk_mock "$MOCK_E" "" 1
OUT_E="$(VIEW_GUARD_DB_QUERY="$MOCK_E" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_E=$?
if [ "$RC_E" -ne 2 ]; then
  echo "!! self-test FAIL [case E]: DB ulaşılamazken exit 2 bekleniyordu, $RC_E bulundu" >&2
  printf '%s\n' "$OUT_E" >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "view-security-invoker self-test: 5/5 case tutuyor (A boş-envanter, B temiz, C ihlal, D susturma, E DB-ulaşılamaz→exit2)"
  exit 0
fi
exit 1

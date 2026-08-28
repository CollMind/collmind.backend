#!/usr/bin/env bash
#
# self-test — schema-isolation (T-314/D — kendi bağlantısını kurma deseni)
#
# Gerçek guard'ı `SCHEMA_ISO_DB_QUERY` env override'ıyla ÇAĞIRIR — DB sorgu
# mantığının hiçbir parçasını YENİDEN UYGULAMAZ (§2.7 #8). Guard iki sorgu
# çalıştırır (namespace listesi, sonra migrations tablosu şema listesi) —
# mock script bunları SIRAYLA cevaplar (çağrı sayacı ile).
#
# CASE A — yalnız main var (public yok)                → exit 0, bulgu yok
# CASE B — main + public var, ikisinde de migrations    → exit 1, "db:collmind_tpm"
# CASE C — main + public var, yalnız main'de migrations → exit 0, bulgu yok
# CASE D — DB'ye ulaşılamıyor (mock boş+exit1)           → exit 0, SKIPPED (meşru)
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/schema-isolation.sh"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: schema-isolation.sh yok" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

# mk_mock <yol> <1. çağrı cevabı> <2. çağrı cevabı> <exit kodu>
# Guard db_query()'yi İKİ kez çağırır (namespace sorgusu, migrations sorgusu).
# Sıralı cevap vermek için bir sayaç dosyası kullanılır.
mk_mock() {
  local path="$1" resp1="$2" resp2="$3" rc="$4"
  local counter="$TMP/counter-$(basename "$path")"
  echo 0 > "$counter"
  cat > "$path" << EOF
#!/usr/bin/env bash
COUNTER_FILE="$counter"
N=\$(cat "\$COUNTER_FILE")
N=\$((N+1))
echo "\$N" > "\$COUNTER_FILE"
if [ "\$N" -eq 1 ]; then
  printf '%s' "$resp1"
else
  printf '%s' "$resp2"
fi
exit $rc
EOF
  chmod +x "$path"
}

# =============================================================================
# CASE A — yalnız main (public yok)
# =============================================================================
MOCK_A="$TMP/mock-a.sh"
mk_mock "$MOCK_A" "main" "main" 0
OUT_A="$(SCHEMA_ISO_DB_QUERY="$MOCK_A" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
if [ "$RC_A" -ne 0 ]; then
  echo "!! self-test FAIL [case A]: yalnız main varken exit 0 bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — main + public, ikisinde de migrations (pozitif kontrol: bulgu
# GERÇEKTEN üretiliyor mu). ⚠️ Guard'ın tek bulgu anahtarı ('db:collmind_tpm')
# `scripts/guards/allowlist.txt`'te KALICI OLARAK susturulmuş (lokal dev DB'nin
# gerçek hâli, T-067). Yani gerçek allowlist'e karşı koşan bu self-test exit 1
# DEĞİL, exit 0 + SUPPRESSED bekler — filter_allowlist'i BAYPAS ETMEK
# (ör. sahte bir allowlist'e yönlendirmek) guard'ın GERÇEKTEN kullandığı
# dosyadan sapardı (§2.7 #4: kanıt kurulumu ölçtüğün durumu değiştirmesin).
# =============================================================================
MOCK_B="$TMP/mock-b.sh"
mk_mock "$MOCK_B" "$(printf 'main\npublic')" "$(printf 'main\npublic')" 0
OUT_B="$(SCHEMA_ISO_DB_QUERY="$MOCK_B" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 0 ]; then
  echo "!! self-test FAIL [case B]: allowlist'te susturulmuş bulgu block modda hâlâ exit 0 vermeliydi, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi
if ! printf '%s' "$OUT_B" | grep -q 'SUPPRESSED: 1'; then
  echo "!! self-test FAIL [case B]: bulgu RAW olarak üretilmedi (SUPPRESSED satırı yok) — guard'ın bulgu ürettiği doğrulanamadı" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — main + public var ama migrations yalnız main'de (temiz)
# =============================================================================
MOCK_C="$TMP/mock-c.sh"
mk_mock "$MOCK_C" "$(printf 'main\npublic')" "main" 0
OUT_C="$(SCHEMA_ISO_DB_QUERY="$MOCK_C" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 0 ]; then
  echo "!! self-test FAIL [case C]: migrations yalnız main'deyken exit 0 bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — DB'ye ulaşılamıyor → exit 0, SKIPPED (bu guard'ın MEŞRU istisnası —
# view-security-invoker'ın AKSİNE, DB'siz bir geliştirme ortamı burada kabul
# edilir; bkz. run-all.sh:350 SKIPPED_OK ayrımı)
# =============================================================================
MOCK_D="$TMP/mock-d.sh"
mk_mock "$MOCK_D" "" "" 1
OUT_D="$(SCHEMA_ISO_DB_QUERY="$MOCK_D" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_D=$?
if [ "$RC_D" -ne 0 ]; then
  echo "!! self-test FAIL [case D]: DB ulaşılamazken exit 0 (SKIPPED) bekleniyordu, $RC_D bulundu" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi
if ! printf '%s' "$OUT_D" | grep -q 'SKIPPED'; then
  echo "!! self-test FAIL [case D]: çıktıda 'SKIPPED' görünmedi" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "schema-isolation self-test: 4/4 case tutuyor (A tek-şema, B ihlal, C temiz-iki-şema, D DB-ulaşılamaz→SKIPPED)"
  exit 0
fi
exit 1

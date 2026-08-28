#!/usr/bin/env bash
#
# self-test — new-table-rls (EK 1/b, Z53 §4b / Z54 §3)
#
# Gerçek guard'ı `NEW_TABLE_RLS_DB_QUERY` + `NEW_TABLE_RLS_BASELINE` env
# override'larıyla ÇAĞIRIR — karşılaştırma mantığının hiçbir parçasını
# YENİDEN UYGULAMAZ (§2.7 #8).
#
# CASE A — boş envanter (0 tenant tablosu) ⇒ ÖLÇÜM YAPILMADI  → exit 2
# CASE B — baseline'daki tablo RLS'siz (tolere edilen borç)    → exit 0
# CASE C — baseline'daki tablo RLS+FORCE kazanmış (iyileşme)   → exit 0
# CASE D — baseline'da OLMAYAN yeni tablo, RLS YOK (poz.kont.) → exit 1
# CASE E — baseline'da olmayan tablo ENABLE var ama FORCE yok  → exit 1
# CASE F — DB'ye ulaşılamıyor                                  → exit 2
# CASE G — baseline dosyası yok                                 → exit 2
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/new-table-rls.sh"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: new-table-rls.sh yok" >&2
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

BASELINE="$TMP/baseline.txt"
printf 'plans\nagreements\n' > "$BASELINE"

# =============================================================================
# CASE A — boş envanter
# =============================================================================
MOCK_A="$TMP/mock-a.sh"
mk_mock "$MOCK_A" "" 0
OUT_A="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_A" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
# ⛔ BEKLENTİ DEĞİŞTİ (review B3/S1, 2026-08-28): boş envanter "TEMİZ" DEĞİL,
# "ÖLÇÜM YAPILMADI"dır. Bu üründe `main` şemasında `tenant_id` taşıyan tablo
# olmaması İMKÂNSIZDIR (bugün 44) ⇒ boşluk bir ALARMDIR.
# ⚠️ VE BU SELF-TEST, ESKİ HÂLİYLE YANLIŞ DAVRANIŞI MÜHÜRLÜYORDU: `exit 0`
#   bekleyerek, kapının "ölçemedim"i "temiz"e yuvarlamasını DOĞRU ilan
#   ediyordu. Bir self-test, sınadığı kapının SÖZLEŞMESİNİ de sınar —
#   yalnız davranışını değil.
if [ "$RC_A" -ne 2 ]; then
  echo "!! self-test FAIL [case A]: boş envanterde exit 2 (ÖLÇÜM YAPILMADI) bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — baseline'daki tablo RLS'siz (tolere edilen borç)
# =============================================================================
MOCK_B="$TMP/mock-b.sh"
mk_mock "$MOCK_B" "plans|f|f" 0
OUT_B="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_B" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 0 ]; then
  echo "!! self-test FAIL [case B]: baseline'daki tabloda exit 0 (tolere) bekleniyordu, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — baseline'daki tablo RLS+FORCE kazanmış (iyileşme, hâlâ temiz)
# =============================================================================
MOCK_C="$TMP/mock-c.sh"
mk_mock "$MOCK_C" "plans|t|t" 0
OUT_C="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_C" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 0 ]; then
  echo "!! self-test FAIL [case C]: RLS+FORCE kazanmış tabloda exit 0 bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — baseline'da OLMAYAN yeni tablo, hiç RLS yok (pozitif kontrol —
# Z54'ün sözleşmesi: yeni tenant tablosu ENABLE+FORCE olmadan doğamaz)
# =============================================================================
MOCK_D="$TMP/mock-d.sh"
mk_mock "$MOCK_D" "new_tenant_widgets|f|f" 0
OUT_D="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_D" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_D=$?
if [ "$RC_D" -ne 1 ]; then
  echo "!! self-test FAIL [case D]: baseline-dışı yeni tabloda RLS yokken exit 1 bekleniyordu, $RC_D bulundu" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi
if ! printf '%s' "$OUT_D" | grep -q '\[new-table-rls\] main.new_tenant_widgets'; then
  echo "!! self-test FAIL [case D]: bulgu satırı 'main.new_tenant_widgets' ile görünmedi" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi

# =============================================================================
# CASE E — baseline'da olmayan tablo yalnız ENABLE var, FORCE yok (ÇİFT şartı —
# pozitif kontrol: yarım uyum yetmez)
# =============================================================================
MOCK_E="$TMP/mock-e.sh"
mk_mock "$MOCK_E" "new_tenant_widgets|t|f" 0
OUT_E="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_E" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_E=$?
if [ "$RC_E" -ne 1 ]; then
  echo "!! self-test FAIL [case E]: yalnız ENABLE (FORCE yok) exit 1 bekleniyordu, $RC_E bulundu" >&2
  printf '%s\n' "$OUT_E" >&2
  FAIL=1
fi

# =============================================================================
# CASE F — DB'ye ulaşılamıyor → exit 2
# =============================================================================
MOCK_F="$TMP/mock-f.sh"
mk_mock "$MOCK_F" "" 1
OUT_F="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_F" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_F=$?
if [ "$RC_F" -ne 2 ]; then
  echo "!! self-test FAIL [case F]: DB ulaşılamazken exit 2 bekleniyordu, $RC_F bulundu" >&2
  printf '%s\n' "$OUT_F" >&2
  FAIL=1
fi

# =============================================================================
# CASE G — baseline dosyası yok → exit 2 (SETUP HATASI)
# =============================================================================
MOCK_G="$TMP/mock-g.sh"
mk_mock "$MOCK_G" "" 0
OUT_G="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_G" NEW_TABLE_RLS_BASELINE="$TMP/nonexistent-baseline.txt" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_G=$?
if [ "$RC_G" -ne 2 ]; then
  echo "!! self-test FAIL [case G]: baseline yokken exit 2 bekleniyordu, $RC_G bulundu" >&2
  printf '%s\n' "$OUT_G" >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "new-table-rls self-test: 7/7 case tutuyor (A boş, B tolere-borç, C iyileşme, D yeni-tablo-RLS-yok, E yarım-uyum, F DB-ulaşılamaz, G baseline-yok)"
  exit 0
fi
exit 1

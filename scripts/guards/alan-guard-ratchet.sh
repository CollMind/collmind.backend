#!/usr/bin/env bash
#
# Guard: alan-guard-ratchet  (`B4` `A′` keskinleştirme-2, `Z44`, "`DUR`
# ÇÖZÜLDÜ — SEÇENEK 1", 2026-08-27)
#
# `CapabilityGuard` artık TANINAN bir domain-guard (`KNOWN_DOMAIN_GUARD_
# NAMES`) taşıyan rotayı default-deny'dan MUAF tutuyor. Bu, `roles-ratchet`
# ile AYNI riski TAŞIR: `ALAN_GUARD` kovası SESSİZCE büyüyebilir (yeni bir
# rota `SettlementGuard`/`ReversalGuard` takar, muaf olur). Bu ratchet o
# BÜYÜMEYİ SAYAR — `domain-guard-parity.sh`'ın ölçmediği eksen bu: parity
# yeni bir guard SINIFININ meşruiyetini denetler, bu ratchet MEVCUT
# guard'ların kova İÇİNDEKİ rota SAYISININ artmadığını denetler. İkisi
# BİRLİKTE ÇİFT-KAYIT şartını tamamlar (SAYI ratchet'i + SINIF paritesi).
#
# NE ÖLÇER
#   `route-scope.sh --list-alan-guard` çıktısını (ALAN_GUARD kovasının
#   anahtar listesi) `scripts/guards/alan-guard-baseline.txt`'e karşı
#   karşılaştırır. İKİNCİ bir parser YAZILMADI (İlke: mevcut mekanizmayı
#   yeniden kullan) — kaynak `route-scope.sh`'ın kendi sınıflandırmasıdır
#   (`route-scope.awk`), `roles-ratchet.sh` ile BİREBİR AYNI desen.
#
# ARTIŞ YASAK · DÜŞÜŞ yalnız sözleşme-koşulu açıldığında (baseline AYRI,
# gözden geçirilebilir bir commit'te düşürülür — `route-scope.sh --baseline`
# ile AYNI desen: baseline KENDİNİ YAZMAZ).
#
# GUARD_MODE=block (varsayılan) → ALAN_GUARD kovasına YENİ bir anahtar
#                                  eklendiyse exit 1
# GUARD_MODE=report             → bulguları bas, exit 0
# --baseline                    → bugünkü ALAN_GUARD envanterini stdout'a
#                                  bas (route-scope.sh --list-alan-guard'un
#                                  ta kendisi — ayrı bir üretici YOK)
#
# Kaynak boş / bozuk baseline BİÇİMİ (başlıksız ya da 'G ' ile başlamayan
# bir veri satırı) → exit 2 (SETUP HATASI / ÖLÇÜM YAPILMADI, tüm modlarda).
set -uo pipefail

GUARD_NAME="alan-guard-ratchet"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROUTE_SCOPE_SH="$ROOT/scripts/guards/route-scope.sh"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
BASELINE="${ALAN_GUARD_RATCHET_BASELINE:-$ROOT/scripts/guards/alan-guard-baseline.txt}"
# Fixture yönlendirmesi (self-test) — üretimde set edilmez. route-scope.sh'a
# AYNEN geçirilir (o da kendi SRC_DIR override'ını aynı isimle okur).
SRC_DIR_OVERRIDE="${ALAN_GUARD_RATCHET_SRC_DIR:-}"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

if [ ! -f "$ROUTE_SCOPE_SH" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: kaynak bulunamadı ($ROUTE_SCOPE_SH)" >&2
  exit 2
fi

# --- --baseline: route-scope.sh --list-alan-guard'u OLDUĞU GİBİ ilet -------
if [ "${1:-}" = "--baseline" ]; then
  if [ -n "$SRC_DIR_OVERRIDE" ]; then
    ROUTE_SCOPE_SRC_DIR="$SRC_DIR_OVERRIDE" bash "$ROUTE_SCOPE_SH" --list-alan-guard
  else
    bash "$ROUTE_SCOPE_SH" --list-alan-guard
  fi
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CUR_RAW="$TMP/cur-alan-guard.txt"

if [ -n "$SRC_DIR_OVERRIDE" ]; then
  ROUTE_SCOPE_SRC_DIR="$SRC_DIR_OVERRIDE" bash "$ROUTE_SCOPE_SH" --list-alan-guard > "$CUR_RAW" 2>"$TMP/rs.err"
  RS_RC=$?
else
  bash "$ROUTE_SCOPE_SH" --list-alan-guard > "$CUR_RAW" 2>"$TMP/rs.err"
  RS_RC=$?
fi

if [ "$RS_RC" -ne 0 ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: route-scope.sh --list-alan-guard KOŞAMADI (exit $RS_RC)" >&2
  cat "$TMP/rs.err" >&2
  exit 2
fi

if ! head -1 "$CUR_RAW" 2>/dev/null | grep -q '^#'; then
  echo "!! [$GUARD_NAME] SETUP HATASI: route-scope.sh --list-alan-guard çıktısı TANINMADI." >&2
  echo "!! Ölçüm YAPILMADI." >&2
  exit 2
fi

MALFORMED_CUR="$(grep -vE '^(#|[[:space:]]*$|G )' "$CUR_RAW" || true)"
if [ -n "$MALFORMED_CUR" ]; then
  {
    echo "!! [$GUARD_NAME] SETUP HATASI: route-scope.sh --list-alan-guard çıktısı TANINMAYAN satır(lar) içeriyor:"
    printf '%s\n' "$MALFORMED_CUR" | sed 's/^/!!   /'
    echo "!! Ölçüm YAPILMADI."
  } >&2
  exit 2
fi

CUR_KEYS="$TMP/cur-keys.txt"
awk '/^G /{ print $2 }' "$CUR_RAW" | LC_ALL=C sort -u > "$CUR_KEYS"
CUR_N="$(wc -l < "$CUR_KEYS" | tr -d ' ')"

if [ ! -f "$BASELINE" ]; then
  # mode-split/route-scope ile AYNI sözleşme: baseline yoksa SKIPPED —
  # ilk --baseline koşumundan ÖNCEki meşru geçiş durumu.
  echo "-- [$GUARD_NAME] SKIPPED: baseline bulunamadı ($BASELINE)"
  exit 0
fi

if ! head -1 "$BASELINE" 2>/dev/null | grep -q '^#'; then
  echo "!! [$GUARD_NAME] SETUP HATASI: baseline başlık biçimi TANINMADI ($BASELINE)." >&2
  echo "!! İlk satır '#' ile başlamalı — dosya bozulmuş olabilir. Ölçüm YAPILMADI." >&2
  exit 2
fi

MALFORMED_BASE="$(grep -vE '^(#|[[:space:]]*$|G )' "$BASELINE" || true)"
if [ -n "$MALFORMED_BASE" ]; then
  {
    echo "!! [$GUARD_NAME] SETUP HATASI: baseline TANINMAYAN satır(lar) içeriyor ($BASELINE):"
    printf '%s\n' "$MALFORMED_BASE" | sed 's/^/!!   /'
    echo "!! Ölçüm YAPILMADI."
  } >&2
  exit 2
fi

BASE_KEYS="$TMP/base-keys.txt"
awk '/^G /{ print $2 }' "$BASELINE" | LC_ALL=C sort -u > "$BASE_KEYS"
BASE_N="$(wc -l < "$BASE_KEYS" | tr -d ' ')"

# --- YENİ ALAN_GUARD anahtarı — baseline'da yok → İHLAL ---------------------
NEW_KEYS="$(LC_ALL=C comm -23 "$CUR_KEYS" "$BASE_KEYS")"
RAW=""
if [ -n "$NEW_KEYS" ]; then
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    RAW="${RAW}[$GUARD_NAME] ${key}
  YENİ ALAN_GUARD ROTASI — ALAN_GUARD kovası baseline'dan (${BASE_N}) beri BÜYÜDÜ
  > CapabilityGuard TANINAN domain-guard'ları (KNOWN_DOMAIN_GUARD_NAMES)
    default-deny'dan MUAF sayıyor; bu ratchet o muafiyetin ROTA SAYISININ
    sessizce büyümesini engeller (domain-guard-parity.sh'ın kapsamadığı
    eksen — parity yeni bir guard SINIFINI denetler, bu ratchet mevcut
    guard'ların kova İÇİNDEKİ rota sayısını).
  > Yeni bir ALAN_GUARD rotası KASITLIYSA (yeni bir domain-guard'a
    @UseGuards ile bağlandıysa): alan-guard-baseline.txt'e AYRI, gözden
    geçirilebilir bir commit'te ekle — alan-guard-ratchet.sh --baseline >
    scripts/guards/alan-guard-baseline.txt.
"
  done <<< "$NEW_KEYS"
fi

# --- baseline'daki bir anahtar bugün artık ALAN_GUARD değil / hiç yok — bilgi
IMPROVED=0
while IFS= read -r key; do
  [ -z "$key" ] && continue
  if grep -qxF "$key" "$CUR_KEYS"; then
    continue
  fi
  # baseline'da olup bugün ALAN_GUARD'ta olmayan HER anahtar bir GÖÇ ya da
  # SİLİNME olayıdır — ikisi de İHLAL değildir, bilgi amaçlı basılır.
  echo "-- [$GUARD_NAME] AZALDI: ${key} artık ALAN_GUARD kovasında değil (guard değişti ya da rota silindi). Baseline'ı AYRI bir commit'te güncelle: alan-guard-ratchet.sh --baseline > scripts/guards/alan-guard-baseline.txt"
  IMPROVED=$((IMPROVED + 1))
done < "$BASE_KEYS"

[ "$IMPROVED" -gt 0 ] && echo

report_guard "$RAW"

echo "=== [$GUARD_NAME] özet ==="
echo "  ALAN_GUARD: ${CUR_N} (baseline: ${BASE_N})"

if [ "$GUARD_MODE" = "block" ] && [ -n "$NEW_KEYS" ]; then
  echo "!! [$GUARD_NAME] ratchet ihlali: yukarıdaki YENİ ALAN_GUARD rota(lar) baseline'a" >&2
  echo "!! EKLENEMEZ — Z44 A′'nin domain-guard muafiyet evreni SESSİZCE büyüyemez." >&2
  exit 1
fi
exit 0

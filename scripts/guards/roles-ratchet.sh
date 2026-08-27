#!/usr/bin/env bash
#
# Guard: roles-ratchet  (`B4` `A′`, `Z44 §2/§4`)
#
# `CapabilityGuard` `default-deny`'a döndü (`Z44 §2`) ve `@Roles` taşıyan
# rotaları TÜRETİLMİŞ evrenden MUAF tutuyor (`capability.guard.ts`, adım 4:
# "yetenek YOK ∧ @Roles VAR → true"). Bu muafiyetin sınırı bir elle-liste
# DEĞİL — kalan-`@Roles` kovasının KENDİSİ büyümesin diye bir ratchet
# gerekiyor: `route-scope.sh`'ın `ROLES` kovasının, `RolesGuard` boşalana
# kadar (`B` düğmesi) GENİŞLEMEDİĞİNİ ölçer.
#
# NE ÖLÇER
#   `route-scope.sh --list-roles` çıktısını (ROLES kovasının anahtar listesi)
#   `scripts/guards/roles-baseline.txt`'e karşı karşılaştırır. İKİNCİ bir
#   parser YAZILMADI (İlke: mevcut mekanizmayı yeniden kullan) — kaynak
#   `route-scope.sh`'ın kendi sınıflandırmasıdır (`route-scope.awk`).
#
# ⛔ TABAN 15, DİP DEĞER 2 — SIFIR DEĞİL.
#   `Z44 §4`: kalan 15'in 2'si KALICI (`plans/pending-approvals` ·
#   `finance-reporting/budget-variance`) — ikisi de gerekçesiyle kayıtlı,
#   koşulsuz, ASLA sıfıra inmez. Bu ratchet'in HEDEFİ `0` DEĞİLDİR; hedef
#   `13`'ün (koşullu kısmın) kademeli olarak `0`'a inmesi, `2`'nin ise
#   KALICI kalmasıdır. Bir sonraki tur "neden sıfır değil" diye SORMASIN
#   diye bu not BURAYA yazılmıştır (görev talimatı — brief §3).
#
# ARTIŞ YASAK · DÜŞÜŞ yalnız sözleşme-koşulu açıldığında (baseline AYRI,
# gözden geçirilebilir bir commit'te düşürülür — `route-scope.sh --baseline`
# ile AYNI desen: baseline KENDİNİ YAZMAZ).
#
# GUARD_MODE=block (varsayılan) → ROLES kovasına YENİ bir anahtar eklendiyse
#                                  exit 1
# GUARD_MODE=report             → bulguları bas, exit 0
# --baseline                    → bugünkü ROLES envanterini stdout'a bas
#                                  (route-scope.sh --list-roles'un ta kendisi
#                                  — ayrı bir üretici YOK, tek kaynak)
#
# Kaynak boş / bozuk baseline BİÇİMİ (başlıksız ya da 'R ' ile başlamayan bir
# veri satırı) → exit 2 (SETUP HATASI / ÖLÇÜM YAPILMADI, tüm modlarda).
set -uo pipefail

GUARD_NAME="roles-ratchet"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROUTE_SCOPE_SH="$ROOT/scripts/guards/route-scope.sh"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
BASELINE="${ROLES_RATCHET_BASELINE:-$ROOT/scripts/guards/roles-baseline.txt}"
# Fixture yönlendirmesi (self-test) — üretimde set edilmez. route-scope.sh'a
# AYNEN geçirilir (o da kendi SRC_DIR override'ını aynı isimle okur).
SRC_DIR_OVERRIDE="${ROLES_RATCHET_SRC_DIR:-}"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

if [ ! -f "$ROUTE_SCOPE_SH" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: kaynak bulunamadı ($ROUTE_SCOPE_SH)" >&2
  exit 2
fi

# --- --baseline: route-scope.sh --list-roles'u OLDUĞU GİBİ ilet ------------
if [ "${1:-}" = "--baseline" ]; then
  if [ -n "$SRC_DIR_OVERRIDE" ]; then
    ROUTE_SCOPE_SRC_DIR="$SRC_DIR_OVERRIDE" bash "$ROUTE_SCOPE_SH" --list-roles
  else
    bash "$ROUTE_SCOPE_SH" --list-roles
  fi
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CUR_RAW="$TMP/cur-roles.txt"

if [ -n "$SRC_DIR_OVERRIDE" ]; then
  ROUTE_SCOPE_SRC_DIR="$SRC_DIR_OVERRIDE" bash "$ROUTE_SCOPE_SH" --list-roles > "$CUR_RAW" 2>"$TMP/rs.err"
  RS_RC=$?
else
  bash "$ROUTE_SCOPE_SH" --list-roles > "$CUR_RAW" 2>"$TMP/rs.err"
  RS_RC=$?
fi

if [ "$RS_RC" -ne 0 ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: route-scope.sh --list-roles KOŞAMADI (exit $RS_RC)" >&2
  cat "$TMP/rs.err" >&2
  exit 2
fi

if ! head -1 "$CUR_RAW" 2>/dev/null | grep -q '^#'; then
  echo "!! [$GUARD_NAME] SETUP HATASI: route-scope.sh --list-roles çıktısı TANINMADI." >&2
  echo "!! Ölçüm YAPILMADI." >&2
  exit 2
fi

MALFORMED_CUR="$(grep -vE '^(#|[[:space:]]*$|R )' "$CUR_RAW" || true)"
if [ -n "$MALFORMED_CUR" ]; then
  {
    echo "!! [$GUARD_NAME] SETUP HATASI: route-scope.sh --list-roles çıktısı TANINMAYAN satır(lar) içeriyor:"
    printf '%s\n' "$MALFORMED_CUR" | sed 's/^/!!   /'
    echo "!! Ölçüm YAPILMADI."
  } >&2
  exit 2
fi

CUR_KEYS="$TMP/cur-keys.txt"
awk '/^R /{ print $2 }' "$CUR_RAW" | LC_ALL=C sort -u > "$CUR_KEYS"
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

MALFORMED_BASE="$(grep -vE '^(#|[[:space:]]*$|R )' "$BASELINE" || true)"
if [ -n "$MALFORMED_BASE" ]; then
  {
    echo "!! [$GUARD_NAME] SETUP HATASI: baseline TANINMAYAN satır(lar) içeriyor ($BASELINE):"
    printf '%s\n' "$MALFORMED_BASE" | sed 's/^/!!   /'
    echo "!! Ölçüm YAPILMADI."
  } >&2
  exit 2
fi

BASE_KEYS="$TMP/base-keys.txt"
awk '/^R /{ print $2 }' "$BASELINE" | LC_ALL=C sort -u > "$BASE_KEYS"
BASE_N="$(wc -l < "$BASE_KEYS" | tr -d ' ')"

# --- YENİ ROLES anahtarı — baseline'da yok → İHLAL --------------------------
NEW_KEYS="$(LC_ALL=C comm -23 "$CUR_KEYS" "$BASE_KEYS")"
RAW=""
if [ -n "$NEW_KEYS" ]; then
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    RAW="${RAW}[$GUARD_NAME] ${key}
  YENİ @Roles ROTASI — kalan-@Roles kovası baseline'dan (${BASE_N}) beri BÜYÜDÜ
  > CapabilityGuard default-deny'a döndü (Z44 A′) ve @Roles muafiyeti
    TÜRETİLMİŞ evrenden gelir; bu ratchet o evrenin BÜYÜMESİNİ engeller.
  > Yeni bir @Roles rotası GEREKİYORSA: @RequireCapability'ye göç ET
    (ROLE_CAPABILITIES haritasına eşleme ekleyerek). @Roles kalıcıysa
    (bkz. Z44 §4 KALICI iki satır emsali) gerekçesiyle roles-baseline.txt'e
    AYRI bir commit'te eklenir.
"
  done <<< "$NEW_KEYS"
fi

# --- baseline'daki bir anahtar bugün artık ROLES değil / hiç yok — bilgi ----
IMPROVED=0
GONE=0
while IFS= read -r key; do
  [ -z "$key" ] && continue
  if grep -qxF "$key" "$CUR_KEYS"; then
    continue
  fi
  # Rota hâlâ envanterde mi (route-scope tüm rotaları basar, biz yalnız ROLES
  # kovasını okuduk) — ayırt etmek için tüm rotaların anahtar kümesine ihtiyaç
  # yok: route-scope.sh zaten "GONE"/"İYİLEŞTİ" ayrımını KENDİ ratchet'inde
  # yapıyor (FILTRESIZ için). Burada basit tutuluyor: baseline'da olup bugün
  # ROLES'te olmayan HER anahtar bir İYİLEŞME OLAYI ya da bir SİLİNMEdir —
  # ikisi de İHLAL değildir, bilgi amaçlı basılır.
  echo "-- [$GUARD_NAME] AZALDI: ${key} artık ROLES kovasında değil (göçtü ya da rota silindi). Baseline'ı AYRI bir commit'te güncelle: roles-ratchet.sh --baseline > scripts/guards/roles-baseline.txt"
  IMPROVED=$((IMPROVED + 1))
done < "$BASE_KEYS"

[ "$IMPROVED" -gt 0 ] && echo

report_guard "$RAW"

echo "=== [$GUARD_NAME] özet ==="
echo "  kalan @Roles: ${CUR_N} (baseline: ${BASE_N}) · DİP DEĞER: 2 (KALICI, Z44 §4 — SIFIR DEĞİL)"

if [ "$GUARD_MODE" = "block" ] && [ -n "$NEW_KEYS" ]; then
  echo "!! [$GUARD_NAME] ratchet ihlali: yukarıdaki YENİ @Roles rota(lar) baseline'a" >&2
  echo "!! EKLENEMEZ — Z44 A′'nin türetilmiş muafiyet evreni büyüyemez." >&2
  exit 1
fi
exit 0

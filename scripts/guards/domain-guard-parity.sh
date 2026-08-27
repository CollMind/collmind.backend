#!/usr/bin/env bash
#
# Guard: domain-guard-parity  (`B4` `A′` keskinleştirme-1, `Z44`, "`DUR`
# ÇÖZÜLDÜ — SEÇENEK 1", 2026-08-27)
#
# `CapabilityGuard` artık TANINAN bir domain-guard (ör. `SettlementGuard`,
# `ReversalGuard`) taşıyan rotayı default-deny'dan MUAF tutuyor
# (`capability.guard.ts`, `KNOWN_DOMAIN_GUARD_NAMES` — KAYNAK B). Bu
# muafiyet `roles-ratchet` gibi bir SAYI ratchet'iyle KORUNAMAZ: bir
# `ALAN_GUARD` ratchet'i yalnız "kaç rota bu kovada" sorusuna cevap verir,
# "bu kovaya YENİ giren guard SINIFI meşru mu" sorusuna DEĞİL. Biri yarın
# `FooGuard` yazıp zincire koyarsa, rota SESSİZCE muaf olur; ratchet `+1`
# gösterir ama `+1`'in MEŞRU olup olmadığını söylemez.
#
# NE ÖLÇER
#   KAYNAK A (`route-scope.sh:184`, `route-scope.awk`'ın ALAN_GUARD
#   kovasını üreten yer): `KNOWN_DOMAIN_GUARDS=" ${ROUTE_SCOPE_DOMAIN_
#   GUARDS:-ReversalGuard SettlementGuard} "` — varsayılan değer.
#   KAYNAK B (`capability.guard.ts`, `KNOWN_DOMAIN_GUARD_NAMES` dizisi):
#   `CapabilityGuard`'ın çalışma zamanında MUAF SAYDIĞI isimler.
#
#   İkisi BAĞIMSIZ dosyalarda, BAĞIMSIZ elle yazılmış listelerdir — hiçbir
#   kod ikisini birbirinden TÜRETMEZ (türetilemez de: KAYNAK A statik bir
#   metin taraması, KAYNAK B çalışma zamanında `GUARDS_METADATA` okuyan bir
#   isim listesi). Bu guard ikisini ÇAKIŞTIRIR: kümeler EŞİT DEĞİLSE
#   (hangi yönde olursa olsun fark) İHLAL — yeni bir domain-guard eklemek
#   İKİ dosyaya BİRDEN dokunmayı zorunlu kılar (çift-kayıt şartı: "her
#   giriş bir karar adlandırır").
#
# GUARD_MODE=block (varsayılan) → kümeler farklıysa exit 1
# GUARD_MODE=report             → bulguyu bas, exit 0
# Kaynaklardan biri okunamazsa / desen bulunamazsa → exit 2 (SETUP HATASI)
set -uo pipefail

GUARD_NAME="domain-guard-parity"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
ROUTE_SCOPE_SRC="${DOMAIN_GUARD_PARITY_ROUTE_SCOPE_SH:-$ROOT/scripts/guards/route-scope.sh}"
CAPABILITY_GUARD_SRC="${DOMAIN_GUARD_PARITY_CAPABILITY_GUARD_TS:-$ROOT/src/common/guards/capability.guard.ts}"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

if [ ! -f "$ROUTE_SCOPE_SRC" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: KAYNAK A bulunamadı ($ROUTE_SCOPE_SRC)" >&2
  exit 2
fi
if [ ! -f "$CAPABILITY_GUARD_SRC" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: KAYNAK B bulunamadı ($CAPABILITY_GUARD_SRC)" >&2
  exit 2
fi

# --- KAYNAK A: route-scope.sh'ın KNOWN_DOMAIN_GUARDS varsayılan değeri ------
# Satır şekli: KNOWN_DOMAIN_GUARDS=" ${ROUTE_SCOPE_DOMAIN_GUARDS:-NAME1 NAME2} "
# ⛔ ETKİN DEĞER ≠ LİTERAL VARSAYILAN (A-prime review S3, 2026-08-27).
# Aşağıda `route-scope.sh`'ın KNOWN_DOMAIN_GUARDS satırındaki LİTERAL
# varsayılan okunur. `ROUTE_SCOPE_DOMAIN_GUARDS` env'i set edilmişse
# `route-scope`'un ETKİN sınıflandırması farklı olur ve bu çakıştırma
# ÖLÇTÜĞÜNÜ SANDIĞI ŞEYİ ÖLÇMEZ ⇒ sessiz yeşil riski. O yüzden ölçüm
# YAPILMAZ, `exit 2` verilir: bir kapı, ölçemeyeceği bir durumda
# YEŞİL DEĞİL, SETUP HATASI raporlar.
if [ -n "${ROUTE_SCOPE_DOMAIN_GUARDS:-}" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: ROUTE_SCOPE_DOMAIN_GUARDS env'i SET EDİLMİŞ" >&2
  echo "!!   ('${ROUTE_SCOPE_DOMAIN_GUARDS}'). KAYNAK A'nın ETKİN değeri literal" >&2
  echo "!!   varsayılandan FARKLI olur; çakıştırma ANLAMSIZLAŞIR. ÖLÇÜM YAPILMADI." >&2
  exit 2
fi
A_LINE="$(grep -E '^KNOWN_DOMAIN_GUARDS=' "$ROUTE_SCOPE_SRC" || true)"
if [ -z "$A_LINE" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: KAYNAK A'da KNOWN_DOMAIN_GUARDS satırı bulunamadı ($ROUTE_SCOPE_SRC)" >&2
  exit 2
fi
A_RAW="$(printf '%s' "$A_LINE" | sed -n 's/.*:-\(.*\)}.*/\1/p')"
if [ -z "$A_RAW" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: KAYNAK A satırı beklenen ŞEKİLDE değil (varsayılan değer ayrıştırılamadı): $A_LINE" >&2
  exit 2
fi
A_KEYS="$(printf '%s\n' $A_RAW | LC_ALL=C sort -u)"

# --- KAYNAK B: capability.guard.ts'in KNOWN_DOMAIN_GUARD_NAMES dizisi ------
B_BLOCK="$(awk '/const KNOWN_DOMAIN_GUARD_NAMES/,/\];/' "$CAPABILITY_GUARD_SRC")"
if [ -z "$B_BLOCK" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: KAYNAK B'de KNOWN_DOMAIN_GUARD_NAMES dizisi bulunamadı ($CAPABILITY_GUARD_SRC)" >&2
  exit 2
fi
B_KEYS="$(printf '%s\n' "$B_BLOCK" | grep -oE "'[A-Za-z0-9_]+'" | tr -d "'" | LC_ALL=C sort -u)"
if [ -z "$B_KEYS" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: KAYNAK B dizisinden hiçbir isim ayrıştırılamadı ($CAPABILITY_GUARD_SRC)" >&2
  exit 2
fi

ONLY_A="$(LC_ALL=C comm -23 <(printf '%s\n' "$A_KEYS") <(printf '%s\n' "$B_KEYS"))"
ONLY_B="$(LC_ALL=C comm -13 <(printf '%s\n' "$A_KEYS") <(printf '%s\n' "$B_KEYS"))"

RAW=""
if [ -n "$ONLY_A" ]; then
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    RAW="${RAW}[$GUARD_NAME] KAYNAK-A-ONLY:${name}
  ÇİFT-KAYIT İHLALİ — '${name}' route-scope.sh (KAYNAK A) KNOWN_DOMAIN_GUARDS'ta
  var, capability.guard.ts (KAYNAK B) KNOWN_DOMAIN_GUARD_NAMES'te YOK.
  > route-scope.awk bu guard'ı ALAN_GUARD olarak sınıflandırıyor ama
    CapabilityGuard onu default-deny'dan MUAF SAYMIYOR — rota, guard
    zincirinde CapabilityGuard varsa YANLIŞLIKLA 403 alabilir.
  > Çözüm: '${name}' KASITLI bir domain-guard'sa capability.guard.ts'e
    KARAR KAYDIYLA ekle; değilse route-scope.sh'ın varsayılanından çıkar.
"
  done <<< "$ONLY_A"
fi
if [ -n "$ONLY_B" ]; then
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    RAW="${RAW}[$GUARD_NAME] KAYNAK-B-ONLY:${name}
  ÇİFT-KAYIT İHLALİ — '${name}' capability.guard.ts (KAYNAK B)
  KNOWN_DOMAIN_GUARD_NAMES'te var, route-scope.sh (KAYNAK A)
  KNOWN_DOMAIN_GUARDS'ta YOK.
  > CapabilityGuard bu ismi MUAF sayıyor ama route-scope.awk onu ALAN_GUARD
    olarak TANIMIYOR — statik envanter (route-scope --list-roles ailesi)
    ile çalışma zamanı davranışı AYRIŞIYOR; SESSİZ bir muafiyet olabilir.
  > Çözüm: '${name}' KASITLI bir domain-guard'sa route-scope.sh'ın
    KNOWN_DOMAIN_GUARDS varsayılanına KARAR KAYDIYLA ekle; değilse
    capability.guard.ts'ten çıkar.
"
  done <<< "$ONLY_B"
fi

echo "=== [$GUARD_NAME] özet ==="
echo "  KAYNAK A (route-scope.sh):        $(printf '%s' "$A_KEYS" | tr '\n' ' ')"
echo "  KAYNAK B (capability.guard.ts):    $(printf '%s' "$B_KEYS" | tr '\n' ' ')"

report_guard "$RAW"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  echo "!! [$GUARD_NAME] ÇİFT-KAYIT İHLALİ: KAYNAK A ve KAYNAK B AYNI kümeyi taşımıyor (yukarıya bak)" >&2
  exit 1
fi
exit 0

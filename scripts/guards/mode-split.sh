#!/usr/bin/env bash
#
# Guard: mode-split  (E1 · `A1` kararının ikinci maddesi, 2026-08-12)
#
# NE YAPAR: `src/modules/modes/` bölmesini DONDURUR.
#
#   bölme altına yeni dosya            → kırmızı
#   bölmeye yeni import/referans       → kırmızı
#   mevcut bir dosyanın BÜYÜMESİ       → kırmızı
#   silme · küçülme · referans azalması→ sessizce geçer (ratchet aşağı döner)
#
# Mevcut dosyalara dokunmak SERBEST. Amaç büyümeyi durdurmak, çalışmayı değil.
#
# NEDEN BUGÜN
# `A1` bölmeyi ölü ilan etti ve üç adım koydu: (1) ölü ilan ✅ · (2) yeni kod
# eklenmez ← bu guard · (3) birleştirme ölçülmüş işlerle (`C5`).
# İki issue taslağının kısıt bölümünde *"modes/ klasörüne dosya eklenmez (E1
# guard)"* yazıyor — o satır guard yazılana kadar bir NİYETTİ.
#
# BU GUARD BÖLMEYİ ÇÖZMEZ. Ölçer ve dondurur. Birleştirme ya da silme kararı
# `C5` ölçümüne bağlı ve üç sonuçtan birine gidiyor; guard üçünde de aynı işi
# yapar: büyümeyi durdurmak, küçülmeyi görünür kılmak.
#
# BASELINE NEDEN LİSTE, NEDEN SAYI DEĞİL
#   zayıf:  101 dosya
#   doğru:  dosya listesi + her birinin satır sayısı
# Sayı-baseline *"biri düştü, biri girdi"* gerilemesini GÖRMEZ — ve bu, bu kod
# tabanında ölçülmüş bir sınıftır (`money-float` ratchet'inin deseni).
#
# KAPSAM DİZİN ADIYLA DEĞİL, ÖLÇÜMLE TANIMLANDI (2026-08-13)
#   `modes` adlı dizin, node_modules hariç tüm repoda:  1  (src/modules/modes)
#   `*actuals-first*` / `*planning-first*` adlı kardeş dizin, bölme dışında: 0
# Yani bölme tek bir ağaç. Ama REFERANS yüzeyi o ağacın dışına taşıyor
# (`app.module.ts`, seed, `master-data.module.ts`) — bu yüzden baseline iki
# tür satır tutar: bölme içi dosyalar (`F`) ve dışarıdan gelen referanslar (`R`).
#
# GUARD_MODE=block   → bulgu varsa exit 1
# GUARD_MODE=report  → bulguları bas, exit 0 (runner çağrısı)
# --baseline         → bugünkü envanteri stdout'a bas (baseline dosyası ÜRETİR)
# --report-count     → yalnız bugünkü sayıyı bas (sprint metriği)
set -uo pipefail

GUARD_NAME="mode-split"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
BASELINE="${MODE_SPLIT_BASELINE:-$ROOT/scripts/guards/mode-split-baseline.txt}"

# Bölme kökü ve referans taranacak kökler — self-test bunları fixture ağacına
# yönlendirir. Üretim yolu ile test yolu AYNI tarama fonksiyonundan geçer
# (ADR 0007 E16: bir kontrolü sınayan test, o kontrolün kopyasını çalıştırmaz).
SPLIT_DIR="${GUARD_SPLIT_DIR:-src/modules/modes}"
REF_ROOTS="${GUARD_SPLIT_REF_ROOTS:-src test}"

cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

if [ ! -d "$SPLIT_DIR" ]; then
  # SKIPPED bir GEÇİŞ DEĞİLDİR. `run-all.sh` kaynak kod guard'ının SKIPPED'ini
  # bir kurulum hatası sayar (SKIPPED_BAD → exit 1) — exit 0'ı güvenli kılan
  # şey bu satır değil, RUNNER'dır. Bu guard başka bir repoya port edilirse o
  # mekanizma da port edilmeli, yoksa exit 0 sessiz bir yeşile döner (T-111).
  echo "-- [$GUARD_NAME] SKIPPED: bölme dizini bulunamadı ($SPLIT_DIR)"
  exit 0
fi

SPLIT_SEG="$(basename "$SPLIT_DIR")"

# ---------------------------------------------------------------- tarama
# Çıktı biçimi (alan ayracı: tek boşluk, üçüncü alan yol):
#   F <satır sayısı> <bölme içi dosya>
#   R <referans satırı sayısı> <bölme dışı dosya>
scan_split() {
  find "$SPLIT_DIR" -type f | LC_ALL=C sort | while IFS= read -r f; do
    printf 'F %s %s\n' "$(wc -l < "$f" | tr -d ' ')" "$f"
  done

  # Bölmeye işaret eden import/require satırları — bölmenin DIŞINDAN.
  # `grep -l` kullanılmıyor: bir dosyayı işaretler ama kaç kez ve nerede
  # eşleştiğini söylemez, ve ratchet tam olarak o sayıya dayanıyor.
  grep -rn --include='*.ts' -E \
    "(from|require\()[[:space:]]*['\"][^'\"]*${SPLIT_SEG}/" $REF_ROOTS 2>/dev/null \
    | grep -v "^${SPLIT_DIR}/" \
    | cut -d: -f1 | LC_ALL=C sort | uniq -c \
    | while read -r n f; do printf 'R %s %s\n' "$n" "$f"; done
}

if [ "${1:-}" = "--baseline" ]; then
  echo "# E1 · modes/ bölmesi envanteri — mode-split.sh --baseline ile üretildi"
  echo "# F <satır> <dosya>   bölme içi"
  echo "# R <referans> <dosya>  bölmeye dışarıdan işaret eden dosya"
  echo "# Bu dosya KENDİNİ YAZMAZ: azalma ölçüldükten SONRA ayrı bir commit'te güncellenir."
  scan_split
  exit 0
fi

CUR="$(mktemp)"; trap 'rm -f "$CUR"' EXIT
scan_split > "$CUR"

if [ "${1:-}" = "--report-count" ]; then
  printf 'bölme: %s dosya · %s satır · %s dış referans dosyası\n' \
    "$(grep -c '^F ' "$CUR" || true)" \
    "$(awk '$1=="F"{s+=$2} END{print s+0}' "$CUR")" \
    "$(grep -c '^R ' "$CUR" || true)"
  exit 0
fi

# Boşluk içeren yol biçimi bozar — sessizce yanlış ölçmektense reddedilir.
if awk '{ if (NF > 3) exit 1 }' "$CUR"; then :; else
  echo "!! [$GUARD_NAME] boşluk içeren yol var — baseline biçimi bunu taşımıyor" >&2
  exit 2
fi

if [ ! -f "$BASELINE" ]; then
  echo "-- [$GUARD_NAME] SKIPPED: baseline bulunamadı ($BASELINE)"
  exit 0
fi

RAW="$(awk '
  NR==FNR {
    if ($1 == "F" || $1 == "R") base[$1 SUBSEP $3] = $2
    next
  }
  {
    k = $1 SUBSEP $3
    if (!(k in base)) {
      if ($1 == "F")
        printf "[%s] %s: YENİ DOSYA — bölmeye yeni kod eklenemez (E1 · A1 md.2)\n", G, $3
      else
        printf "[%s] %s: YENİ REFERANS — bölmeye yeni bağ kurulamaz (E1 · A1 md.2)\n", G, $3
    } else if ($2 + 0 > base[k] + 0) {
      if ($1 == "F")
        printf "[%s] %s: BÜYÜDÜ — %s → %s satır\n", G, $3, base[k], $2
      else
        printf "[%s] %s: REFERANS ARTTI — %s → %s\n", G, $3, base[k], $2
    }
  }
' G="$GUARD_NAME" "$BASELINE" "$CUR")"

report_guard "$RAW"

if [ "$COUNT" -eq 0 ]; then
  echo "-- [$GUARD_NAME] bölme dondurulmuş: $(grep -c '^F ' "$CUR" || true) dosya, baseline'ı aşan yok"
fi

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  echo "!! [$GUARD_NAME] E1 ihlali. Bölme ÖLÜ ilan edildi (A1, 2026-08-12);" >&2
  echo "!! yeni iş bölmenin dışına yazılır. Azalma olduysa baseline'ı AYRI bir" >&2
  echo "!! commit'te güncelle: mode-split.sh --baseline > scripts/guards/mode-split-baseline.txt" >&2
  exit 1
fi
exit 0

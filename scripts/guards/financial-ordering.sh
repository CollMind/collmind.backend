#!/usr/bin/env bash
#
# Guard: financial-ordering  (INV-N-001)
#
# Yakaladığı: finansal bir modülde sıralamanın BİRİNCİL anahtarı bir id alanı
# (`id`, `*Id`, `*_id`). Üretilmiş uuid'ye göre sıralama ortamlar arası keyfi
# sonuç üretir; aynı girdi farklı sırada işlenir.
#
# Nüans (bilinçli):
#   ORDER BY a.id                → bulgu   (birincil anahtar üretilmiş id)
#   ORDER BY createdAt DESC, id  → bulgu değil (id burada tie-breaker)
#   ORDER BY sourceRowNumber     → bulgu değil (iş anahtarı)
# Yalnızca ilk sıralama anahtarına bakılır; `.addOrderBy(` hiç değerlendirilmez.
#
# Ayırt edilemeyen durum bulgu olarak basılır ve triyaja bırakılır — Faz 1'in amacı bu.
#
# ⚠️ KAPSAM SINIRI (Faz 2 review'ında ölçüldü — abartılı iddia yazmamak için burada):
#   1. Kapsam yol bazlı ve yalnız ÜRETİM kodu: 239 üretim dosyasının FIN_RE ile
#      eşleşen 148'i taranır (spec/e2e hariç). "Kod tabanının tamamı" DEĞİLDİR.
#   2. Guard yalnızca TIRNAKLI (literal) sıralama anahtarını görebilir. Değişkenle
#      verilen dinamik anahtar görünmez:
#        query.orderBy(sortField, ...)   → guard bunu değerlendiremez
#      Gerçek örnek: finance-reporting.service.ts:492 — `plan.${pagination.sortBy}`
#      şablonuyla kurulan sortField. Bu bir T-066 işidir ve bu guard onu YAKALAMAZ.
#
# GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
# Allowlist parse hatası        → exit 2 (her iki modda da)
set -uo pipefail

GUARD_NAME="financial-ordering"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

MODULES_DIR="${GUARD_MODULES_DIR:-src/modules}"   # override: self-test.sh
if [ ! -d "$MODULES_DIR" ]; then
  echo "-- [$GUARD_NAME] SKIPPED: src/modules dizini bulunamadı"
  exit 0
fi

# Finansal modül kapsamı.
# Faz 2 review'ında genişletildi: ilk liste `src/modules` altındaki 273 dosyanın
# 132'sini kapsıyordu ve finance-reporting / spend-calculation / kpi-engine
# tamamen dışarıda kalıyordu — yani "kod tabanında 0 bulgu" iddiası kapsamdan
# büyüktü. Yeni terimler: finance, spend, kpi, roi, invoice, claim, actual.
FIN_RE="ledger|budget|agreement|on-invoice|settlement|plan|approval|reversal|sales-actuals|finance|spend|kpi|roi|invoice|claim|actual|report|dashboard|lta"

# Test dosyaları kapsam dışı: INV-N-001 ÜRETİM sıralama yolu hakkındadır. Bir
# spec'teki `orderBy('x.id')` fixture kurulumu olabilir ve bloklayıcı bir guard
# onu build kırıcıya çevirir; tek kaçış yolu allowlist olur ve allowlist son
# çaredir. Üretim kodu kapsamda kalır.
scan() {
  find "$MODULES_DIR" -type f -name "*.ts" \
    -not -name "*.spec.ts" -not -name "*.e2e-spec.ts" \
    | grep -E "$FIN_RE" | sort | while IFS= read -r f; do
    awk -v file="$f" -v guard="$GUARD_NAME" '
      BEGIN { SQ = sprintf("%c", 39); QC = "[" SQ "\"`]" }

      # metindeki ilk tırnaklı dizgiyi döndür (yoksa boş)
      function firstquoted(s,   m) {
        if (match(s, QC "[^" SQ "\"`]*" QC)) {
          m = substr(s, RSTART + 1, RLENGTH - 2)
          return m
        }
        return ""
      }
      # anahtarın son parçası id alanı mı?
      function isidkey(k,   last, n, parts) {
        gsub(/^[ \t]+|[ \t]+$/, "", k)
        sub(/[ \t].*$/, "", k)            # "x.id DESC" → "x.id"
        if (k == "") return 0
        n = split(k, parts, ".")
        last = parts[n]
        return (last ~ /^[A-Za-z_]*(_id|Id)$/ || last == "id" || last == "ID")
      }

      { lines[NR] = $0 }
      END {
        for (i = 1; i <= NR; i++) {
          l = lines[i]
          t = l; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
          if (t ~ /^(\/\/|\*|\/\*)/) continue          # salt-yorum satırı

          key = ""
          if (l ~ /\.orderBy\(/) {
            s = substr(l, index(l, ".orderBy(") + 9)
            key = firstquoted(s)
            # çok satırlı çağrı: ilk tırnaklı dizgi sonraki satırlarda olabilir
            for (j = 1; j <= 3 && key == "" && i + j <= NR; j++) key = firstquoted(lines[i + j])
          } else if (toupper(l) ~ /ORDER BY/) {
            s = substr(toupper(l), index(toupper(l), "ORDER BY") + 8)
            s = substr(l, length(l) - length(s) + 1)   # orijinal harf düzenini koru
            sub(/,.*$/, "", s)                         # yalnız birincil anahtar
            gsub(QC, "", s); gsub(/;/, "", s)
            key = s
          } else continue

          if (key == "") continue
          # anahtarı normalize et: baştaki/sondaki boşluk, kuyruktaki yön/kapanış karakterleri
          gsub(/^[ \t]+|[ \t]+$/, "", key)
          sub(/[ \t].*$/, "", key)
          gsub(/[);]+$/, "", key)
          if (key == "") continue
          if (!isidkey(key)) continue

          printf "[%s] %s:%d\n", guard, file, i
          printf "  finansal sıralamada birincil anahtar id alanı: %s\n", key
          printf "  > %s\n", t
        }
      }
    ' "$f"
  done
}

report_guard "$(scan)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

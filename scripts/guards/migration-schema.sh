#!/usr/bin/env bash
#
# Guard: migration-schema  (INV-M-002)
#
# Yakaladığı: bir migration dosyası pg_constraint / pg_indexes / pg_class /
# pg_tables / information_schema sorgusu yapıyor ama aynı bölgede nspname /
# schemaname / table_schema predicate'i yok. Bu instance hem `main` (CTPM) hem
# `public` (TTM) şemasını barındırdığı için, şema-nitelendirilmemiş bir
# catalogue kontrolü yanlış şemadaki nesneyi görüp migration'ı sessizce no-op
# yapar. Gerçek vaka: 1777000000000-LedgerReversalSupport.
#
# Yöntem: catalogue tablosu geçen her satırın ±10 satırlık penceresinde şema
# predicate'i aranır. Kaba ama yanlış negatif üretmez; yanlış pozitifler
# allowlist.txt'e girer.
#
# GUARD_MODE=report (varsayılan) → bulguları bas, exit 0
# GUARD_MODE=block               → bulgu varsa exit 1
set -uo pipefail

GUARD_NAME="migration-schema"
GUARD_MODE="${GUARD_MODE:-report}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"

MIG_DIR="$(find src -type d -name migrations -not -path "*/node_modules/*" 2>/dev/null | head -1)"
if [ -z "$MIG_DIR" ]; then
  echo "-- [$GUARD_NAME] SKIPPED: migrations dizini bulunamadı"
  exit 0
fi

scan() {
  find "$MIG_DIR" -type f -name "*.ts" | sort | while IFS= read -r f; do
    awk -v file="$f" -v guard="$GUARD_NAME" '
      BEGIN { SQ = sprintf("%c", 39); CAT = "pg_constraint|pg_indexes|pg_class|pg_tables|information_schema" }
      { lines[NR] = $0 }
      END {
        for (i = 1; i <= NR; i++) {
          l = lines[i]
          t = l; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
          if (t ~ /^(\/\/|\*|\/\*)/) continue          # salt-yorum satırı
          if (l !~ CAT) continue
          lo = i - 10; if (lo < 1) lo = 1
          hi = i + 10; if (hi > NR) hi = NR
          ok = 0
          for (j = lo; j <= hi; j++) if (lines[j] ~ /nspname|schemaname|table_schema/) ok = 1
          if (ok) continue
          match(l, CAT); cat = substr(l, RSTART, RLENGTH)
          printf "[%s] %s:%d\n", guard, file, i
          printf "  %s sorgusunda şema predicate" SQ "i yok\n", cat
          printf "  > %s\n", t
        }
      }
    ' "$f"
  done
}

# allowlist filtresi: `<guard>|<dosya>:<satır>|<gerekçe>` — gerekçesiz satır geçersiz
filter_allowlist() {
  awk -v guard="$GUARD_NAME" -v al="$ALLOWLIST" '
    BEGIN {
      while ((getline l < al) > 0) {
        if (l ~ /^[ \t]*#/ || l ~ /^[ \t]*$/) continue
        n = split(l, p, "|")
        if (n < 3) continue
        if (p[3] ~ /^[ \t]*$/) continue
        gsub(/^[ \t]+|[ \t]+$/, "", p[1]); gsub(/^[ \t]+|[ \t]+$/, "", p[2])
        if (p[1] == guard) skip[p[2]] = 1
      }
    }
    /^\[/ { key = $0; sub(/^\[[^]]*\] /, "", key); drop = (key in skip) }
    { if (!drop) print }
  '
}

OUT="$(scan | filter_allowlist)"
[ -n "$OUT" ] && printf "%s\n" "$OUT"
COUNT="$(printf "%s" "$OUT" | grep -c "^\[$GUARD_NAME\]" || true)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

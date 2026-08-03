#!/usr/bin/env bash
#
# Guard: ledger-direction  (INV-L-007)
#
# Yakaladığı: ledger_entries / LedgerEntry bağlamında `amount` üzerinde bir
# toplama var (SUM(, .sum() ama yakınında yön ayrımı yok (CASE, entry_direction,
# entryDirection, DEBIT, CREDIT). Ledger append-only ve iki yönlüdür; yön
# farkındalığı olmayan toplam reversal'ları (CREDIT) harcama sayar.
#
# Kapsam dışı bilinçli: budget_transactions / agreement_transactions /
# sales_actuals üzerindeki SUM(amount) meşrudur — bu tablolarda yön ekseni yok.
# Guard yalnızca ledger bağlamında ateşlenir.
#
# GUARD_MODE=report (varsayılan) → bulguları bas, exit 0
# GUARD_MODE=block               → bulgu varsa exit 1
set -uo pipefail

GUARD_NAME="ledger-direction"
GUARD_MODE="${GUARD_MODE:-report}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"

if [ ! -d src ]; then
  echo "-- [$GUARD_NAME] SKIPPED: src dizini bulunamadı"
  exit 0
fi

scan() {
  # Önce ledger geçen dosyalara daral — tarama maliyetini düşürür, davranışı değiştirmez.
  grep -rlE "ledger_entries|LedgerEntry|ledger\." src --include="*.ts" 2>/dev/null | sort | while IFS= read -r f; do
    awk -v file="$f" -v guard="$GUARD_NAME" '
      BEGIN {
        SUMRE = "SUM[ \t]*\\(|\\.sum\\("
        LEDGERRE = "ledger_entries|LedgerEntry|ledger\\."
        DIRRE = "CASE|entry_direction|entryDirection|DEBIT|CREDIT"
      }
      { lines[NR] = $0 }
      END {
        for (i = 1; i <= NR; i++) {
          l = lines[i]
          t = l; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
          if (t ~ /^(\/\/|\*|\/\*)/) continue          # salt-yorum satırı
          if (l !~ SUMRE) continue
          if (l !~ /amount/ && l !~ /Amount/) continue
          lo = i - 10; if (lo < 1) lo = 1
          hi = i + 10; if (hi > NR) hi = NR
          isledger = 0; hasdir = 0
          for (j = lo; j <= hi; j++) {
            if (lines[j] ~ LEDGERRE) isledger = 1
            if (lines[j] ~ DIRRE)    hasdir = 1
          }
          if (!isledger || hasdir) continue
          printf "[%s] %s:%d\n", guard, file, i
          printf "  ledger amount toplamında yön ayrımı yok (CASE / entryDirection / DEBIT / CREDIT)\n"
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

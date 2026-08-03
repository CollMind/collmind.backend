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
# GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
# Allowlist parse hatası        → exit 2 (her iki modda da)
set -uo pipefail

GUARD_NAME="ledger-direction"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

if [ ! -d src ]; then
  echo "-- [$GUARD_NAME] SKIPPED: src dizini bulunamadı"
  exit 0
fi

scan() {
  # Önce ledger geçen dosyalara daral — tarama maliyetini düşürür, davranışı değiştirmez.
  grep -rlE "ledger_entries|LedgerEntry|ledger\." "${GUARD_SRC_DIR:-src}" --include="*.ts" 2>/dev/null | sort | while IFS= read -r f; do
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

report_guard "$(scan)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

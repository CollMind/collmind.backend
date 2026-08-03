#!/usr/bin/env bash
#
# Guard runner — Faz 1 (RAPOR modu)
#
# Bu fazda hiçbir guard build'i, testi veya commit'i kırmaz: varsayılan davranış
# bulguyu basmak ve exit 0 dönmektir. Gerekçe: ilk koşumda yüzlerce yanlış pozitif
# çıkarsa ekip guard'ları kapatır ve mekanizma ölür. Önce ölçüyoruz, sonra insan
# triyaj ediyor, sonra bloklamaya çeviriyoruz (Faz 2).
#
#   GUARD_MODE=report (varsayılan) → bulguları bas, exit 0
#   GUARD_MODE=block               → bulgu varsa exit 1
set -uo pipefail

GUARD_MODE="${GUARD_MODE:-report}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARDS=(migration-schema ledger-direction financial-ordering schema-isolation)

TOTAL=0
SUMMARY=""

for g in "${GUARDS[@]}"; do
  # Alt guard'ları her zaman report modunda çalıştır; exit kararını runner verir.
  OUT="$(GUARD_MODE=report bash "$DIR/$g.sh")"
  COUNT="$(printf "%s" "$OUT" | grep -c "^\[$g\]" || true)"
  SKIPPED="$(printf "%s" "$OUT" | grep -c "^-- \[$g\] SKIPPED" || true)"

  echo "=== $g ==="
  if [ -n "$OUT" ]; then
    printf "%s\n" "$OUT"
  else
    echo "(bulgu yok)"
  fi
  echo

  if [ "$SKIPPED" -gt 0 ]; then
    SUMMARY="${SUMMARY}  ${g}: SKIPPED\n"
  else
    SUMMARY="${SUMMARY}  ${g}: ${COUNT} bulgu\n"
    TOTAL=$((TOTAL + COUNT))
  fi
done

echo "=== ÖZET (GUARD_MODE=$GUARD_MODE) ==="
printf "%b" "$SUMMARY"
echo "  TOPLAM: $TOTAL bulgu"

if [ "$GUARD_MODE" = "block" ] && [ "$TOTAL" -gt 0 ]; then
  echo "  → GUARD_MODE=block ve bulgu var: exit 1"
  exit 1
fi
exit 0

#!/usr/bin/env bash
#
# Guard runner — Faz 2 (BLOKLAMA modu)
#
# Faz 1'de varsayılan `report` idi: hiçbir guard build'i, testi veya commit'i
# kırmıyordu. Gerekçe, ilk koşumda yüzlerce yanlış pozitif çıkarsa ekibin
# guard'ları tümden kapatmasıydı. Ölçüm yapıldı, ihlaller düzeltildi, allowlist
# insan triyajıyla dolduruldu — artık kapı kapalı.
#
#   GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
#   GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
#   Allowlist parse hatası        → exit 2 (her iki modda da)
#
# CI yok (CLAUDE.md §5: manuel promote, pipeline yok). Çağrı yolları:
#   - `/qa` komutu            → .claude/commands/qa.md
#   - `code-reviewer` ajanı   → .claude/agents/code-reviewer.md
#   - Done checklist'i        → .claude/backlog/BACKLOG.md
set -uo pipefail

GUARD_MODE="${GUARD_MODE:-block}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARDS=(migration-schema ledger-direction financial-ordering schema-isolation)

TOTAL=0
SUMMARY=""

for g in "${GUARDS[@]}"; do
  # Alt guard'ları her zaman report modunda çalıştır; exit kararını runner verir.
  OUT="$(GUARD_MODE=report bash "$DIR/$g.sh")"
  RC=$?

  # exit 2 = allowlist parse hatası. Bu bir yapılandırma hatasıdır, bulgu değil;
  # sessizce yutulamaz — mod ne olursa olsun koşumu durdurur.
  if [ "$RC" -eq 2 ]; then
    echo "=== $g ==="
    echo "!! allowlist parse hatası (detay stderr'de) — guard koşumu durduruldu"
    exit 2
  fi

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

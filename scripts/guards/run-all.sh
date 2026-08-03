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
# Guard listesi lib.sh'teki tek doğruluk kaynağından gelir (S1).
source "$DIR/lib.sh"
# shellcheck disable=SC2206
GUARDS=($GUARD_NAMES_VALID)

TOTAL=0
TOTAL_SUP=0
SKIPPED_OK=0
SKIPPED_BAD=0
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
  SUP="$(printf "%s" "$OUT" | sed -n "s/^-- \[$g\] SUPPRESSED: \([0-9]*\) .*/\1/p")"
  SUP="${SUP:-0}"

  echo "=== $g ==="
  if [ -n "$OUT" ]; then
    printf "%s\n" "$OUT"
  else
    echo "(bulgu yok)"
  fi
  echo

  if [ "$SKIPPED" -gt 0 ]; then
    # SKIPPED "0 bulgu" DEĞİLDİR — "ölçülmedi"dir. Ayrı raporlanır, çünkü
    # `npm run guards` yeşili artık Done kriteri (CLAUDE.md §4.2): Docker
    # kapalıyken "guards yeşil" işaretlenebilmesi sessiz bir boşluk olurdu.
    SUMMARY="${SUMMARY}  ${g}: ÖLÇÜLMEDİ (SKIPPED)\n"
    if [ "$g" = "schema-isolation" ]; then
      # Tek meşru SKIPPED: DB'siz ortamda DB kontrolü yapılamaz.
      SKIPPED_OK=$((SKIPPED_OK + 1))
    else
      # Kaynak kod guard'ı atlanıyorsa bu bir kurulum hatasıdır, mazeret değil.
      SKIPPED_BAD=$((SKIPPED_BAD + 1))
    fi
  else
    LINE="  ${g}: ${COUNT} bulgu"
    [ "$SUP" -gt 0 ] && LINE="${LINE} (${SUP} susturuldu → allowlist)"
    SUMMARY="${SUMMARY}${LINE}\n"
    TOTAL=$((TOTAL + COUNT))
    TOTAL_SUP=$((TOTAL_SUP + SUP))
  fi
done

echo "=== ÖZET (GUARD_MODE=$GUARD_MODE) ==="
printf "%b" "$SUMMARY"
echo "  TOPLAM: $TOTAL bulgu"
[ "$TOTAL_SUP" -gt 0 ] && echo "  SUSTURULAN: $TOTAL_SUP (gerekçeleri: scripts/guards/allowlist.txt)"
[ "$SKIPPED_OK" -gt 0 ] && echo "  ÖLÇÜLMEYEN (DB erişimi yok): $SKIPPED_OK guard"

if [ "$GUARD_MODE" = "block" ]; then
  if [ "$SKIPPED_BAD" -gt 0 ]; then
    echo "  → kaynak kod guard'ı çalıştırılamadı ($SKIPPED_BAD adet): exit 1"
    exit 1
  fi
  if [ "$TOTAL" -gt 0 ]; then
    echo "  → GUARD_MODE=block ve bulgu var: exit 1"
    exit 1
  fi
fi
exit 0

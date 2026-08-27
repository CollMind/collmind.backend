#!/usr/bin/env bash
# Guard: dropped-column-absence  (Z47 · INV-B-009)
#
# ⛔ NİÇİN VAR — "YORUMLA KORUNAN KARAR, KORUNMAYAN KARARDIR."
#
# `Z47` `budget_envelopes.available_amount` kolonunu ÖLDÜRDÜ, çünkü `available`
# bir TÜREVDİR (defterden hesaplanır) ve saklanan kopya KANITLANMIŞ BİÇİMDE
# yalan söylüyordu (4 zarfın 2si ayrık). Kolonun GERİ GELMESİNİ bugüne kadar
# engelleyen tek şey `budget-envelope.entity.ts`deki bir YORUMDU (`Z47` review
# 🟡-5). Bu oturumda "yorumla korunan karar" sınıfı DÖRT KEZ ölçüldü; beşinci
# vakayı beklemeye gerek yok.
#
# ⛔ SÖZLEŞME — kapının ÜÇ MEŞRU ÇIKTISI (ADIM 3 mühür yasası):
#   yeşil (0)  kolon YOK, ölçüldü
#   kırmızı(1) kolon VAR — karar geri alınmış, ve bunu Z-kaydı olmadan
#              yapmak `Z47`i sessizce çürütmek olur
#   ölçemedim(2) DBye ulaşılamadı / şema yok — SESSİZ YEŞİL DEĞİL
#
# Evren TÜRETİLMİŞ: `information_schema`dan okunur, elle liste YOKTUR.
# Yasak-liste ise KARARIN KENDİSİDİR (Z-kaydına bağlı) — bu bir istisna
# listesi değil, bir HÜKÜM listesidir; büyümesi bir karar gerektirir.
set -uo pipefail

GUARD_NAME="dropped-column-absence"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

# <şema>|<tablo>|<kolon>|<karar kaydı>   — HER SATIR BİR Z-KAYDINA BAĞLIDIR
DROPPED=(
  "main|budget_envelopes|available_amount|Z47 (INV-B-009): available SAKLANMAZ, defterden türetilir"
)

DB_QUERY_CMD="${DROPPED_COL_DB_QUERY:-}"
db_query() {
  if [ -n "$DB_QUERY_CMD" ]; then
    eval "$DB_QUERY_CMD" "$(printf '%q' "$1")"
  else
    docker exec -i collmind-tpm-postgres \
      psql -U postgres -d collmind_tpm -t -A -c "$1" 2>/dev/null
  fi
}

# Ölçüm ortamı canlı mı — "sıfır satır" ile "ulaşamadım" AYRI sinyaller.
PROBE="$(db_query "SELECT 1 FROM information_schema.schemata WHERE schema_name='main';")"
RC=$?
if [ "$RC" -ne 0 ] || [ -z "$PROBE" ]; then
  echo "!! [$GUARD_NAME] DB SORGUSU BAŞARISIZ ya da 'main' şeması YOK — ölçüm yapılamadı (docker kapalı olabilir), exit 2" >&2
  exit 2
fi

VIOL=0
for row in "${DROPPED[@]}"; do
  IFS='|' read -r sch tbl col why <<< "$row"
  FOUND="$(db_query "SELECT 1 FROM information_schema.columns WHERE table_schema='$sch' AND table_name='$tbl' AND column_name='$col';")"
  if [ -n "$FOUND" ]; then
    echo "!! [$GUARD_NAME] GERİ GELMİŞ KOLON: $sch.$tbl.$col"
    echo "!!   karar: $why"
    echo "!!   Bu kolon bir KARARLA düşürüldü. Geri getirmek o kararı çürütmektir"
    echo "!!   ve bir Z-KAYDI ister — sessiz bir migration DEĞİL."
    VIOL=$((VIOL+1))
  fi
done

echo "=== [$GUARD_NAME] düşürülmüş kolonlar ==="
echo "  izlenen: ${#DROPPED[@]} · geri gelmiş: $VIOL"
[ "$VIOL" -eq 0 ] && echo "  ✅ hepsi düşük"

if [ "$GUARD_MODE" = "block" ] && [ "$VIOL" -gt 0 ]; then exit 1; fi
exit 0

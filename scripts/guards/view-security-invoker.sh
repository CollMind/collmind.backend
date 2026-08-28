#!/usr/bin/env bash
#
# Guard: view-security-invoker (T-308 / Z45 §1, `G8` ailesi)
#
# Yakaladığı SINIF: `main` şemasında `security_invoker = true` reloption'ı
# TAŞIMAYAN bir view. Böyle bir view, altındaki tablolara RLS politikası
# yazılsa bile onları SAHİBİNİN hakkıyla okur ve politikayı ATLAR — kapılar
# yeşil kalırken sızıntı canlı olur (bkz. `1813000000000-...ts` migration
# başlığı, `T-308` task dosyası).
#
# Evren `pg_class`/`pg_namespace`'TEN TÜRETİLİR — elle bir view listesi
# YASAK (bu yüzden yeni bir view eklendiğinde guard onu OTOMATİK görür).
#
# DB'ye ulaşılamıyorsa (docker kapalı, container yok, bağlantı hatası) bu
# guard SKIPPED/exit 0 DEMEZ — `exit 2` döner ("ölçemedim" ≠ "temiz"; bkz.
# T-308 AC). `schema-isolation.sh`'ın DB-erişim desenini yeniden kullanır,
# ama exit-kod sözleşmesi kasıtlı olarak FARKLIDIR: schema-isolation kendi
# konusu (iki şemalı DB) için DB'nin OLMAMASINI meşru bir geliştirme hâli
# sayar; bu guard'ın konusu (RLS bypass riski) DB ölçülmeden asla "temiz"
# diye raporlanamaz.
#
# GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için) — 2 hariç
# Allowlist parse hatası         → exit 2
# DB'ye ulaşılamadı              → exit 2
#
# Test/self-test için DB sorgu katmanı VIEW_GUARD_DB_QUERY ile override
# edilebilir (bkz. view-security-invoker-self-test.sh) — gerçek docker'a
# dokunmadan dört senaryoyu (boş envanter, temiz, ihlal, DB-erişilemez) sınar.
set -uo pipefail

GUARD_NAME="view-security-invoker"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

# db_query <sql> — stdout'a `-t -A` (tuple-only, unaligned) çıktı basar.
# Dönüş kodu ÖLÇÜMÜN GÜVENİLİRLİĞİNİN tek kaynağıdır: sıfırdan farklıysa
# "DB'ye ulaşılamadı", boş stdout ise "gerçekten sıfır satır" anlamına gelir
# — ikisi ayrı sinyaldir, biri diğerine sessizce düşemez.
#
# ⛔ K1a / Z52 §4 — ÖNCEDEN bu fonksiyon her iki dalda da (bir `$DB_QUERY`
# varlık kontrolü VARDI ama gövdede `$DB_QUERY` HİÇ ÇAĞRILMIYORDU) doğrudan
# `docker exec ... -U postgres` çalıştırıyordu (`§2.7` sınıfı — kontrol var,
# mekanizma ölü; `scripts/db-query.sh` yalnızca `-c` alır, `-t -A` bayrağını
# taşımadığı için buradaki tuple-only/unaligned sözleşmeyi karşılayamıyor —
# bu yüzden bu guard sarmalayıcıyı ÇAĞIRAMAZ, kendi bağlantısını kurar).
# Düzeltilen tek şey ROL: `-U postgres` → `-U app_operator` — insan-yolu
# artık superuser DEĞİL.
db_query() {
  local sql="$1"
  if [ -n "${VIEW_GUARD_DB_QUERY:-}" ] && [ -x "$VIEW_GUARD_DB_QUERY" ]; then
    "$VIEW_GUARD_DB_QUERY" "$sql"
    return $?
  fi
  docker exec -i collmind-tpm-postgres psql -U app_operator -d collmind_tpm \
    -v ON_ERROR_STOP=1 -t -A -c "$sql" 2>/dev/null
  return $?
}

SQL="SELECT c.relname || '|' || COALESCE(array_to_string(c.reloptions, ','), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'main' AND c.relkind = 'v' ORDER BY c.relname;"

if ! ROWS="$(db_query "$SQL")"; then
  echo "!! [$GUARD_NAME] DB SORGUSU BAŞARISIZ — ölçüm yapılamadı (docker kapalı olabilir), exit 2" >&2
  exit 2
fi

scan() {
  local line relname reloptions
  [ -z "$ROWS" ] && return 0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    relname="${line%%|*}"
    reloptions="${line#*|}"
    if [[ "$reloptions" != *"security_invoker=true"* ]]; then
      echo "[$GUARD_NAME] main.${relname}"
      echo "  security_invoker=true YOK — RLS politikaları bu view üzerinden ATLANABİLİR"
    fi
  done <<< "$ROWS"
}

report_guard "$(scan)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

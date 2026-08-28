#!/usr/bin/env bash
#
# Guard: bypassrls-hygiene  (EK 1/a, Z53 §4a)
#
# ⛔ DOĞUM GEREKÇESİ (Z51 §2) — `app_runtime` canlıda elle `ALTER ROLE ...
# SET log_statement='all'` almıştı ve bu sapma HİÇBİR KAPI görmedi (repo
# genelinde sıfır script/kod referansı). O sapma `log_statement` idi;
# `BYPASSRLS`/`SUPERUSER` aynı sınıftan ama çok daha tehlikeli bir rol
# bayrağıdır — biri elle bir role bu bayrağı verirse, o rol RLS
# politikalarının (K1 sonrası paket) TAMAMINI atlar. Bu guard o boşluğu
# kapatır.
#
# Evren `pg_roles`'TAN TÜRETİLİR (elle bir rol listesi YOK) — yeni bir rol
# yaratılıp BYPASSRLS/SUPERUSER verildiğinde guard onu OTOMATİK görür.
#
# --- KAYITLI İSTİSNALAR (KARAR, envanter DEĞİL — büyümesi bir Z-kaydı ister) -
#
#   postgres       SUPERUSER   — postgres:16 image'ının bootstrap rolü;
#                                Z52 §4: "BOOTSTRAP superuser, TANIM GEREĞİ
#                                DIŞINDA" (rol/şema kurulumu, migration
#                                zinciri — insan-yolu DEĞİL)
#   app_operator   BYPASSRLS   — K1a (Z52 §3/§4), "insan-yolu"nun RLS'i
#                                atlayarak okuyabilmesi TANIMI GEREĞİ
#                                operatör-yetkisi (Z51 kayıtlı istisna)
#
# --- ÜÇ MEŞRU ÇIKTI (mühür yasası) -------------------------------------------
#
#   temiz (0)     BYPASSRLS/SUPERUSER taşıyan HER rol kayıtlı listede
#   ihlal (1)     kayıtsız bir rol BYPASSRLS/SUPERUSER taşıyor (app_runtime
#                 dahil — runtime rolü HİÇBİR ZAMAN listede DEĞİL)
#   ölçemedim (2) DB'ye ulaşılamadı — SESSİZ YEŞİL DEĞİL
#
# GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
# Allowlist parse hatası        → exit 2
# DB'ye ulaşılamadı             → exit 2
#
# Test/self-test: BYPASSRLS_GUARD_DB_QUERY env override (view-security-
# invoker'ın deseniyle aynı aile) — mutasyonla kanıtlanır
# (bypassrls-hygiene-self-test.sh, CASE C/D pozitif kontrol).
set -uo pipefail

GUARD_NAME="bypassrls-hygiene"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

# <rol>|<beklenen bayrak>  — KARAR listesi, bkz. başlık.
REGISTERED=(
  "postgres|SUPERUSER"
  # PostgreSQL: bir SUPERUSER'ın rolbypassrls sütunu da her zaman `t`'dir
  # (superuser zaten her politikayı atlar) — bu yüzden postgres HER İKİ
  # bayrak için de kayıtlı, aksi hâlde yalnız SUPERUSER kaydı guard'ı
  # kendi bootstrap rolüne karşı YANLIŞ POZİTİF üretirdi (ölçüldü).
  "postgres|BYPASSRLS"
  "app_operator|BYPASSRLS"
)

db_query() {
  local sql="$1"
  if [ -n "${BYPASSRLS_GUARD_DB_QUERY:-}" ] && [ -x "$BYPASSRLS_GUARD_DB_QUERY" ]; then
    "$BYPASSRLS_GUARD_DB_QUERY" "$sql"
    return $?
  fi
  docker exec -i collmind-tpm-postgres psql -U app_operator -d collmind_tpm \
    -v ON_ERROR_STOP=1 -t -A -c "$sql" 2>/dev/null
  return $?
}

SQL="SELECT rolname || '|' || rolbypassrls || '|' || rolsuper FROM pg_roles WHERE rolbypassrls OR rolsuper ORDER BY 1;"

if ! ROWS="$(db_query "$SQL")"; then
  echo "!! [$GUARD_NAME] DB SORGUSU BAŞARISIZ — ölçüm yapılamadı (docker kapalı olabilir), exit 2" >&2
  exit 2
fi

is_registered() {
  local rol="$1" flag="$2" entry r f
  for entry in "${REGISTERED[@]}"; do
    IFS='|' read -r r f <<< "$entry"
    if [ "$r" = "$rol" ] && [ "$f" = "$flag" ]; then
      return 0
    fi
  done
  return 1
}

scan() {
  local line rol bypassrls super
  [ -z "$ROWS" ] && return 0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    rol="${line%%|*}"
    rest="${line#*|}"
    bypassrls="${rest%%|*}"
    super="${rest#*|}"
    if [ "$super" = "t" ] || [ "$super" = "true" ]; then
      if ! is_registered "$rol" "SUPERUSER"; then
        echo "[$GUARD_NAME] role:$rol:SUPERUSER"
        echo "  kayıtsız SUPERUSER rolü — kurulum betiğinden üretilemeyen bir canlı sapma olabilir"
      fi
    fi
    if [ "$bypassrls" = "t" ] || [ "$bypassrls" = "true" ]; then
      if ! is_registered "$rol" "BYPASSRLS"; then
        echo "[$GUARD_NAME] role:$rol:BYPASSRLS"
        echo "  kayıtsız BYPASSRLS rolü — bu rol TÜM RLS politikalarını atlayabilir (Z51 §2 sınıfı)"
      fi
    fi
  done <<< "$ROWS"
}

report_guard "$(scan)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

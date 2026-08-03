#!/usr/bin/env bash
#
# Guard: schema-isolation  (INV-M-003)
#
# Diğer guard'lardan farklı: kaynak kod değil, veritabanı kontrolü.
#
# Yakaladığı: aynı veritabanında hem `main` (CTPM) hem `public` (TTM) şeması var
# ve ikisinde de bir `migrations` tablosu bulunuyor. Bu durumda şema-
# nitelendirilmemiş her catalogue guard'ı şema sınırını aşar ve yanlış ürünün
# geçmişini/nesnesini görür.
#
# DB erişilemiyorsa SKIPPED basar ve exit 0 döner — DB'siz ortamda başarısız
# olmak yanlış olur.
#
# GUARD_MODE=report (varsayılan) → bulguları bas, exit 0
# GUARD_MODE=block               → bulgu varsa exit 1
set -uo pipefail

GUARD_NAME="schema-isolation"
GUARD_MODE="${GUARD_MODE:-report}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"

# scripts/db-query.sh meta-repo kökündedir; backend bir submodule.
DB_QUERY="$ROOT/../scripts/db-query.sh"

db_query() {
  if [ -x "$DB_QUERY" ]; then
    bash "$DB_QUERY" "$1" 2>/dev/null
  else
    # Sarmalayıcı bulunamadı — docker exec'i doğrudan kullan (rapora yazılır).
    docker exec -i collmind-tpm-postgres psql -U postgres -d collmind_tpm \
      -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null
  fi
}

NS="$(db_query "SELECT nspname FROM pg_namespace WHERE nspname IN ('main','public');")" || NS=""
if [ -z "$NS" ]; then
  echo "-- [$GUARD_NAME] SKIPPED: veritabanına erişilemedi (DB kapalı veya sarmalayıcı yok)"
  exit 0
fi

HAS_MAIN="$(printf "%s" "$NS" | grep -cw "main" || true)"
HAS_PUBLIC="$(printf "%s" "$NS" | grep -cw "public" || true)"

MIG="$(db_query "SELECT table_schema FROM information_schema.tables WHERE table_name = 'migrations' AND table_schema IN ('main','public');")" || MIG=""
MIG_MAIN="$(printf "%s" "$MIG" | grep -cw "main" || true)"
MIG_PUBLIC="$(printf "%s" "$MIG" | grep -cw "public" || true)"

scan() {
  if [ "$HAS_MAIN" -gt 0 ] && [ "$HAS_PUBLIC" -gt 0 ] && [ "$MIG_MAIN" -gt 0 ] && [ "$MIG_PUBLIC" -gt 0 ]; then
    echo "[$GUARD_NAME] db:collmind_tpm"
    echo "  aynı veritabanında iki ürün şeması var ve ikisinde de migrations tablosu bulunuyor (main + public)"
    echo "  > şema-nitelendirilmemiş her catalogue guard'ı şema sınırını aşar"
  fi
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

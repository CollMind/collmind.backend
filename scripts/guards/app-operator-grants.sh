#!/usr/bin/env bash
#
# Guard: app-operator-grants  (T-314/A, K1a review S5, Z51 §2 kardeşi)
#
# ⛔ NİÇİN VAR — `app_runtime`'da bir kez olan şey (Z51 §2, kayıtsız
# `ALTER ROLE ... SET log_statement='all'`) `app_operator`'de TEKRAR olabilir
# ve HİÇBİR KAPI görmez. `app-runtime-grants.sh` runtime rolü için
# "kod-A \ grant-B = ∅" kontrolünü yapıyor; `app_operator`'ün eşleniği
# YOKTU. Bu guard onu kapatıyor.
#
# --- ŞEKİL: app-runtime-grants'tan FARKLI yön --------------------------------
#
# app-runtime-grants "kod ihtiyaç duyuyor ama GRANT yok" (eksik ayrıcalık,
# 500 riski) sınıfını yakalar. Bu guard TERS yönü yakalar: "CANLI DB'de
# app_operator'ün bir ayrıcalığı VAR ama `03-operator-grants.sql`
# (TEK DOĞRULUK KAYNAĞI, dosyanın kendi başlığı) onu HİÇ deklare ETMİYOR" —
# yani birinin elle `GRANT INSERT/UPDATE/... TO app_operator` çalıştırmış
# olması ihtimali. Kurulum betiğinden ÜRETİLEMEZ bir canlı sapma.
#
# kaynak A (CANLI)   information_schema.role_table_grants — grantee=
#                     app_operator, table_schema=main, privilege_type != SELECT
#                     (SELECT bilinçli hariç: dosya ZATEN "ALL TABLES IN
#                     SCHEMA" ile BROAD veriyor — her tabloda SELECT olması
#                     BEKLENEN durumdur, drift değil)
# kaynak B (DEKLARE)  03-operator-grants.sql'deki `GRANT DELETE ON
#                     :"schema".<tablo> TO app_operator;` satırlarından
#                     statik olarak türetilir (TEK privilege tipi DELETE'tir
#                     — dosyanın bugünkü hâli SELECT dışında yalnız DELETE
#                     veriyor)
# kontrol             A \ B = ∅  (canlıda olup dosyada olmayan her
#                     (tablo, privilege) çifti bir DRIFT bulgusudur)
#
# ⚠️ BYPASSRLS/SUPERUSER gibi ROL ÖZNİTELİKLERİ bu guard'ın kapsamı DIŞI —
# onu `bypassrls-hygiene.sh` (EK 1/a, Z53 §4a) ayrı ölçer. Bu guard yalnız
# TABLO ayrıcalıklarını (GRANT/REVOKE) ölçer.
#
# GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
# Allowlist parse hatası        → exit 2
# DB'ye ulaşılamadı / kaynak B boş türetildi → exit 2 ("ölçemedim" ≠ "temiz")
#
# Test/self-test için: APP_OP_GRANTS_DB_QUERY (DB sorgu katmanı override) ve
# APP_OP_GRANTS_SQL (03-operator-grants.sql yolu override) — view-security-
# invoker'ın env-override deseniyle aynı aile.
set -uo pipefail

GUARD_NAME="app-operator-grants"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

GRANTS_SQL="${APP_OP_GRANTS_SQL:-$ROOT/scripts/db-roles/03-operator-grants.sql}"
if [ ! -f "$GRANTS_SQL" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: $GRANTS_SQL bulunamadı — ölçüm YAPILMADI" >&2
  exit 2
fi

db_query() {
  local sql="$1"
  if [ -n "${APP_OP_GRANTS_DB_QUERY:-}" ] && [ -x "$APP_OP_GRANTS_DB_QUERY" ]; then
    "$APP_OP_GRANTS_DB_QUERY" "$sql"
    return $?
  fi
  docker exec -i collmind-tpm-postgres psql -U app_operator -d collmind_tpm \
    -v ON_ERROR_STOP=1 -t -A -c "$sql" 2>/dev/null
  return $?
}

# --- kaynak B: deklare edilen DELETE tabloları (statik parse) ---------------
# Desen: `GRANT DELETE ON :"schema".<tablo> TO app_operator;`
DECLARED="$(grep -E '^GRANT DELETE ON :"schema"\.' "$GRANTS_SQL" \
  | sed -E 's/^GRANT DELETE ON :"schema"\.([a-z_]+) TO app_operator;.*/\1/' \
  | sort -u)"

if [ -z "$DECLARED" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: $GRANTS_SQL ayrıştırılamadı (0 deklare edilmiş DELETE satırı) — ölçüm YAPILMADI" >&2
  echo "!! (dosyanın deseni değişmiş olabilir: 'GRANT DELETE ON :\"schema\".<tablo> TO app_operator;')" >&2
  exit 2
fi

# --- kaynak A: canlı ayrıcalıklar (SELECT hariç) -----------------------------
if ! ROWS="$(db_query "SELECT table_name || '|' || privilege_type FROM information_schema.role_table_grants WHERE grantee='app_operator' AND table_schema='main' AND privilege_type != 'SELECT' ORDER BY 1;")"; then
  echo "!! [$GUARD_NAME] DB SORGUSU BAŞARISIZ — ölçüm yapılamadı (docker kapalı olabilir), exit 2" >&2
  exit 2
fi

scan() {
  local line tbl priv declared_hit
  [ -z "$ROWS" ] && return 0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    tbl="${line%%|*}"
    priv="${line#*|}"
    declared_hit=0
    if [ "$priv" = "DELETE" ] && printf '%s\n' "$DECLARED" | grep -qx "$tbl"; then
      declared_hit=1
    fi
    if [ "$declared_hit" -eq 0 ]; then
      echo "[$GUARD_NAME] main.${tbl}:${priv}"
      echo "  app_operator canlıda bu ayrıcalığa sahip ama $GRANTS_SQL bunu DEKLARE ETMİYOR"
      echo "  > kayıtsız canlı GRANT sapması (Z51 §2 sınıfının tekrarı, yeni rolde)"
    fi
  done <<< "$ROWS"
}

report_guard "$(scan)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

#!/usr/bin/env bash
#
# Guard: new-table-rls  (EK 1/b, Z53 §4b, sözleşmesi Z54 §3 ile GÜNCELLENDİ)
#
# ⛔ SÖZLEŞME (Z54 §3, bu turda YAZILDI):
#   "tenant_id taşıyan bir tablo, ENABLE + FORCE ÇİFTİ OLMADAN DOĞAMAZ."
#
# --- STATÜ: T-308 deseni — "kapı doğar ama BLOCKED durur" -------------------
#
# `Z51`'de ölçüldü: main şemasındaki 44 tenant_id-taşıyan tablonun 44'ü de
# BUGÜN `relrowsecurity=false` (RLS hiç etkin değil — FORCE bir yana). Bu
# guard'ı çıplak "her tenant tablosu RLS-etkin olmalı" diye yazmak `npm run
# guards`'ı BUGÜNDEN kırardı — money-float/lint-ratchet'in "big-bang or
# never" tuzağının aynısı (run-all.sh:65-88).
#
# Çözüm AYNI AİLE: `new-table-rls-baseline.txt` bugünün 44 tablosunu KAYITLI
# BORÇ olarak TOLERE eder (bulgu üretmez). Ama listede OLMAYAN (yeni doğan)
# bir tenant_id tablosu ENABLE+FORCE çifti olmadan görülürse — KIRMIZI.
# Yani kapı BUGÜN DOĞUYOR ve HEMEN ÇALIŞIYOR, ama yalnız GELECEĞİ korur;
# geçmiş RLS-AKTİVASYON dalgasının (Z54 §3) işi.
#
# AÇILMA KOŞULU baseline dosyasının kendi başlığında yazılı: bir migration
# bir tabloyu ENABLE+FORCE'a taşıdığında o tablo baseline'dan ÇIKARILIR.
#
# Evren `information_schema.columns` (tenant_id kolonu) ∩ `pg_class`
# (relkind='r', main şeması) — TÜRETİLMİŞ, elle bir tablo listesi YOK (view'lar
# hariç: `ALTER ... ENABLE ROW LEVEL SECURITY` view'a uygulanamaz, o riski
# `view-security-invoker.sh` ayrı ölçer).
#
# GUARD_MODE=block (varsayılan) → baseline-dışı bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
# Allowlist parse hatası        → exit 2
# DB'ye ulaşılamadı             → exit 2 ("ölçemedim" ≠ "temiz")
#
# Test/self-test: NEW_TABLE_RLS_DB_QUERY + NEW_TABLE_RLS_BASELINE env
# override — view-security-invoker'ın deseniyle aynı aile.
set -uo pipefail

GUARD_NAME="new-table-rls"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

BASELINE="${NEW_TABLE_RLS_BASELINE:-$ROOT/scripts/guards/new-table-rls-baseline.txt}"
if [ ! -f "$BASELINE" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: baseline dosyası bulunamadı ($BASELINE) — ölçüm YAPILMADI" >&2
  exit 2
fi

db_query() {
  local sql="$1"
  if [ -n "${NEW_TABLE_RLS_DB_QUERY:-}" ] && [ -x "$NEW_TABLE_RLS_DB_QUERY" ]; then
    "$NEW_TABLE_RLS_DB_QUERY" "$sql"
    return $?
  fi
  docker exec -i collmind-tpm-postgres psql -U app_operator -d collmind_tpm \
    -v ON_ERROR_STOP=1 -t -A -c "$sql" 2>/dev/null
  return $?
}

# ⛔ EVREN FİLTRELENMEYEN KATALOGDAN (review B3, 2026-08-28) — `K1a` review
# `B3` DERSİNİN TEKRARIYDI: `information_schema.columns` YETKİ FİLTRELER.
#   ÖLÇÜLDÜ:  app_operator gözüyle 44  ·  app_runtime gözüyle 38  (ALTI TABLO
#             KAYBOLUYOR)  ·  pg_attribute (filtresiz) 44
# Bugün `44 = 44` çünkü app_operator geniş; ama YÖN FAIL-OPEN: bir tablonun
# SELECT'i kısıldığı an o tablo EVRENDEN DÜŞER, RLS'i hiç sorgulanmaz, guard
# YEŞİL kalır — ve baseline'da olmadığı için "yeni tablo" olarak da yakalanmaz.
# ⛔ EN KÖTÜSÜ ZAMANLAMASI: evreni daraltan işlem TAM OLARAK RLS-aktivasyon
#   dalgasının yapacağı şeydir (GRANT/REVOKE düzenlemesi) ⇒ kapı EN ÇOK
#   GEREKTİĞİ ANDA körleşirdi.
SQL="SELECT c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'main'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
  AND NOT a.attisdropped
WHERE c.relkind = 'r'
ORDER BY 1;"

if ! ROWS="$(db_query "$SQL")"; then
  echo "!! [$GUARD_NAME] DB SORGUSU BAŞARISIZ — ölçüm yapılamadı (docker kapalı olabilir), exit 2" >&2
  exit 2
fi
# ⛔ CANLILIK PROBU ASIL KONTROLÜN YÜZEYİNDE (review S1 + K1a B3 dersi):
# BOŞ küme "temiz" DEĞİLDİR. `main` şemasında `tenant_id` taşıyan tablo
# olmaması bu üründe İMKÂNSIZDIR (bugün 44) — boşluk ⇒ ÖLÇÜM YAPILMADI.
if [ -z "$ROWS" ]; then
  echo "!! [$GUARD_NAME] EVREN BOŞ: main şemasında tenant_id taşıyan tablo bulunamadı." >&2
  echo "!!   Bu üründe İMKÂNSIZDIR (baseline $(grep -vc '^#' "$BASELINE" 2>/dev/null || echo '?') tablo sayıyor)." >&2
  echo "!!   ⇒ 'temiz' DEĞİL, ÖLÇÜM YAPILMADI. exit 2" >&2
  exit 2
fi

in_baseline() {
  local tbl="$1"
  grep -qx "$tbl" "$BASELINE" 2>/dev/null
}

scan() {
  local line tbl enable force
  [ -z "$ROWS" ] && return 0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    tbl="${line%%|*}"
    rest="${line#*|}"
    enable="${rest%%|*}"
    force="${rest#*|}"
    if [ "$enable" = "t" ] && [ "$force" = "t" ]; then
      continue
    fi
    if in_baseline "$tbl"; then
      continue
    fi
    echo "[$GUARD_NAME] main.${tbl}"
    echo "  tenant_id taşıyan bu tablo ENABLE+FORCE ROW LEVEL SECURITY çiftine sahip DEĞİL"
    echo "  > Z54: \"tenant_id taşıyan tablo ENABLE + FORCE ÇİFTİ OLMADAN DOĞAMAZ\" — baseline'da da yok, YENİ bir tablo/regresyon"
  done <<< "$ROWS"
}

report_guard "$(scan)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

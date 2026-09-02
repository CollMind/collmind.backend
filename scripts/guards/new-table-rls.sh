#!/usr/bin/env bash
#
# Guard: new-table-rls  (EK 1/b, Z53 §4b, sözleşmesi Z85 ile İKİ KADEMEYE AYRILDI)
#
# ⛔ SÖZLEŞME (Z85, bu turda YAZILDI — Z54 §3'ün YERİNE geçer):
#
#   KADEME 1 (BUGÜN AKTİF, TÜM tenant_id-taşıyan tablolar için):
#     "tenant_id taşıyan bir tablo, GERÇEK/FAIL-CLOSED bir RLS politikası
#      TANIMLANMADAN doğamaz." Politika var olmak ZORUNDA — ENABLE/FORCE
#      henüz açık olmasa bile (politika RLS kapalıyken İNERTTİR, zarasız).
#      `USING (true)` gibi bir yer-tutucu bu şartı KARŞILAMAZ — o "tanımsız"
#      ile aynı sınıftır (fail-open, gerçek izolasyon YOK).
#
#   KADEME 2 (BLOCKED → RLS-AKTİVASYON DALGASI, Z54 §3):
#     "ENABLE + FORCE ÇİFTİ." Bu ikisini BUGÜN açmak — SET LOCAL taşıyıcı
#     (Z50) henüz YOK olduğu için — table owner (`app_migrate`) dahil HERKESİ
#     dışlar (Postgres varsayılanı: politika var ama bağlam boşsa satır
#     GÖRÜNMEZ) ve ilk INSERT'i canlı bir kilide çevirir. ⇒ Bu guard KADEME
#     2'yi bugün BLOKLAMAZ — yalnız DURUMUNU raporlar (aşağıdaki bilgi
#     satırı). Aktivasyon günü: SET LOCAL taşıyıcı + ENABLE+FORCE TEK
#     ANAHTARLA birlikte açılır; o gün KADEME 2 de bu guard'a AKTİF eklenir.
#
# --- STATÜ: T-308 deseni — "kapı doğar ama [kademe] BLOCKED durur" ----------
#
# `Z51`'de ölçüldü: main şemasındaki 44 tenant_id-taşıyan tablonun 44'ü de
# BUGÜN `relrowsecurity=false` VE politikasız (KADEME 1 de KADEME 2 de borç).
# Bu guard'ı çıplak "her tenant tablosu RLS-etkin/politikalı olmalı" diye
# yazmak `npm run guards`'ı BUGÜNDEN kırardı — money-float/lint-ratchet'in
# "big-bang or never" tuzağının aynısı (run-all.sh:65-88).
#
# Çözüm AYNI AİLE: `new-table-rls-baseline.txt` bugünün 44 tablosunu KAYITLI
# BORÇ olarak TOLERE eder (bulgu üretmez — ne KADEME 1 ne KADEME 2 için).
# Ama listede OLMAYAN (yeni doğan) bir tenant_id tablosu GERÇEK bir politika
# olmadan görülürse — KIRMIZI (KADEME 1). Yani kapı BUGÜN DOĞUYOR ve HEMEN
# ÇALIŞIYOR, ama yalnız KADEME 1'i bloklar; KADEME 2 (ENABLE+FORCE) geçmiş
# VE gelecek tüm tablolar için RLS-AKTİVASYON dalgasının işi.
#
# AÇILMA KOŞULU baseline dosyasının kendi başlığında yazılı: bir migration
# bir tabloyu GERÇEK politikaya taşıdığında o tablo baseline'dan ÇIKARILIR
# (KADEME 1 borcu kapanır); ENABLE+FORCE'a taşıdığında KADEME 2 bu guard'a
# eklendiğinde ayrıca değerlendirilir (bugün için N/A).
#
# ⛔ ÖLÇÜLMÜŞ KUSUR (bu turda düzeltildi — TL doğruladı): `c.relrowsecurity`
# gibi bir `boolean` kolonu `||` ile TEXT'e concat edildiğinde Postgres onu
# `'true'`/`'false'` yazar, `'t'`/`'f'` DEĞİL (`SELECT true || ''` → `'true'`).
# Guard'ın bash karşılaştırması `[ "$enable" = "t" ]` bekliyordu ⇒ HER SATIR
# ihlal sayılıyordu (`Z51`'in doğduğu turdan beri, RLS açık tablo 2/50 —
# ikisi de o turda doğdu, yani kusur bugüne kadar hiç TETİKLENMEDİ). Düzeltme:
# SQL tarafında TEK TEMSİLE indir (`CASE WHEN ... THEN 't' ELSE 'f' END`).
#
# Evren `pg_attribute` (tenant_id kolonu, filtresiz katalog) ∩ `pg_class`
# (relkind='r', main şeması) — TÜRETİLMİŞ, elle bir tablo listesi YOK (view'lar
# hariç: `ALTER ... ENABLE ROW LEVEL SECURITY` view'a uygulanamaz, o riski
# `view-security-invoker.sh` ayrı ölçer).
#
# GUARD_MODE=block (varsayılan) → baseline-dışı KADEME 1 bulgusu varsa exit 1
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
#
# ⛔ BOOLEAN → TEXT: `CASE WHEN ... THEN 't' ELSE 'f' END` — `||` implicit
# cast'in `'true'/'false'` ürettiği kusuru KÖKTEN kapatır (bkz. yukarı).
#
# KADEME 1 sütunu (`real_policy`): main.<tablo> üzerinde EN AZ BİR politika
# var VE o politikanın `qual`'ı (USING ifadesi) tam olarak `'true'` metnine
# EŞİT DEĞİL. `USING (true)` / politikasız → 'f'. Gerçek (fail-closed veya en
# azından koşullu) bir politika → 't'.
SQL="SELECT c.relname
  || '|' || (CASE WHEN c.relrowsecurity THEN 't' ELSE 'f' END)
  || '|' || (CASE WHEN c.relforcerowsecurity THEN 't' ELSE 'f' END)
  || '|' || (CASE WHEN EXISTS (
       SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'main' AND p.tablename = c.relname
         AND p.qual IS DISTINCT FROM 'true'
     ) THEN 't' ELSE 'f' END)
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
# olmaması bu üründe İMKÂNSIZDIR (bugün 44+) — boşluk ⇒ ÖLÇÜM YAPILMADI.
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
  local line tbl enable force real_policy rest
  [ -z "$ROWS" ] && return 0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    tbl="${line%%|*}"
    rest="${line#*|}"
    enable="${rest%%|*}"
    rest="${rest#*|}"
    force="${rest%%|*}"
    real_policy="${rest#*|}"

    if [ "$real_policy" = "t" ]; then
      # KADEME 1 sağlanmış — KADEME 2 (ENABLE+FORCE) bu guard'da BLOCKED,
      # ayrı bir bulgu üretmiyor.
      continue
    fi
    if in_baseline "$tbl"; then
      continue
    fi
    echo "[$GUARD_NAME] main.${tbl}"
    echo "  KADEME 1 (Z85, bugün aktif) ihlali: tenant_id taşıyan bu tablo GERÇEK bir RLS politikası olmadan doğdu"
    echo "  > politikasız ya da yer-tutucu (\"USING (true)\") — baseline'da da yok, YENİ bir tablo/regresyon"
    echo "  > KADEME 2 (ENABLE+FORCE çifti) bu guard'da BLOCKED — RLS-aktivasyon dalgasının işi (Z54 §3); bu bulgu ondan BAĞIMSIZ"
  done <<< "$ROWS"
}

report_guard "$(scan)"

# KADEME 2'nin BLOCKED durumu sessiz kalmasın — bulgu değil, bilgi satırı.
# ⛔ `scan()` bir KOMUT İKAMESİ (`$(...)`) içinde çağrıldığı için SUBSHELL'de
# koşar — orada set edilen bir sayaç değişkeni ebeveyn kabuğa GERİ SIZMAZ.
# Bu yüzden KADEME 2 sayımı `scan()`'in İÇİNDE değil, `$ROWS` üzerinden
# BAĞIMSIZ bir awk geçişiyle burada hesaplanır.
TOTAL_TENANT_TABLES="$(printf '%s\n' "$ROWS" | grep -c '^')"
K2_MISSING_COUNT="$(printf '%s\n' "$ROWS" | awk -F'|' '$2 != "t" || $3 != "t" { c++ } END { print c+0 }')"
echo "-- [$GUARD_NAME] KADEME 1: BUGÜN AKTİF (gerçek/fail-closed politika zorunlu, tüm tenant_id tablolarında)"
echo "-- [$GUARD_NAME] KADEME 2: BLOCKED → RLS-aktivasyon dalgası (Z54 §3) — bugün $K2_MISSING_COUNT/$TOTAL_TENANT_TABLES tenant_id tablosu ENABLE+FORCE çiftine sahip değil, bu guard bunu BLOKLAMIYOR"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

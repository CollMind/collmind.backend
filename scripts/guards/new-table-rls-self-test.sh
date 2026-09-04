#!/usr/bin/env bash
#
# self-test — new-table-rls (EK 1/b, Z53 §4b / Z54 §3 / Z85 — İKİ KADEME)
#
# Gerçek guard'ı `NEW_TABLE_RLS_DB_QUERY` + `NEW_TABLE_RLS_BASELINE` env
# override'larıyla ÇAĞIRIR — karşılaştırma mantığının hiçbir parçasını
# YENİDEN UYGULAMAZ (§2.7 #8).
#
# ⛔ TARİHÇE (bu turda düzeltildi): eski self-test'in mock'ları SABİT "t"/"f"
# döndürüyordu. Gerçek SQL çıktısı — `boolean || text` implicit cast'i
# yüzünden — "true"/"false" idi, "t"/"f" DEĞİL. Guard'ın karşılaştırması hiç
# eşleşmiyordu, HER satırı ihlal sayıyordu; mock bu kusuru TAKLİT ETMEDİĞİ
# için self-test yeşil kalıyordu ("bir mock, taklit ettiği şeyin TİPİNE
# bağlanmalı" — DISIPLIN.md). Düzeltme iki parçalı:
#   1) SQL tarafında `CASE WHEN ... THEN 't' ELSE 'f' END` ile TEK TEMSİLE
#      indirildi (new-table-rls.sh).
#   2) Bu self-test'e CANLI KATALOKTAN koşan bir BÖLÜM eklendi (CASE H) —
#      guard'ın kendi SQL'ini (elle yeniden yazılmadan) gerçek Postgres'e
#      karşı çalıştırır, iki sentetik tabloyla (bilinen-yeşil / bilinen-
#      kırmızı) İKİ-GİRDİ-İKİ-ÇIKTI ayırt etme gücünü kanıtlar. Sentetik
#      tablolar bir transaction içinde kurulup ROLLBACK edilir — KALICI
#      hiçbir iz bırakmaz (§2.7 #4: kanıt kurulumu ölçtüğün durumu
#      değiştirmesin).
#
# Alan sayısı DÖRDE çıktı (Z85 KADEME 1 — `real_policy` sütunu):
#   tbl|enable|force|real_policy
#
# CASE A — boş envanter (0 tenant tablosu)                     → exit 2
# CASE B — baseline'daki tablo politikasız (tolere edilen borç) → exit 0
# CASE C — baseline'daki tablo tam uyumlu (iyileşme)            → exit 0
# CASE D — baseline'da OLMAYAN yeni tablo, GERÇEK politika YOK  → exit 1
#          (KADEME 1 ihlali, mesaj "KADEME 1" adını taşımalı)
# CASE E — baseline'da olmayan tablo GERÇEK politikaya sahip,
#          ama ENABLE/FORCE yok (KADEME 2 — BLOCKED, bloklamaz)  → exit 0
# CASE F — DB'ye ulaşılamıyor                                   → exit 2
# CASE G — baseline dosyası yok                                 → exit 2
# CASE H — CANLI KATALOG: bilinen-yeşil (gerçek politika) +
#          bilinen-kırmızı (politikasız) AYNI koşumda            → yeşil
#          bulunmaz, kırmızı KADEME-1 adıyla bulunur, exit 1
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/new-table-rls.sh"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: new-table-rls.sh yok" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

mk_mock() {
  cat > "$1" << EOF
#!/usr/bin/env bash
printf '%s' "$2"
exit $3
EOF
  chmod +x "$1"
}

BASELINE="$TMP/baseline.txt"
printf 'plans\nagreements\n' > "$BASELINE"

# =============================================================================
# CASE A — boş envanter
# =============================================================================
MOCK_A="$TMP/mock-a.sh"
mk_mock "$MOCK_A" "" 0
OUT_A="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_A" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_A=$?
# ⛔ Boş envanter "TEMİZ" DEĞİL, "ÖLÇÜM YAPILMADI"dır (main şemasında
# tenant_id taşıyan tablo olmaması bu üründe İMKÂNSIZDIR — bugün 46).
if [ "$RC_A" -ne 2 ]; then
  echo "!! self-test FAIL [case A]: boş envanterde exit 2 (ÖLÇÜM YAPILMADI) bekleniyordu, $RC_A bulundu" >&2
  printf '%s\n' "$OUT_A" >&2
  FAIL=1
fi

# =============================================================================
# CASE B — baseline'daki tablo tamamen politikasız (tolere edilen borç)
# =============================================================================
MOCK_B="$TMP/mock-b.sh"
mk_mock "$MOCK_B" "plans|f|f|f" 0
OUT_B="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_B" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_B=$?
if [ "$RC_B" -ne 0 ]; then
  echo "!! self-test FAIL [case B]: baseline'daki tabloda exit 0 (tolere) bekleniyordu, $RC_B bulundu" >&2
  printf '%s\n' "$OUT_B" >&2
  FAIL=1
fi

# =============================================================================
# CASE C — baseline'daki tablo TAM uyumlu kazanmış (iyileşme, hâlâ temiz)
# =============================================================================
MOCK_C="$TMP/mock-c.sh"
mk_mock "$MOCK_C" "plans|t|t|t" 0
OUT_C="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_C" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_C=$?
if [ "$RC_C" -ne 0 ]; then
  echo "!! self-test FAIL [case C]: tam uyumlu kazanmış tabloda exit 0 bekleniyordu, $RC_C bulundu" >&2
  printf '%s\n' "$OUT_C" >&2
  FAIL=1
fi

# =============================================================================
# CASE D — baseline'da OLMAYAN yeni tablo, GERÇEK politika YOK (KADEME 1
# ihlali — pozitif kontrol: Z85'in bugün aktif sözleşmesi)
# =============================================================================
MOCK_D="$TMP/mock-d.sh"
mk_mock "$MOCK_D" "new_tenant_widgets|f|f|f" 0
OUT_D="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_D" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_D=$?
if [ "$RC_D" -ne 1 ]; then
  echo "!! self-test FAIL [case D]: baseline-dışı yeni tabloda gerçek politika yokken exit 1 bekleniyordu, $RC_D bulundu" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi
if ! grep -q '\[new-table-rls\] main.new_tenant_widgets' <<< "$OUT_D"; then
  echo "!! self-test FAIL [case D]: bulgu satırı 'main.new_tenant_widgets' ile görünmedi" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi
if ! grep -q 'KADEME 1' <<< "$OUT_D"; then
  echo "!! self-test FAIL [case D]: bulgu mesajı 'KADEME 1'i ADIYLA söylemiyor" >&2
  printf '%s\n' "$OUT_D" >&2
  FAIL=1
fi

# =============================================================================
# CASE E — baseline'da olmayan tablo GERÇEK politikaya sahip, ama ENABLE/
# FORCE yok (KADEME 2 — BLOCKED → RLS-aktivasyon dalgası, bloklamaz).
# Z85'in ÜÇÜNCÜ ŞEKLİ tam bu: `1822`'nin bugünkü hâli (politika var, RLS
# kapalı) — pozitif kontrol: kademe-2'nin GERÇEKTEN blocked olduğunu, yani
# eski davranışın (ENABLE+FORCE zorunlu) artık YÜRÜRLÜKTE OLMADIĞINI kanıtlar.
# =============================================================================
MOCK_E="$TMP/mock-e.sh"
mk_mock "$MOCK_E" "new_tenant_widgets|f|f|t" 0
OUT_E="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_E" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_E=$?
if [ "$RC_E" -ne 0 ]; then
  echo "!! self-test FAIL [case E]: gerçek politika VARKEN (ENABLE/FORCE yokken) exit 0 bekleniyordu, $RC_E bulundu" >&2
  printf '%s\n' "$OUT_E" >&2
  FAIL=1
fi
if grep -q '\[new-table-rls\] main.new_tenant_widgets' <<< "$OUT_E"; then
  echo "!! self-test FAIL [case E]: gerçek politikalı tablo YİNE DE bulgu üretti (KADEME 2 blocked olmalıydı)" >&2
  printf '%s\n' "$OUT_E" >&2
  FAIL=1
fi

# =============================================================================
# CASE F — DB'ye ulaşılamıyor → exit 2
# =============================================================================
MOCK_F="$TMP/mock-f.sh"
mk_mock "$MOCK_F" "" 1
OUT_F="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_F" NEW_TABLE_RLS_BASELINE="$BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_F=$?
if [ "$RC_F" -ne 2 ]; then
  echo "!! self-test FAIL [case F]: DB ulaşılamazken exit 2 bekleniyordu, $RC_F bulundu" >&2
  printf '%s\n' "$OUT_F" >&2
  FAIL=1
fi

# =============================================================================
# CASE G — baseline dosyası yok → exit 2 (SETUP HATASI)
# =============================================================================
MOCK_G="$TMP/mock-g.sh"
mk_mock "$MOCK_G" "" 0
OUT_G="$(NEW_TABLE_RLS_DB_QUERY="$MOCK_G" NEW_TABLE_RLS_BASELINE="$TMP/nonexistent-baseline.txt" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_G=$?
if [ "$RC_G" -ne 2 ]; then
  echo "!! self-test FAIL [case G]: baseline yokken exit 2 bekleniyordu, $RC_G bulundu" >&2
  printf '%s\n' "$OUT_G" >&2
  FAIL=1
fi

# =============================================================================
# CASE H — CANLI KATALOG: guard'ın KENDİ SQL'i, gerçek Postgres'e karşı,
# bir transaction içinde kurulup ROLLBACK edilen iki sentetik tabloyla.
#
# `NEW_TABLE_RLS_DB_QUERY` burada bir MOCK DEĞİL — bir WRAPPER'dır: guard'dan
# gelen SQL metnini (`$1`, hiçbir şekilde yeniden yazılmadan) alır, önüne
# sentetik kurulumu, arkasına ROLLBACK'i ekler, TEK bir psql oturumunda
# (tek transaction) çalıştırır. Guard'ın bash karşılaştırma mantığı hâlâ
# guard'ın kendi kodundan çalışır — yalnız SQL'in GERÇEK ÇIKTISI mock değil,
# canlı kataloktan gelir.
#
# `-q`: BEGIN/CREATE TABLE/CREATE POLICY/ROLLBACK komut etiketlerini
# bastırır — guard'ın `ROWS` ayrıştırması yalnız SELECT çıktısını görsün.
#
# app_migrate: main şemasında CREATE yetkisi olan tek rol (app_operator'da
# YOK — ölçüldü). Sentetik tablo isimleri gerçek evrenle ÇAKIŞMAYACAK
# (`new_table_rls_selftest_` öneki) şekilde seçildi.
# =============================================================================
DOCKER_PS_NAMES_H="$(docker ps --format '{{.Names}}' 2>/dev/null)"
if grep -qx 'collmind-tpm-postgres' <<< "$DOCKER_PS_NAMES_H"; then
  WRAPPER_H="$TMP/live-catalog-wrapper.sh"
  cat > "$WRAPPER_H" << 'WRAPEOF'
#!/usr/bin/env bash
SQL="$1"
docker exec -i collmind-tpm-postgres psql -U app_migrate -d collmind_tpm -q -v ON_ERROR_STOP=1 -t -A <<EOSQL
BEGIN;
CREATE TABLE main.new_table_rls_selftest_green (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL
);
CREATE POLICY pol_new_table_rls_selftest_green
  ON main.new_table_rls_selftest_green
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE TABLE main.new_table_rls_selftest_red (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL
);
$SQL
ROLLBACK;
EOSQL
WRAPEOF
  chmod +x "$WRAPPER_H"

  # Gerçek baseline dosyasını kullan — evrenin geri kalanı (bugün 46 tablo)
  # bu koşumda da görünür ve guard onları normal (baseline'da olmayan)
  # kurallarıyla değerlendirir; CASE H yalnız İKİ SENTETİK satırı sınar.
  REAL_BASELINE="$DIR/new-table-rls-baseline.txt"
  OUT_H="$(NEW_TABLE_RLS_DB_QUERY="$WRAPPER_H" NEW_TABLE_RLS_BASELINE="$REAL_BASELINE" GUARD_MODE=block bash "$GUARD" 2>&1)"
  RC_H=$?

  if [ "$RC_H" -ne 1 ]; then
    echo "!! self-test FAIL [case H]: canlı katalogda bilinen-kırmızı tablo varken exit 1 bekleniyordu, $RC_H bulundu" >&2
    printf '%s\n' "$OUT_H" >&2
    FAIL=1
  fi
  if ! grep -q '\[new-table-rls\] main.new_table_rls_selftest_red' <<< "$OUT_H"; then
    echo "!! self-test FAIL [case H]: bilinen-kırmızı tablo (politikasız) bulgu ÜRETMEDİ — guard canlı katalogda kör" >&2
    printf '%s\n' "$OUT_H" >&2
    FAIL=1
  fi
  OUT_H_CTX="$(grep -A3 '\[new-table-rls\] main.new_table_rls_selftest_red' <<< "$OUT_H")"
  if ! grep -q 'KADEME 1' <<< "$OUT_H_CTX"; then
    echo "!! self-test FAIL [case H]: bilinen-kırmızı bulgusu 'KADEME 1'i adıyla söylemiyor" >&2
    printf '%s\n' "$OUT_H" >&2
    FAIL=1
  fi
  if grep -q '\[new-table-rls\] main.new_table_rls_selftest_green' <<< "$OUT_H"; then
    echo "!! self-test FAIL [case H]: bilinen-yeşil tablo (gerçek politikalı) YANLIŞLIKLA bulgu üretti — guard canlı katalogda AYIRT EDEMİYOR" >&2
    printf '%s\n' "$OUT_H" >&2
    FAIL=1
  fi

  # Kalıcılık kontrolü — ROLLBACK gerçekten iz bırakmadı mı? (§2.7 #4/#7)
  LEFTOVER="$(docker exec -i collmind-tpm-postgres psql -U app_operator -d collmind_tpm -t -A -c \
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='main' WHERE c.relname LIKE 'new_table_rls_selftest_%';" 2>/dev/null)"
  if [ "${LEFTOVER:-0}" != "0" ]; then
    echo "!! self-test FAIL [case H]: sentetik tablolar ROLLBACK'e RAĞMEN kalıcı kaldı ($LEFTOVER satır)" >&2
    FAIL=1
  fi
else
  echo "-- self-test [case H]: collmind-tpm-postgres container AYAKTA DEĞİL — canlı katalog testi ATLANDI (ÖLÇEMEDİM, hata değil)" >&2
fi

if [ "$FAIL" -eq 0 ]; then
  echo "new-table-rls self-test: 8/8 case tutuyor (A boş, B tolere-borç, C iyileşme, D KADEME-1-ihlali, E KADEME-2-blocked, F DB-ulaşılamaz, G baseline-yok, H canlı-katalog-iki-girdi-iki-çıktı)"
  exit 0
fi
exit 1

#!/usr/bin/env bash
#
# K1b KAPANIŞ PİNİ — iki-marker ayırt etme (Z51 §1 "davranışsal pin",
# Z52 §7, ADIM6_DENETIM_CEKIRDEGI_BRIEF.md "Bileşen 1")
#
# ⛔ ÖN KOŞUL: `docker-compose.yml`'in K1b bloğu (logging_collector=on,
# log_line_prefix='%m [%p] %u@%d %a', log_connections=on) UYGULANMIŞ ve
# container BU AYARLARLA YENİDEN YARATILMIŞ olmalı (logging_collector bir
# postmaster-context parametredir, `docker exec` / SIGHUP ile değişmez).
#
# ⚠️ BU SCRIPT BU TURDA ÇALIŞTIRILAMADI — ortam sandbox'ı `docker
# stop/rm/rename` gibi container-mutasyon komutlarını REDDETTİ (auto-mode
# classifier). Container'ın yeniden yaratılması bu yüzden İNSAN TARAFINDAN
# yapılmalı (bkz. docs/verification/ADIM6_K1B_KAPANIS_PINI_BEKLIYOR.md
# "geri dönüş yolu" ve "adımlar" bölümü) — SONRA bu script koşulur.
#
# NE YAPAR:
#   1. app_runtime ve app_operator (BYPASSRLS'li operatör adayı) olarak
#      SIRADAN bir `SELECT 1;` çalıştırır — MARKER METNİ YOK (Z51'in
#      kırmızı pini metne dayanıyordu; bu turun kabulü METİNSİZ ayrışma).
#   2. Log volume'undaki EN TAZE log dosyasını okur, iki bağlantının
#      loglarını `u=` alanına göre eşleştirir.
#   3. `app_runtime@` ve `app_operator@` AYRI satırlarda görünüyorsa PASS.
#
# Kullanım:
#   DB_RUNTIME_PASSWORD=... DB_OPERATOR_PASSWORD=... bash k1b-two-marker-pin.sh
#
# Çıkış: 0 = pin GEÇTİ · 1 = pin KIRMIZI (ayırt edilemiyor) · 2 = ölçüm yapılamadı
set -uo pipefail

CONTAINER="${K1B_PIN_CONTAINER:-collmind-tpm-postgres}"
DB="${K1B_PIN_DB:-collmind_tpm}"
LOG_DIR_IN_CONTAINER="/var/log/postgresql"

if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  echo "!! [k1b-pin] container '$CONTAINER' çalışmıyor / ulaşılamıyor — ölçüm yapılamadı" >&2
  exit 2
fi

RUNTIME_PW="${DB_RUNTIME_PASSWORD:-}"
OPERATOR_PW="${DB_OPERATOR_PASSWORD:-}"
if [ -z "$RUNTIME_PW" ] || [ -z "$OPERATOR_PW" ]; then
  echo "!! [k1b-pin] DB_RUNTIME_PASSWORD / DB_OPERATOR_PASSWORD verilmedi — ölçüm yapılamadı" >&2
  exit 2
fi

# logging_collector açık mı — kapalıysa pin hiç anlamlı değil (yanlış negatif
# yerine SETUP HATASI vermek daha doğru: "ölçemedim" ≠ "kırmızı").
COLLECTOR="$(docker exec "$CONTAINER" psql -U postgres -d "$DB" -t -A -c "SHOW logging_collector;" 2>/dev/null)"
if [ "$COLLECTOR" != "on" ]; then
  echo "!! [k1b-pin] logging_collector='$COLLECTOR' (on bekleniyor) — container K1b ayarlarıyla YENİDEN YARATILMAMIŞ, ölçüm yapılamadı" >&2
  exit 2
fi

# İki bağlantı, marker METNİ OLMADAN — sıradan bir SELECT 1.
PGPASSWORD="$RUNTIME_PW" docker exec -e PGPASSWORD="$RUNTIME_PW" -i "$CONTAINER" \
  psql -U app_runtime -d "$DB" -t -A -c "SELECT 1;" >/dev/null 2>&1
PGPASSWORD="$OPERATOR_PW" docker exec -e PGPASSWORD="$OPERATOR_PW" -i "$CONTAINER" \
  psql -U app_operator -d "$DB" -t -A -c "SELECT 1;" >/dev/null 2>&1

# En taze log dosyası (bugünkü tarih deseniyle).
LATEST_LOG="$(docker exec "$CONTAINER" sh -c "ls -t $LOG_DIR_IN_CONTAINER/*.log 2>/dev/null | head -1")"
if [ -z "$LATEST_LOG" ]; then
  echo "!! [k1b-pin] $LOG_DIR_IN_CONTAINER içinde log dosyası yok — ölçüm yapılamadı" >&2
  exit 2
fi

TAIL="$(docker exec "$CONTAINER" tail -n 50 "$LATEST_LOG")"

# ⛔ DESEN PREFIX İLE HİZALI OLMALI (review B1, 2026-08-28).
# ESKİ HÂLİ `u=app_runtime,` (VİRGÜLLÜ) arıyordu — o desen
# `user=%u,db=%d` konvansiyonuna aittir. Bu turda yazılan prefix
# `%m [%p] %u@%d %a` ⇒ satır `... [123] app_runtime@collmind_tpm psql LOG:`.
# ÖLÇÜLDÜ: "u=app_runtime," → 0 · POZ.KONTROL "app_runtime@collmind_tpm" → 1
# ⇒ Pin MATEMATİKSEL OLARAK GEÇEMEZDİ, ve `:82`nin mesajı insanı
#   "%u eksik olabilir" diye YANLIŞ SEBEBE gönderirdi (%u VARDI).
#   `§2.7 #5` (desen sıfır şey yapıyor) + "yanlış mutasyon → yanlış teşhis".
RUNTIME_LINE="$(printf '%s\n' "$TAIL" | grep -c "] app_runtime@" || true)"
OPERATOR_LINE="$(printf '%s\n' "$TAIL" | grep -c "] app_operator@" || true)"

echo "=== [k1b-pin] son 50 log satırında ==="
echo "  app_runtime@  satırı: $RUNTIME_LINE"
echo "  app_operator@ satırı: $OPERATOR_LINE"

if [ "$RUNTIME_LINE" -gt 0 ] && [ "$OPERATOR_LINE" -gt 0 ]; then
  echo "✅ PASS — iki bağlantı, MARKER METNİ OLMADAN, u= alanıyla ayrışıyor"
  exit 0
fi

echo "!! KIRMIZI — u= alanıyla ayrışma GÖRÜLEMEDİ (log_line_prefix'te %u eksik olabilir, ya da bağlantılar loglanmadı)" >&2
exit 1

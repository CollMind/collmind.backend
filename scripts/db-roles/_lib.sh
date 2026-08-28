#!/usr/bin/env bash
#
# K-2.6.13 — `db-roles-setup.sh`, `db-roles-grants.sh` ve
# `db-roles-operator-grants.sh` (K1a) arasında paylaşılan
# bağlantı mantığı. Kendi başına çalıştırılmaz, `source` edilir.
#
# B2 (code-reviewer bulgusu, 2026-08-16): betik ikiye ayrıldığı için
# (01 göçten ÖNCE, 02 göçten SONRA) `run_psql` iki dosyada birebir
# tekrarlanmasın diye buraya çıkarıldı.
#
# Opsiyonel env değişkenleri (yerel geliştirme varsayılanları vardır):
#   DB_CONTAINER_NAME   docker container adı (varsayılan: collmind-tpm-postgres)
#   DB_DATABASE         (varsayılan: collmind_tpm)
#   DB_SCHEMA           (varsayılan: main)
#   DB_ADMIN_USERNAME   rol yaratma yetkili superuser (varsayılan: postgres)
#   DB_ROLES_SETUP_MODE docker | tcp (varsayılan: docker)
#
# docker modunda DB_ADMIN_PASSWORD GEREKMEZ: `docker exec` container'ın
# yerel unix soketine bağlanır ve `pg_hba.conf`'taki `local all all trust`
# satırı superuser'ı parolasız doğrular (bkz. docker/pg_hba.conf). TCP
# modunda (`host ... md5`) parola zorunludur.

# ⛔ Z52 §4 / `Z29` İSTİSNA DİSİPLİNİ — ADIYLA LİSTELİ:
# `DB_ADMIN_USERNAME` (superuser, varsayılan `postgres`) BU DOSYADA VE
# YALNIZ aşağıdaki ÜÇ KURULUM-FONKSİYONUNDA kullanılır:
#   1. db-roles-setup.sh   → 01-roles-and-ownership.sql  (rol/şema YARATMA)
#   2. db-roles-grants.sh  → 02-runtime-grants.sql        (GRANT/REVOKE, rol
#      yaratmadığı için superuser GEREKMEZ ama aynı `run_psql` sarmalayıcıyı
#      paylaşır — ölçülü GRANT'ler zaten app_migrate/app_runtime'ı hedefler,
#      superuser'ın YETKİSİ değil BAĞLANTISI kullanılır)
#   3. db-roles-operator-grants.sh → 03-operator-grants.sql  (K1a, 2026-08-28)
#      ⛔ BU SATIR BİR REVIEW BULGUSUYLA EKLENDİ: üçüncü kullanım, bu listeyi
#      YAZAN commit'in KENDİSİNDE doğdu ve listeye yazılmadı — `CLAUDE.md`:
#      "bir kuralı yazdığın tur, o kuralı en çok ihlal ettiğin turdur".
#      Gerekçe `2.` ile aynı: GRANT vermek superuser GEREKTİRMEZ, ama aynı
#      `run_psql` sarmalayıcısı paylaşılır.
# BOOTSTRAP = rol yaratma · migration-zinciri kurulumu, TANIM GEREĞİ bu ikisi
# DIŞINDA superuser YOKTUR — "insan-yolu" (etkileşimli sorgu/bakım/veri-erişimi)
# `app_operator`'e (K1a) taşındı: `scripts/db-query.sh`, guard'lar,
# `db-cleanup.ts`. Bu listeye üçüncü bir kurulum-fonksiyonu eklenirse
# BURADA adıyla eklenir — sessiz bir üçüncü kullanım YASAK.
DB_CONTAINER_NAME="${DB_CONTAINER_NAME:-collmind-tpm-postgres}"
DB_DATABASE="${DB_DATABASE:-collmind_tpm}"
DB_SCHEMA="${DB_SCHEMA:-main}"
DB_ADMIN_USERNAME="${DB_ADMIN_USERNAME:-postgres}"
DB_ROLES_SETUP_MODE="${DB_ROLES_SETUP_MODE:-docker}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$ROOT/scripts/db-roles"

# run_psql <sql_file> [-v adı=değer ...]
# Ekstra `-v` çiftleri çağırana göre değişir (setup.sh runtime_pw/migrate_pw
# geçirir, grants.sh yalnız schema geçirir) — bu yüzden fonksiyon değişken
# sayıda `-v` argümanı kabul eder.
run_psql() {
  local sql_file="$1"
  shift
  local extra_vars=("$@")

  # ⚠️ macOS'in varsayılan bash'i (3.2.57 — CTPM geliştirme ortamı) boş bir
  # dizide `"${arr[@]}"`'i `set -u` altında "unbound variable" sayar (bash
  # 4.4'e kadar sürüyor). `db-roles-grants.sh` extra_vars'ı BOŞ geçirir
  # (02'nin yalnız `:"schema"` ihtiyacı var) — ölçüldü, izole container:
  # düzeltmeden önce betik burada EXIT 1 ile çöküyordu. `${extra_vars[@]+...}`
  # deyimi dizinin TANIMSIZ olduğu durumu (`+` operatörü) ele alır; boş bir
  # dizi burada "set ama sıfır elemanlı" olduğu için de çalışır.
  if [ "$DB_ROLES_SETUP_MODE" = "docker" ]; then
    docker exec -i "$DB_CONTAINER_NAME" psql \
      -U "$DB_ADMIN_USERNAME" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 \
      ${extra_vars[@]+"${extra_vars[@]}"} \
      -v schema="$DB_SCHEMA" \
      <"$sql_file"
  elif [ "$DB_ROLES_SETUP_MODE" = "tcp" ]; then
    : "${DB_HOST:?TCP modunda DB_HOST tanımlı olmalı}"
    : "${DB_PORT:?TCP modunda DB_PORT tanımlı olmalı}"
    : "${DB_ADMIN_PASSWORD:?TCP modunda DB_ADMIN_PASSWORD tanımlı olmalı}"
    PGPASSWORD="$DB_ADMIN_PASSWORD" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USERNAME" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 \
      ${extra_vars[@]+"${extra_vars[@]}"} \
      -v schema="$DB_SCHEMA" \
      <"$sql_file"
  else
    echo "⛔ DB_ROLES_SETUP_MODE '$DB_ROLES_SETUP_MODE' bilinmiyor — 'docker' ya da 'tcp' olmalı" >&2
    exit 2
  fi
}

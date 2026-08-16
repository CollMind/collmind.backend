#!/usr/bin/env bash
#
# K-2.6.13c — idempotent rol kurulum betiği. MIGRATION DEĞİLDİR (roller
# küme-yönetimi nesnesidir, şema geçmişi değil — `L2_03_onay_yetki_uyum.md`
# `K-2.6.13c`). `npm run migration:*` ve `npm run seed*` bu betiğin
# çalıştırdığı rolleri VARSAYAR; önce bu betik koşulmalıdır.
#
# Uygular:
#   1. scripts/db-roles/01-roles-and-ownership.sql — app_runtime/app_migrate
#      rollerini yaratır (veya günceller), şema haklarını verir, var olan
#      nesnelerin sahipliğini app_migrate'e taşır.
#   2. scripts/db-roles/02-runtime-grants.sql — app_runtime'ın ölçülmüş
#      asgari GRANT setini uygular (K-2.6.13f envanteri).
#
# Tekrar çalıştırmak güvenlidir.
#
# Zorunlu env değişkenleri (sessizce varsayılan ÜRETİLMEZ):
#   DB_RUNTIME_PASSWORD   app_runtime parolası
#   DB_MIGRATE_PASSWORD   app_migrate parolası
#
# Opsiyonel (yerel geliştirme varsayılanları vardır):
#   DB_CONTAINER_NAME   docker container adı (varsayılan: collmind-tpm-postgres)
#   DB_DATABASE         (varsayılan: collmind_tpm)
#   DB_SCHEMA           (varsayılan: main)
#   DB_ADMIN_USERNAME   rol yaratma yetkili superuser (varsayılan: postgres)
#   DB_ROLES_SETUP_MODE docker | tcp (varsayılan: docker)
#
# TCP modu (docker container yoksa — ör. yönetilen bir Postgres — henüz
# CTPM'in bir dağıtılmış ortamı yok, ama betik buna hazır):
#   DB_ROLES_SETUP_MODE=tcp DB_HOST=... DB_PORT=... \
#     DB_ADMIN_USERNAME=... DB_ADMIN_PASSWORD=... bash scripts/db-roles-setup.sh
#
# docker modunda DB_ADMIN_PASSWORD GEREKMEZ: `docker exec` container'ın
# yerel unix soketine bağlanır ve `pg_hba.conf`'taki `local all all trust`
# satırı superuser'ı parolasız doğrular (bkz. docker/pg_hba.conf). TCP
# modunda (`host ... md5`) parola zorunludur.

set -euo pipefail

: "${DB_RUNTIME_PASSWORD:?DB_RUNTIME_PASSWORD tanımlı olmalı — sessizce varsayılan üretilmez}"
: "${DB_MIGRATE_PASSWORD:?DB_MIGRATE_PASSWORD tanımlı olmalı — sessizce varsayılan üretilmez}"

DB_CONTAINER_NAME="${DB_CONTAINER_NAME:-collmind-tpm-postgres}"
DB_DATABASE="${DB_DATABASE:-collmind_tpm}"
DB_SCHEMA="${DB_SCHEMA:-main}"
DB_ADMIN_USERNAME="${DB_ADMIN_USERNAME:-postgres}"
DB_ROLES_SETUP_MODE="${DB_ROLES_SETUP_MODE:-docker}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_DIR="$ROOT/scripts/db-roles"

run_psql() {
  local sql_file="$1"
  if [ "$DB_ROLES_SETUP_MODE" = "docker" ]; then
    docker exec -i "$DB_CONTAINER_NAME" psql \
      -U "$DB_ADMIN_USERNAME" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 \
      -v runtime_pw="$DB_RUNTIME_PASSWORD" \
      -v migrate_pw="$DB_MIGRATE_PASSWORD" \
      -v schema="$DB_SCHEMA" \
      <"$sql_file"
  elif [ "$DB_ROLES_SETUP_MODE" = "tcp" ]; then
    : "${DB_HOST:?TCP modunda DB_HOST tanımlı olmalı}"
    : "${DB_PORT:?TCP modunda DB_PORT tanımlı olmalı}"
    : "${DB_ADMIN_PASSWORD:?TCP modunda DB_ADMIN_PASSWORD tanımlı olmalı}"
    PGPASSWORD="$DB_ADMIN_PASSWORD" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USERNAME" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 \
      -v runtime_pw="$DB_RUNTIME_PASSWORD" \
      -v migrate_pw="$DB_MIGRATE_PASSWORD" \
      -v schema="$DB_SCHEMA" \
      <"$sql_file"
  else
    echo "⛔ DB_ROLES_SETUP_MODE '$DB_ROLES_SETUP_MODE' bilinmiyor — 'docker' ya da 'tcp' olmalı" >&2
    exit 2
  fi
}

echo "▶ [1/2] roller + sahiplik (idempotent) — $SQL_DIR/01-roles-and-ownership.sql"
run_psql "$SQL_DIR/01-roles-and-ownership.sql"

echo "▶ [2/2] app_runtime asgari GRANT seti (K-2.6.13f envanteri) — $SQL_DIR/02-runtime-grants.sql"
run_psql "$SQL_DIR/02-runtime-grants.sql"

echo "✅ Roller ve haklar uygulandı: app_runtime (DML, RLS'e tabi, sahip DEĞİL) · app_migrate (DDL, tablo sahibi)"

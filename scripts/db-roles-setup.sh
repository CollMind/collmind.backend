#!/usr/bin/env bash
#
# K-2.6.13c — idempotent rol + sahiplik kurulum betiği. MIGRATION DEĞİLDİR
# (roller küme-yönetimi nesnesidir, şema geçmişi değil —
# `L2_03_onay_yetki_uyum.md` `K-2.6.13c`). `npm run migration:*` ve
# `npm run seed*` bu betiğin yarattığı rolleri VARSAYAR.
#
# ⚠️ B2 (code-reviewer, 2026-08-16): bu betik ARTIK yalnız
# `01-roles-and-ownership.sql`'i uygular ve göçlerden ÖNCE çalışır.
# `app_runtime`'ın tablo bazlı GRANT seti (eski `02-runtime-grants.sql`)
# `db-roles-grants.sh`'a taşındı ve göçlerden SONRA çalışır — çünkü `02`
# GRANT verdiği tabloların VAR OLMASINI gerektirir; taze/boş bir şemada
# göçlerden önce çalıştırılırsa "relation ... does not exist" ile düşer
# (ampirik ölçüldü, izole container). Sıra artık:
#
#   1. db-roles-setup.sh   (bu dosya)  — roller + sahiplik
#   2. npm run migration:run           — şema
#   3. db-roles-grants.sh              — app_runtime tablo/kolon GRANT'leri
#   4. npm run seed:run  (opsiyonel)
#
# Uygular:
#   1. scripts/db-roles/01-roles-and-ownership.sql — app_runtime/app_migrate
#      rollerini yaratır (veya günceller), şema haklarını verir, var olan
#      nesnelerin (tablo/sequence/view/matview/enum-domain/fonksiyon)
#      sahipliğini app_migrate'e taşır.
#
# Tekrar çalıştırmak güvenlidir.
#
# Zorunlu env değişkenleri (sessizce varsayılan ÜRETİLMEZ):
#   DB_RUNTIME_PASSWORD   app_runtime parolası
#   DB_MIGRATE_PASSWORD   app_migrate parolası
#
# Opsiyonel env değişkenleri ve TCP modu için `scripts/db-roles/_lib.sh`
# başlığına bakın (bu betikle `db-roles-grants.sh` arasında paylaşılır).

set -euo pipefail

: "${DB_RUNTIME_PASSWORD:?DB_RUNTIME_PASSWORD tanımlı olmalı — sessizce varsayılan üretilmez}"
: "${DB_MIGRATE_PASSWORD:?DB_MIGRATE_PASSWORD tanımlı olmalı — sessizce varsayılan üretilmez}"

# shellcheck source=./db-roles/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db-roles/_lib.sh"

echo "▶ roller + sahiplik (idempotent) — $SQL_DIR/01-roles-and-ownership.sql"
run_psql "$SQL_DIR/01-roles-and-ownership.sql" \
  -v runtime_pw="$DB_RUNTIME_PASSWORD" \
  -v migrate_pw="$DB_MIGRATE_PASSWORD"

echo "✅ Roller ve sahiplik uygulandı: app_runtime (DML, RLS'e tabi, sahip DEĞİL) · app_migrate (DDL, tablo/enum/fonksiyon sahibi)"
echo "▶ sıradaki adım: 'npm run migration:run', ardından 'npm run db:roles:grants'"

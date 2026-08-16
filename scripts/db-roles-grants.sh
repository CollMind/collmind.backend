#!/usr/bin/env bash
#
# K-2.6.13f — `app_runtime`'ın ölçülmüş asgari GRANT setini uygular
# (`scripts/db-roles/02-runtime-grants.sql`). MIGRATION DEĞİLDİR.
#
# ⚠️ B2 (code-reviewer, 2026-08-16): bu betik göçlerden SONRA çalışmalıdır.
# `02-runtime-grants.sql` 85 tablo/view/sütun GRANT'i içerir ve hedef
# nesnelerin VAR OLMASINI gerektirir — taze/boş bir şemada (göçlerden önce)
# çalıştırılırsa ilk GRANT'te "relation ... does not exist" ile düşer
# (ampirik ölçüldü, izole container, `ON_ERROR_STOP` açık).
#
# Sıra:
#   1. db-roles-setup.sh    — roller + sahiplik (göçlerden ÖNCE)
#   2. npm run migration:run
#   3. db-roles-grants.sh   (bu dosya, göçlerden SONRA)
#   4. npm run seed:run  (opsiyonel)
#
# Tekrar çalıştırmak güvenlidir VE YAKINSAKTIR (M1, code-reviewer):
# `02-runtime-grants.sql` artık başında `REVOKE ALL` çalıştırıp ardından
# ölçülmüş GRANT setini uyguluyor — betik dosyası TEK doğruluk kaynağıdır,
# elle verilmiş fazladan bir hak bir sonraki koşumda geri alınır.
#
# Gerekli env değişkeni yok (rol yaratmıyor, yalnız GRANT veriyor —
# `DB_RUNTIME_PASSWORD`/`DB_MIGRATE_PASSWORD` gerekmiyor). Opsiyonel env
# değişkenleri ve TCP modu için `scripts/db-roles/_lib.sh` başlığına bakın.

set -euo pipefail

# shellcheck source=./db-roles/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db-roles/_lib.sh"

echo "▶ app_runtime asgari GRANT seti (K-2.6.13f envanteri, yakınsak) — $SQL_DIR/02-runtime-grants.sql"
run_psql "$SQL_DIR/02-runtime-grants.sql"

echo "✅ app_runtime GRANT'leri uygulandı (REVOKE ALL + ölçülmüş envanter — dosya TEK doğruluk kaynağı)"

#!/usr/bin/env bash
#
# K1a (Z52 §3/§4) — `app_operator`'ün GRANT setini uygular
# (`scripts/db-roles/03-operator-grants.sql`). MIGRATION DEĞİLDİR.
#
# Göçlerden SONRA çalıştırılmalıdır (`db-roles-grants.sh` ile aynı gerekçe —
# GRANT verdiği nesnelerin var olması gerekir).
#
# Sıra:
#   1. db-roles-setup.sh              — roller + sahiplik (göçlerden ÖNCE)
#   2. npm run migration:run
#   3. db-roles-grants.sh             — app_runtime GRANT'leri
#   4. db-roles-operator-grants.sh    (bu dosya) — app_operator GRANT'leri
#   5. npm run seed:run  (opsiyonel)
#
# Tekrar çalıştırmak güvenlidir VE YAKINSAKTIR (M1 deseni,
# 02-runtime-grants.sql'den taşındı): `03-operator-grants.sql` önce
# `REVOKE ALL` çalıştırıp ardından ölçülmüş GRANT setini uyguluyor.
#
# Gerekli env değişkeni yok (rol yaratmıyor, yalnız GRANT veriyor).
# Opsiyonel env değişkenleri ve TCP modu için `scripts/db-roles/_lib.sh`
# başlığına bakın.

set -euo pipefail

# shellcheck source=./db-roles/_lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db-roles/_lib.sh"

echo "▶ app_operator GRANT seti (K1a, yakınsak) — $SQL_DIR/03-operator-grants.sql"
run_psql "$SQL_DIR/03-operator-grants.sql"

echo "✅ app_operator GRANT'leri uygulandı (REVOKE ALL + ölçülmüş envanter — dosya TEK doğruluk kaynağı)"

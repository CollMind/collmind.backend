#!/usr/bin/env bash
# T-325 — orkestrasyon: TABAN TEMİZLİK ön-adımı + e2e suite.
#
# `npm run test:e2e`'nin TEK resmi girişi budur (bkz. package.json).
#
# ⚠️ TEK-ÇALIŞTIRAN KİLİDİ BU SCRIPT'TE DEĞİL — `test/global-setup.js` /
# `test/global-teardown.js`'te (`test/helpers/e2e-run-lock.js`, PID dosyası
# + canlılık kontrolü). Neden burada değil: Jest'in `globalSetup`/
# `globalTeardown`'ı `testRegex`'i eşleştiren HER `jest` çağrısında çalışır —
# tam koşum, hedefli koşum (`--testPathPattern`), ya da bu wrapper
# ATLANIP doğrudan `npx jest --config ./test/jest-e2e.json` çağrıldığında
# bile. Kilidi burada (bir shell seviyesinde) tutmak, wrapper atlandığında
# korumasız bırakırdı — kilit bu yüzden testRegex'in KENDİSİNE, yani
# global-setup.js'e taşındı. Bu script yalnızca TABAN TEMİZLİĞİNİ (aşağıda)
# jest başlamadan ÖNCE çalıştırmak için var — o adım TypeScript'tir
# (`cleanupTestAgreements`/`cleanupTestPlans`/`cleanupSalesActuals`'ı
# ts-jest DIŞINDA çağırır) ve `global-setup.js` CommonJS olmak ZORUNDADIR
# (bkz. o dosyanın ve `e2e-row-count.js`'in başındaki gerekçe), yani
# TS tarafı oraya taşınamaz.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ [T-325] taban temizliği + e2e suite (kilit: global-setup.js/global-teardown.js)"
npx ts-node -r tsconfig-paths/register test/e2e-preflight-baseline-cleanup.ts
exec jest --config ./test/jest-e2e.json --runInBand "$@"

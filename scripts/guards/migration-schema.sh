#!/usr/bin/env bash
#
# Guard: migration-schema  (INV-M-002)
#
# Yakaladığı: bir migration dosyası pg_constraint / pg_indexes / pg_class /
# pg_tables / information_schema sorgusu yapıyor ama sorgunun KENDİSİNDE
# nspname / schemaname / table_schema predicate'i yok. Bu instance hem `main`
# (CTPM) hem `public` (TTM) şemasını barındırdığı için, şema-nitelendirilmemiş
# bir catalogue kontrolü yanlış şemadaki nesneyi görüp migration'ı sessizce
# no-op yapar. Gerçek vaka: 1777000000000-LedgerReversalSupport.
#
# Yöntem (T-064 Faz 2): Faz 1'deki ±10 satırlık pencere MASKELEME üretiyordu:
# şema-nitelendirilmiş bir sorgu, nitelendirilmemiş komşusunun penceresine
# düşünce ikincisi kaçıyordu. Artık pencere yok, SORGU SINIRI var: her template
# literal (`` ` ... ` ``) bir birim olarak çıkarılır ve ayrı ayrı değerlendirilir.
# Çok satırlı literal'ler yaygın olduğu için okuma satır bazlı değil blok bazlı.
#
# Şema-güvenli sayılan (bulgu DEĞİL) desenler — predicate'e gerek yoktur:
#   'main.agreements'::regclass · to_regclass('main.x') · ::regnamespace
#
# Bilinen sınır: tek bir template literal içinde birden çok catalogue sorgusu
# varsa (ör. `EXISTS(...) AND NOT EXISTS(...)`) blok bütün olarak değerlendirilir;
# biri nitelendirilmişse diğeri maskelenebilir. Pencere maskelemesinden çok daha
# dar bir yüzey, ama sıfır değil.
#   ⚠️ Böyle bir blok BUGÜN VAR: 1795000000000-AddSpendTypeToBudgetDimensions.ts:148-160
#   (iki information_schema.columns sorgusu, tek literal). Bugün maskeleme yok
#   çünkü İKİSİ DE `table_schema = 'main'` taşıyor — ama o bloğa nitelendirilmemiş
#   üçüncü bir sorgu eklenirse guard susar.
#
# GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
# Allowlist parse hatası        → exit 2 (her iki modda da)
set -uo pipefail

GUARD_NAME="migration-schema"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"
cd "$ROOT"

validate_allowlist "$ALLOWLIST" || exit 2

# GUARD_MIG_DIR: yalnızca self-test.sh fixture dizinini işaret etmek için kullanır.
# Üretim koşumunda set edilmez; varsayılan davranış değişmez.
MIG_DIR="${GUARD_MIG_DIR:-$(find src -type d -name migrations -not -path "*/node_modules/*" 2>/dev/null | head -1)}"
if [ -z "$MIG_DIR" ]; then
  echo "-- [$GUARD_NAME] SKIPPED: migrations dizini bulunamadı"
  exit 0
fi

# Template literal'ları gerçek bir lexer ile çıkar (scripts/guards/migration-schema.awk).
# Parite/pencere sezgiseli YOK: literal içi/dışı durumu karakter karakter izlenir,
# bir `//` ancak literal dışındayken yorum sayılır. Gerekçe .awk dosyasının başında.
scan() {
  find "$MIG_DIR" -type f -name "*.ts" | sort | while IFS= read -r f; do
    awk -v file="$f" -v guard="$GUARD_NAME" -f "$ROOT/scripts/guards/migration-schema.awk" "$f"
  done
}

report_guard "$(scan)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

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
# Yöntem (Faz 2 — T-065): Faz 1'deki ±10 satırlık pencere MASKELEME üretiyordu:
# şema-nitelendirilmiş bir sorgu, nitelendirilmemiş komşusunun penceresine
# düşünce ikincisi kaçıyordu. Artık pencere yok, SORGU SINIRI var: her template
# literal (`` ` ... ` ``) bir birim olarak çıkarılır ve ayrı ayrı değerlendirilir.
# Çok satırlı literal'ler yaygın olduğu için okuma satır bazlı değil blok bazlı.
#
# Şema-güvenli sayılan (bulgu DEĞİL) desenler — predicate'e gerek yoktur:
#   'main.agreements'::regclass · to_regclass('main.x') · ::regnamespace
#
# Bilinen sınır: tek bir template literal içinde birden çok catalogue sorgusu
# varsa (ör. `EXISTS(...) AND EXISTS(...)`) blok bütün olarak değerlendirilir;
# biri nitelendirilmişse diğeri maskelenebilir. Pencere maskelemesinden çok daha
# dar bir yüzey, ama sıfır değil. Bloklar bugün kod tabanında tek sorgu.
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

MIG_DIR="$(find src -type d -name migrations -not -path "*/node_modules/*" 2>/dev/null | head -1)"
if [ -z "$MIG_DIR" ]; then
  echo "-- [$GUARD_NAME] SKIPPED: migrations dizini bulunamadı"
  exit 0
fi

# Template literal'ları backtick ile bölerek çıkar. RS="`" ile tek sayılı
# kayıtlar literal DIŞI, çift sayılı kayıtlar literal İÇİ metindir. Satır
# numarası, o ana kadar tüketilen yeni satırlar sayılarak izlenir.
scan() {
  find "$MIG_DIR" -type f -name "*.ts" | sort | while IFS= read -r f; do
    awk -v file="$f" -v guard="$GUARD_NAME" '
      BEGIN {
        RS = "`"
        SQ = sprintf("%c", 39)
        CAT      = "pg_constraint|pg_indexes|pg_class|pg_tables|information_schema"
        SCHEMA   = "nspname|schemaname|table_schema"
        consumed = 0
      }
      {
        block     = $0
        blockstart = consumed          # bu kaydın başladığı satır (0-tabanlı offset)
        nl = gsub(/\n/, "\n", block)   # kayıttaki yeni satır sayısı (block değişmez)
        consumed += nl

        if (NR % 2 == 1) next          # literal dışı → SQL değil
        if (block !~ CAT) next         # catalogue sorgusu yok
        if (block ~ SCHEMA) next       # sorgunun kendisinde şema predicate*i var

        # Şema-güvenli regclass/regnamespace desenleri: nitelendirilmiş literal
        # zaten şemayı belirtir, ayrıca predicate gerekmez.
        if (block ~ /'"'"'[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*'"'"'[ \t]*::[ \t]*regclass/) next
        if (block ~ /to_regclass\([ \t]*'"'"'[A-Za-z_][A-Za-z0-9_]*\./) next
        if (block ~ /::[ \t]*regnamespace/) next

        # Bulgu: catalogue tokenının geçtiği ilk satırı raporla.
        n = split(block, L, "\n")
        for (i = 1; i <= n; i++) {
          if (L[i] !~ CAT) continue
          t = L[i]; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
          if (t ~ /^--/) continue      # SQL yorum satırı
          match(t, CAT); cat = substr(t, RSTART, RLENGTH)
          printf "[%s] %s:%d\n", guard, file, blockstart + i
          printf "  %s sorgusunda şema predicate" SQ "i yok\n", cat
          printf "  > %s\n", t
          break
        }
      }
    ' "$f"
  done
}

OUT="$(scan | filter_allowlist)"
[ -n "$OUT" ] && printf "%s\n" "$OUT"
COUNT="$(printf "%s" "$OUT" | grep -c "^\[$GUARD_NAME\]" || true)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

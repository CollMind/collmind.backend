#!/usr/bin/env bash
#
# Guard: scope-ratchet  ([[T-266]], Z19b)
#
# ⛔ BU GUARD "KAPSAM UYGULANIYOR MU" DİYE ÖLÇMEZ — ÖLÇEMEZ.
#
# T-079/T-253 ölçtü: AccessScopeService'in constructor'a ENJEKTE edilmesi onun
# ÇAĞRILDIĞI anlamına gelmez (dashboard.service 5 atıf taşıyordu, getDashboard-
# Summary hiçbirini kullanmıyordu). Bu guard o çağrı zincirini STATİK OLARAK
# yeniden çözmeye ÇALIŞMAZ — bunu yapan bir tarayıcı, T-249'un enjeksiyon
# tuzağını farklı bir şekilde yeniden üretirdi.
#
# Bunun yerine: 235 rotanın TAMAMI dört elle-sınıflandırılmış listeye
# (A1/A2/B/C — bkz. scope-a1-baseline.txt/scope-a2.txt/scope-b.txt/scope-c.txt)
# bölünmüştür, her satır kod okunarak (accessScope çağrı zinciri, CPL ekseni)
# doğrulanmış ve gerekçelidir. Guard'ın ölçtüğü ŞEY:
#
#   1. TAMLIK    — src/**/*.controller.ts'teki HER rota dört listeden birinde
#                  mi? Değilse YENİ/sınıflandırılmamış bir rota var demektir
#                  → exit 2 (SETUP HATASI / DUR — bir ürün kararı gerekir,
#                  bu guard onu KENDİ BAŞINA vermez, T-266 görev talimatı).
#   2. TEKİLLİK   — bir rota BİRDEN FAZLA listede mi? → exit 2 (çelişkili
#                  sınıflandırma, ölçüm güvenilmez).
#   3. A1 RATCHET — scripts/guards/scope-a1-baseline.txt dosyasının İÇERİĞİ
#                  (working tree) son commit'teki (HEAD) hâlinden DAHA FAZLA
#                  anahtar taşıyor mu? Taşıyorsa YENİ bir borç kalemi
#                  gerekçesiz eklenmiş demektir → [[scope-ratchet]] bulgusu.
#                  Bir anahtar HEAD'de olup working tree'de yoksa: hâlâ rota
#                  envanterindeyse VE başka bir listeye (A2/B/C) taşınmışsa
#                  İYİLEŞTİ (bilgi); envanterde hiç yoksa GONE (bilgi, silinmiş/
#                  yeniden adlandırılmış); envanterde olup HİÇBİR listede
#                  değilse zaten (1)'in TAMLIK kontrolü bunu exit 2 ile yakalar.
#
# A2/B/C İÇİN RATCHET YOK — T-266 görev talimatı: "A2 listede, BUGÜN
# BLOKLAMAZ." A2 bir borç defteridir, kapı A1'dedir.
#
# GUARD_MODE=block (varsayılan) → A1 büyümesi varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0
# Kaynak boş / sınıflandırılmamış rota / çakışan sınıflandırma / bozuk liste
# satırı → exit 2 (SETUP HATASI / ÖLÇÜM YAPILMADI), TÜM modlarda.
set -uo pipefail

GUARD_NAME="scope-ratchet"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWK_ROUTE="$ROOT/scripts/guards/route-scope.awk"
# Fixture yönlendirmesi (self-test) — üretimde set edilmez.
SRC_DIR="${SCOPE_RATCHET_SRC_DIR:-$ROOT/src}"
A1_FILE="${SCOPE_RATCHET_A1:-$ROOT/scripts/guards/scope-a1-baseline.txt}"
A2_FILE="${SCOPE_RATCHET_A2:-$ROOT/scripts/guards/scope-a2.txt}"
B_FILE="${SCOPE_RATCHET_B:-$ROOT/scripts/guards/scope-b.txt}"
C_FILE="${SCOPE_RATCHET_C:-$ROOT/scripts/guards/scope-c.txt}"
cd "$ROOT"
# NOT: bu guard lib.sh'i (allowlist/report_guard) KULLANMAZ — bilinçli.
# A1 eklemesi susturulabilir bir "bulgu" DEĞİL, T-266'nın kendisinin
# yasakladığı bir şey (gerekçesiz borç artışı); allowlist ile susturulabilir
# olması ratchet'in amacını (K-2.6.6/Z19b) baştan yener.

if [ ! -f "$AWK_ROUTE" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: parser bulunamadı ($AWK_ROUTE)" >&2
  exit 2
fi

if [ ! -d "$SRC_DIR" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: kaynak dizini bulunamadı: $SRC_DIR — ölçüm YAPILMADI" >&2
  exit 2
fi

for f in "$A1_FILE" "$A2_FILE" "$B_FILE" "$C_FILE"; do
  if [ ! -f "$f" ]; then
    echo "!! [$GUARD_NAME] SETUP HATASI: sınıflandırma listesi bulunamadı: $f — ölçüm YAPILMADI" >&2
    exit 2
  fi
done

# --- kaynak: rota envanteri (route-scope.sh ile AYNI mekanizma, İKİNCİ bir
# parser YAZILMADI — İlke 4) ------------------------------------------------
CONTROLLER_LIST="$(mktemp)"
find "$SRC_DIR" -type f -name "*.controller.ts" | LC_ALL=C sort > "$CONTROLLER_LIST"
CONTROLLER_COUNT="$(wc -l < "$CONTROLLER_LIST" | tr -d ' ')"

if [ "$CONTROLLER_COUNT" -eq 0 ]; then
  # T-250 dersi: kaynak boş türetilirse SESSİZCE YEŞİL DEĞİL — SETUP HATASI.
  echo "!! [$GUARD_NAME] SETUP HATASI: $SRC_DIR altında hiç *.controller.ts bulunamadı." >&2
  echo "!! Boş küme sessizce 'temiz' sayılırsa guard körleşir — ölçüm YAPILMADI." >&2
  rm -f "$CONTROLLER_LIST"
  exit 2
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$CONTROLLER_LIST"' EXIT
CUR="$TMP/routes.tsv"
: > "$CUR"
SRC_PARENT="$(cd "$(dirname "$SRC_DIR")" && pwd)"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  rel="${f#"$SRC_PARENT"/}"
  awk -f "$AWK_ROUTE" "$f" | awk -F'\t' -v OFS='\t' -v r="$rel" '{ $1 = r; print }' >> "$CUR"
done < "$CONTROLLER_LIST"

TOTAL_ROUTES="$(wc -l < "$CUR" | tr -d ' ')"
if [ "$TOTAL_ROUTES" -eq 0 ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: $CONTROLLER_COUNT controller dosyası tarandı ama SIFIR rota çıkarıldı" >&2
  echo "!! — parser büyük olasılıkla bozuk. Ölçüm YAPILMADI." >&2
  exit 2
fi

INVENTORY_KEYS="$TMP/inventory-keys.txt"
awk -F'\t' '{ print $1 "|" $3 "|" $4 }' "$CUR" | LC_ALL=C sort -u > "$INVENTORY_KEYS"
INVENTORY_N="$(wc -l < "$INVENTORY_KEYS" | tr -d ' ')"

# --- sınıflandırma listelerini oku ------------------------------------------
# Format: <key><TAB># <gerekçe>  ·  '#' başlayan / boş satırlar yok sayılır.
extract_keys() {
  awk -F'\t' '
    /^[ \t]*#/ { next }
    /^[ \t]*$/ { next }
    { print $1 }
  ' "$1" | LC_ALL=C sort
}

A1_KEYS="$TMP/a1-keys.txt";  extract_keys "$A1_FILE" > "$A1_KEYS"
A2_KEYS="$TMP/a2-keys.txt";  extract_keys "$A2_FILE" > "$A2_KEYS"
B_KEYS="$TMP/b-keys.txt";    extract_keys "$B_FILE"  > "$B_KEYS"
C_KEYS="$TMP/c-keys.txt";    extract_keys "$C_FILE"  > "$C_KEYS"

for pair in "A1:$A1_KEYS" "A2:$A2_KEYS" "B:$B_KEYS" "C:$C_KEYS"; do
  name="${pair%%:*}"; path="${pair#*:}"
  if [ ! -s "$path" ]; then
    echo "!! [$GUARD_NAME] SETUP HATASI: $name listesi ($path karşılığı dosya) SIFIR anahtar içeriyor" >&2
    echo "!! Bozuk biçim ya da boş liste ölçümü güvenilmez kılar. Ölçüm YAPILMADI." >&2
    exit 2
  fi
done

UNION_KEYS="$TMP/union-keys.txt"
cat "$A1_KEYS" "$A2_KEYS" "$B_KEYS" "$C_KEYS" | LC_ALL=C sort > "$TMP/union-all.txt"
LC_ALL=C sort -u "$TMP/union-all.txt" > "$UNION_KEYS"
UNION_N="$(wc -l < "$UNION_KEYS" | tr -d ' ')"

# --- (2) TEKİLLİK — bir rota birden fazla listede mi? -----------------------
DUP_KEYS="$(LC_ALL=C sort "$TMP/union-all.txt" | uniq -d)"
if [ -n "$DUP_KEYS" ]; then
  {
    echo "!! [$GUARD_NAME] SETUP HATASI: aşağıdaki rota(lar) BİRDEN FAZLA listede sınıflandırılmış:"
    printf '%s\n' "$DUP_KEYS" | sed 's/^/!!   /'
    echo "!! Çakışan sınıflandırma ölçümü güvenilmez kılar — hangi listenin doğru olduğu"
    echo "!! elle çözülmeli (scope-a1-baseline.txt / scope-a2.txt / scope-b.txt / scope-c.txt)."
  } >&2
  exit 2
fi

# --- (1) TAMLIK — envanter \ union = ∅, değilse YENİ/sınıflandırılmamış rota -
UNCLASSIFIED="$(LC_ALL=C comm -23 "$INVENTORY_KEYS" "$UNION_KEYS")"
if [ -n "$UNCLASSIFIED" ]; then
  {
    echo "!! [$GUARD_NAME] SETUP HATASI / DUR: aşağıdaki rota(lar) HİÇBİR kapsam kovasında"
    echo "!! (A1/A2/B/C) sınıflandırılmamış:"
    printf '%s\n' "$UNCLASSIFIED" | sed 's/^/!!   /'
    echo "!!"
    echo "!! Bu bir ÜRÜN KARARI gerektirir (bu uçta kapsam ekseni var mı, uygulanıyor mu) —"
    echo "!! guard yazarı bu kararı KENDİ BAŞINA vermez (T-266). Sınıflandırıldıktan sonra"
    echo "!! satırı ilgili listeye (scope-a1-baseline.txt / scope-a2.txt / scope-b.txt /"
    echo "!! scope-c.txt) gerekçesiyle ekle."
  } >&2
  exit 2
fi

# --- (3) A1 RATCHET — working tree A1 içeriği HEAD'deki A1'den BÜYÜK mü? ----
# Taban ölçümü için `git stash` KULLANILMAZ (CLAUDE.md) — `git show HEAD:<dosya>`
# dar, kesin, geri alma gerektirmez. A1_FILE'ın YAŞADIĞI git deposu (self-test
# fixture'ında İZOLE bir geçici depo, üretimde gerçek repo) referans alınır —
# `git -C <dir> show HEAD:./<ad>` cwd'ye göreli pathspec kullanır, A1_FILE'ın
# repo köküne göre tam yolunu YENİDEN hesaplamaya gerek bırakmaz.
A1_DIR="$(cd "$(dirname "$A1_FILE")" && pwd)"
A1_BASE="$(basename "$A1_FILE")"
GIT_RATCHET_AVAILABLE=1
HEAD_A1_KEYS="$TMP/head-a1-keys.txt"
: > "$HEAD_A1_KEYS"

if ! git -C "$A1_DIR" rev-parse --git-dir > /dev/null 2>&1; then
  GIT_RATCHET_AVAILABLE=0
elif ! git -C "$A1_DIR" show "HEAD:./$A1_BASE" > "$TMP/head-a1-raw.txt" 2>/dev/null; then
  # Dosya HEAD'de yok (henüz commit edilmemiş, ilk koşum) — money-float/
  # route-scope'un "baseline bulunamadı → SKIPPED" sözleşmesiyle AYNI ruh:
  # bu bir ihlal değil, ratchet'in henüz bir referansı yok.
  GIT_RATCHET_AVAILABLE=0
else
  extract_keys "$TMP/head-a1-raw.txt" > "$HEAD_A1_KEYS" 2>/dev/null || true
fi

RAW=""
IMPROVED_MSGS=""
GONE_MSGS=""

if [ "$GIT_RATCHET_AVAILABLE" -eq 1 ]; then
  # YENİ A1 anahtarı — HEAD'de yoktu, working tree'de var → İHLAL.
  NEW_A1="$(LC_ALL=C comm -23 "$A1_KEYS" "$HEAD_A1_KEYS")"
  if [ -n "$NEW_A1" ]; then
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      RAW="${RAW}[$GUARD_NAME] ${key}
  A1'E GEREKÇESİZ EKLEME — scope-a1-baseline.txt HEAD'den beri büyüdü
  > A1 tek yön AŞAĞI bir borç defteridir (T-266, Z19b). Yeni bir debt kalemi
    ayrı, gözden geçirilebilir bir commit'te ve gerekçesiyle eklenir.
"
    done <<< "$NEW_A1"
  fi

  # HEAD'de olup working tree A1'de artık olmayan anahtarlar — İYİLEŞTİ/GONE.
  REMOVED_A1="$(LC_ALL=C comm -13 "$A1_KEYS" "$HEAD_A1_KEYS")"
  if [ -n "$REMOVED_A1" ]; then
    while IFS= read -r key; do
      [ -z "$key" ] && continue
      if ! grep -qxF "$key" "$INVENTORY_KEYS"; then
        GONE_MSGS="${GONE_MSGS}-- [$GUARD_NAME] GONE: ${key} (A1'de vardı, rota artık kod tabanında YOK — silinmiş/yeniden adlandırılmış)
"
      elif grep -qxF "$key" "$A2_KEYS" || grep -qxF "$key" "$B_KEYS" || grep -qxF "$key" "$C_KEYS"; then
        IMPROVED_MSGS="${IMPROVED_MSGS}-- [$GUARD_NAME] İYİLEŞTİ: ${key} A1'den çıktı (yeniden sınıflandırıldı ya da kapsam uygulandı)
"
      fi
      # Ne GONE ne başka listede ise: (1) TAMLIK kontrolü bunu zaten exit 2
      # ile yakalamış olurdu — bu satıra ulaşılmaz.
    done <<< "$REMOVED_A1"
  fi
else
  echo "-- [$GUARD_NAME] A1 ratchet REFERANSSIZ: $A1_FILE HEAD'de yok (ilk koşum) — büyüme kontrolü SKIP, TAMLIK/TEKİLLİK kontrolleri yine de uygulandı"
fi

[ -n "$IMPROVED_MSGS" ] && printf '%s' "$IMPROVED_MSGS"
[ -n "$GONE_MSGS" ] && printf '%s' "$GONE_MSGS"

echo "=== [$GUARD_NAME] özet ==="
echo "  rota envanteri: $INVENTORY_N  (A1 $(wc -l < "$A1_KEYS" | tr -d ' ') · A2 $(wc -l < "$A2_KEYS" | tr -d ' ') · B $(wc -l < "$B_KEYS" | tr -d ' ') · C $(wc -l < "$C_KEYS" | tr -d ' '))"
echo "  ⚠️ Bu guard kapsamın UYGULANDIĞINI ölçmez — LİSTENİN BÜYÜMEDİĞİNİ ölçer"
echo "     (T-079/T-253: statik atıf/enjeksiyon KULLANIMIN kanıtı değildir)."
echo "  ⚠️ Listeden ÇIKARMA davranışsal kanıt ister (T-253 deseni: iki farklı"
echo "     kapsamlı kullanıcı FARKLI yanıt almalı — boş sonuç FARK değildir)."
echo

[ -n "$RAW" ] && printf '%s' "$RAW"
COUNT="$(printf '%s' "$RAW" | grep -c "^\[$GUARD_NAME\]" || true)"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  echo "!! [$GUARD_NAME] A1 ratchet ihlali: yukarıdaki A1 eklemesi/eklemeleri gerekçesiz" >&2
  echo "!! yapılamaz (T-266, Z19b) — ayrı, gözden geçirilebilir bir commit gerekir." >&2
  exit 1
fi
exit 0

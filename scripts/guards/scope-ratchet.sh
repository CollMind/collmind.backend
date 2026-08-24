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
# BİÇİMİ (başlıksız ya da 'anahtar<TAB># gerekçe' şeklinde olmayan bir veri
# satırı) → exit 2 (SETUP HATASI / ÖLÇÜM YAPILMADI), TÜM modlarda.
#
# ⛔ SIFIR anahtar TEK BAŞINA artık bir SETUP HATASI DEĞİL (düzeltildi
# 2026-08-24, ADIM3_FAZB_PLAN.md "AÇIK KARAR — ratchet'in TAMAMLANDI durumu",
# seçenek b). A1'in HEDEFİ sıfıra inmektir (kapı A1'de) — eski kontrol
# extract_keys'in ÇIKTISINI (ayrıştırılan anahtar SAYISI) sınıyordu, yani
# kendi BAŞARISINI hata sayıyordu. Liste SAĞLIĞI artık BİÇİMLE (başlık +
# veri satırı şekli) ölçülür, SAYIYLA değil; sıfır anahtar, biçim sağlamsa,
# "-- RATCHET TAMAMLANDI" (A1) ya da nötr bir bilgi satırı (A2/B/C) basar,
# SESSİZCE geçilmez.
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

# --- Şart 1 (route-scope.sh ile AYNI SINIF — ADIM3_FAZB_PLAN.md "AÇIK KARAR",
# T-266/Z19b uzantısı, ürün sahibi kararı 2026-08-24): liste SAĞLIĞI anahtar
# SAYISINDAN BAĞIMSIZ ölçülür. Eskiden bu döngü extract_keys'in ÇIKTISINI
# (ayrıştırılmış anahtar sayısı) sınıyordu — ve A1 için ratchet'in AMACI onu
# SIFIRA indirmekti (kapı A1'de, Z19b), yani kontrol kendi HEDEFİNİ hata
# sayıyordu (route-scope.sh:343'ün AYNI kusuru, DÖRT kovaya uygulanmış hâli).
#
# Doğru soru: "beklenen BAŞLIK BİÇİMİ görüldü mü (ilk dolu satır '#' ile
# başlıyor mu), VE her VERİ satırı beklenen ŞEKİLDE mi (<anahtar><TAB>
# # <gerekçe>)". Bu, ayrıştırılan anahtar SAYISINDAN bağımsızdır. Kontrol
# TEK biçimde (biçim sağlığı) DÖRT listeye de AYNI uygulanır — A1/A2/B/C
# arasında bir ayrım YOK, çünkü hepsi AYNI dosya biçimini paylaşıyor
# (extract_keys'in kendisi tek bir ayrıştırıcı). Yalnız SIFIR-anahtar
# durumunun YORUMU kovaya göre farklılaşır (aşağıdaki ikinci döngü) — A1
# tek yön aşağı borç kovasıdır (kapı A1'de), A2/B/C için ratchet YOK ve
# boşalması ne beklenir ne "bozuk" sayılır (görev talimatı).
for pair in "A1:$A1_FILE" "A2:$A2_FILE" "B:$B_FILE" "C:$C_FILE"; do
  name="${pair%%:*}"; path="${pair#*:}"

  if ! head -1 "$path" 2>/dev/null | grep -q '^#'; then
    echo "!! [$GUARD_NAME] SETUP HATASI: $name listesi ($path) başlık biçimi TANINMADI." >&2
    echo "!! İlk satır '#' ile başlamalı (dört listenin de üretim biçimi) — dosya" >&2
    echo "!! bozulmuş (karakter çorbası / boş / yanlış dosya) olabilir. Ölçüm YAPILMADI." >&2
    exit 2
  fi

  MALFORMED="$(awk -F'\t' '
    /^[ \t]*#/ { next }
    /^[ \t]*$/ { next }
    NF < 2 || $2 !~ /^# / { print }
  ' "$path")"
  if [ -n "$MALFORMED" ]; then
    {
      echo "!! [$GUARD_NAME] SETUP HATASI: $name listesi TANINMAYAN satır(lar) içeriyor ($path):"
      printf '%s\n' "$MALFORMED" | sed 's/^/!!   /'
      echo "!! Her veri satırı '<anahtar><TAB># <gerekçe>' ile başlamalı (yorumlar '#'"
      echo "!! ile başlar). Bozuk biçim ölçümü güvenilmez kılar. Ölçüm YAPILMADI."
    } >&2
    exit 2
  fi
done

A1_KEYS="$TMP/a1-keys.txt";  extract_keys "$A1_FILE" > "$A1_KEYS"
A2_KEYS="$TMP/a2-keys.txt";  extract_keys "$A2_FILE" > "$A2_KEYS"
B_KEYS="$TMP/b-keys.txt";    extract_keys "$B_FILE"  > "$B_KEYS"
C_KEYS="$TMP/c-keys.txt";    extract_keys "$C_FILE"  > "$C_KEYS"

# --- Şart 2: SIFIR anahtar bir BAŞARI OLAYI olabilir, biçim SAĞLIKLIYSA -----
# (yukarıdaki döngü zaten doğruladı). SESSİZCE GEÇİLMEZ. A1 için bu mesaj
# RATCHET'İN HEDEFİNE ulaşıldığını AÇIKÇA anar (Z19b: "kapı A1'de") — A2/B/C
# için sınıflandırılmış rota kalmaması BEKLENMEZ ama "bozuk" da DEMEK
# DEĞİLDİR (görev talimatı), bu yüzden mesaj nötr kalır ve "TAMAMLANDI"
# demez (o kovaların "hedefi" sıfır değildir).
for pair in "A1:$A1_KEYS" "A2:$A2_KEYS" "B:$B_KEYS" "C:$C_KEYS"; do
  name="${pair%%:*}"; path="${pair#*:}"
  if [ ! -s "$path" ]; then
    if [ "$name" = "A1" ]; then
      echo "-- [$GUARD_NAME] RATCHET TAMAMLANDI: A1 listesi biçimi SAĞLIKLI, SIFIR anahtar"
      echo "   içeriyor — kapsam borcu kovası (A1) tamamen boşaltılmış (Z19b hedefi)."
      echo "   Bu bir BAŞARI OLAYIDIR, SETUP HATASI DEĞİL."
    else
      echo "-- [$GUARD_NAME] $name listesi BOŞ (biçim SAĞLIKLI, SIFIR anahtar) — bu"
      echo "   'bozuk' anlamına GELMEZ; $name kovasında bugün sınıflandırılmış rota yok."
    fi
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

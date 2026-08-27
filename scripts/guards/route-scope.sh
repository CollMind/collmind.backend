#!/usr/bin/env bash
#
# Guard: route-scope  (ADIM 3 Faz B `B0`, [[T-252]], K-2.6.6)
#
# ⛔ BU BİR KAPI DEĞİL, BİR RATCHET'TİR — ürün sahibi kararı, 2026-08-21.
#
# "Her rota @Roles/@Public/alan-guard'lı mı?" sorusunu "sıfır mı" diye
# sormak bugün 61 gerçek boşlukta KALICI KIRMIZI üretir. §2.7 #9: sinyal
# sabitse sinyal DEĞİLDİR — ve T-113'ün ölçülmüş sonucu böyle bir kapının
# bir hafta içinde DEVRE DIŞI bırakıldığıdır. Bu yüzden BUGÜNKÜ 61 boşluk
# BASELINE'dır ve guard yalnız ARTIŞI kırmızı yapar. Baseline B2'de,
# her uç @Roles/@RequireCapability'ye bağlandıkça AYRI COMMIT'lerle
# düşürülür (mode-split/money-float ile AYNI ratchet deseni).
#
# NE ÖLÇER
#   src/**/*.controller.ts altındaki HER rotayı AŞAĞIDAKİ kovalara ayırır
#   (sayı YAZILMAZ — kova eklendiğinde bayatlar; liste kanoniktir):
#     PUBLIC       @Public() taşıyan rota (route-level)
#     SELF         @SelfScoped() taşıyan rota (route-level) — `Z26`/`Z28`
#                  (`docs/brd-v2/04_KARAR_KAYDI.md`): "kayıt benim mi"
#                  yüklemi, bir rol kümesine BAĞLI DEĞİL. Ratchet'in KONUSU
#                  DEĞİLDİR — PUBLIC/ALAN_GUARD gibi ayrı raporlanır, ASLA
#                  "filtresiz" sayılmaz.
#     ROLES        @Roles(...) taşıyan rota (route-level) — korunuyor
#     CAPABILITY   @RequireCapability taşıyor — B3 yetenek göçü, filtresiz
#                  DEĞİL. ⚠️ Geçerliliği AYRI bir kurulum kontrolüne bağlı:
#                  aşağıdaki CAP_NO_GUARD bloğu, dekoratör varken
#                  CapabilityGuard zincirde değilse exit 2 verir (bileşimsel
#                  fail-open). Kova o kontrol olmadan bir koruma İDDİA ETMEZ.
#     ALAN_GUARD   @UseGuards(...) içinde INFRA_GUARDS DIŞINDA
#                  bir guard adı taşıyan rota (controller VEYA route level) —
#                  o guard'ın roller ZORLADIĞI VARSAYILIR (bugün ölçülmüş
#                  iki örnek: ReversalGuard, SettlementGuard — ikisi de
#                  guard'ın İÇİNDE sabit bir rol listesi taşıyor)
#     FILTRESIZ    hiçbiri — ya guard seti tümüyle boş, ya da yalnızca
#                  INFRA_GUARDS taşıyor (RolesGuard @Roles
#                  metadata'sı OKUNAMAZSA `canActivate` true döner —
#                  roles.guard.ts:16-18 — yani RolesGuard'ın TEK BAŞINA
#                  varlığı hiçbir şeyi kısıtlamaz; bu BİLGİ, kod okunarak
#                  doğrulandı, varsayılmadı)
#
#   Ratchet'in KONUSU yalnız FILTRESIZ kovasıdır. PUBLIC, SELF ve ALAN_GUARD
#   ayrı raporlanır ve ASLA "filtresiz" sayılmaz (T-252 ⛔ şartı — default-deny
#   turunda bunlar YANLIŞ TEŞHİS'e yol açar: kırılma 403 olur ve
#   "default-deny çalışıyor" sanılır).
#
#   ⚠️ `SELF_OLCUM_RAPORU.md §4` (`Z28`): `@SelfScoped()` dekoratörünü
#   TANIMAYAN bir ayrıştırıcı yeni bir `SELF` ucunu SESSİZCE FILTRESIZ'de
#   bırakır — hiçbir şey kırmızıya dönmez. Bu yüzden dekoratör + bu dördüncü
#   kova AYNI TURDA indi (`self-scoped.decorator.ts` ile birlikte).
#
# ROTA KİMLİĞİ
#   <dosya>|<YÖNTEM>|<yol>  — SATIR NUMARASI DEĞİL. mode-split'in F-satırı
#   dersiyle aynı gerekçe: dosyanın BAŞKA bir yerine eklenen/silinen bir
#   satır (ör. yeni bir import) rotanın altındaki HER decorator'ı kaydırır;
#   satır numarasını kimliğe koymak baseline'ı gürültüyle doldururdu. Satır
#   yalnız İNSAN OKUSUN diye baseline'da BİLGİ AMAÇLI tutulur, karşılaştırma
#   yalnız <dosya>|<YÖNTEM>|<yol> anahtarına bakar.
#
# ÜÇÜNCÜ BİR KORUMA KANALI — DUR
#   Bilinen guard adları: JwtAuthGuard, RolesGuard, CapabilityGuard (altyapı — rol
#   ZORLAMAZ) · ReversalGuard, SettlementGuard (alan — rol zorlar, ölçüldü).
#   INFRA_GUARDS ve KNOWN_DOMAIN_GUARDS listelerinin DIŞINDA bir @UseGuards
#   argümanı görülürse guard SETUP
#   HATASI verir (exit 2) — sessizce bir kovaya atamaz. T-252 görev
#   talimatı: "üçüncü bir koruma kanalı bulursan DUR, kapsamı kendi başına
#   genişletme." Bu kontrol o DUR'u MEKANİZMAYA bağlar.
#
# @Roles DEKORATÖRÜ YETMEZ — GUARD ZİNCİRİ de gerekir (T-252 YENİDEN AÇILDI,
#   T-267'nin kör noktası). @Roles(...) yazılmış bir rota, RolesGuard
#   CONTROLLER'da da ROTA'da da @UseGuards içinde YOKSA metadata'sı HİÇ
#   OKUNMAZ (roles.guard.ts:16-18) — RBAC KOZMETİK kalır. Bu bir kova değil,
#   KURULUM HATASIDIR: exit 2, sessizce bir kovaya sınıflandırılmaz (aşağıda
#   "@Roles YAZILMIŞ AMA RolesGuard ZİNCİRDE DEĞİL" bloğu).
#
# GUARD_MODE=block (varsayılan) → yeni FILTRESIZ rota varsa exit 1
# GUARD_MODE=report             → bulguları bas, exit 0
# --baseline                    → bugünkü FILTRESIZ envanterini stdout'a bas
# Kaynak boş / rota sayısı 0 / bilinmeyen guard / bozuk baseline BİÇİMİ
#   (başlıksız ya da 'F ' ile başlamayan bir veri satırı) →
#   exit 2 (SETUP HATASI / ÖLÇÜM YAPILMADI, tüm modlarda)
#
# ⛔ SIFIR 'F ' satırı TEK BAŞINA artık bir SETUP HATASI DEĞİL (düzeltildi
# 2026-08-24, ADIM3_FAZB_PLAN.md "AÇIK KARAR — ratchet'in TAMAMLANDI durumu",
# seçenek b). FILTRESIZ'in HEDEFİ sıfıra inmektir — eski kontrol ayrıştırılan
# 'F ' satır SAYISINI sınıyordu, yani ratchet'in kendi BAŞARISINI hata
# sayıyordu. Baseline SAĞLIĞI artık BİÇİMLE (başlık + veri satırı şekli)
# ölçülür, SAYIYLA değil; sıfır 'F ' satırı, biçim sağlamsa, görünür bir
# "-- RATCHET TAMAMLANDI" basar, SESSİZCE geçilmez.
set -uo pipefail

GUARD_NAME="route-scope"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
AWK_ROUTE="$ROOT/scripts/guards/route-scope.awk"
BASELINE="${ROUTE_SCOPE_BASELINE:-$ROOT/scripts/guards/route-scope-baseline.txt}"
# Fixture yönlendirmesi için (self-test) — üretimde set edilmez.
# FIXTURE_MODE: ROUTE_SCOPE_SRC_DIR'in KENDİSİ (varsayılana düşmeden ÖNCE)
# set edilip edilmediğini kaydeder. Team Lead ölçümü: ROUTE_SCOPE_SKIP_ROLES_
# GUARD_CHECK'i set eden BEŞ yerin BEŞİ de ROUTE_SCOPE_SRC_DIR'i de set
# ediyor — yani bu bayrak gerçek repoyu (SRC_DIR ayarlanmamış) ayırt etmek
# için YETERLİ bir sinyal. Aşağıdaki skip kontrolü BUNA bağlanır, ham env
# değişkenine değil — böylece kaçış kapısı gerçek repoda YAPISAL olarak
# kapalı kalır (bir yoruma değil bir koşula bağlı).
if [ -n "${ROUTE_SCOPE_SRC_DIR:-}" ]; then ROUTE_SCOPE_FIXTURE_MODE=1; else ROUTE_SCOPE_FIXTURE_MODE=0; fi
SRC_DIR="${ROUTE_SCOPE_SRC_DIR:-$ROOT/src}"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

if [ ! -f "$AWK_ROUTE" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: parser bulunamadı ($AWK_ROUTE)" >&2
  exit 2
fi

if [ ! -d "$SRC_DIR" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: kaynak dizini bulunamadı: $SRC_DIR — ölçüm YAPILMADI" >&2
  exit 2
fi

# --- kaynak: her controller.ts dosyası ayrı invocation (dosyalar arası -----
# durum SIZMASIN — app-runtime-grants-entities.awk'ın deseni) ---------------
# `mapfile` KULLANILMADI: bu ortamın varsayılan bash'i 3.2'dir (macOS), ve
# mapfile/readarray bash 4+ gerektirir — sessizce "command not found" verip
# CONTROLLER_FILES boş kalırdı (SETUP HATASI dalı bunu yakalardı ama gerekçe
# yanlış olurdu: "0 dosya" değil "araç yok" olduğu görünmezdi).
CONTROLLER_LIST="$(mktemp)"
find "$SRC_DIR" -type f -name "*.controller.ts" | LC_ALL=C sort > "$CONTROLLER_LIST"
CONTROLLER_COUNT="$(wc -l < "$CONTROLLER_LIST" | tr -d ' ')"

if [ "$CONTROLLER_COUNT" -eq 0 ]; then
  # T-250 dersi (ADIM 3 lesson 1): kaynak boş türetilirse SESSİZCE YEŞİL
  # DEĞİL — SETUP HATASI. "yeni \ baseline = ∅ çünkü yeni = ∅" tuzağı.
  echo "!! [$GUARD_NAME] SETUP HATASI: $SRC_DIR altında hiç *.controller.ts bulunamadı." >&2
  echo "!! Bu, deseni bozan bir değişikliğin (yanlış kapsam, taşınan dizin) sonucu" >&2
  echo "!! olabilir. Boş küme sessizce 'temiz' sayılırsa guard körleşir — ölçüm YAPILMADI." >&2
  exit 2
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$CONTROLLER_LIST"' EXIT
CUR="$TMP/routes.tsv"
: > "$CUR"
# SRC_DIR'in EBEVEYNİNE göre göreli — $ROOT'a göre DEĞİL. İkisi üretimde
# aynı şeydir ($SRC_DIR=$ROOT/src), ama self-test SRC_DIR'i bir fixture
# ağacına yönlendirdiğinde (ROUTE_SCOPE_SRC_DIR) $ROOT hâlâ GERÇEK repo
# köküdür — rel hesaplaması $ROOT'a göre kalsaydı fixture yolları hiç
# kısalmaz, baseline anahtarlarıyla ASLA eşleşmezdi (her fixture rotası
# yanlışlıkla "YENİ" görünürdü — ölçüldü, ilk taslakta).
SRC_PARENT="$(cd "$(dirname "$SRC_DIR")" && pwd)"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  rel="${f#"$SRC_PARENT"/}"
  # $f MUTLAK yolla okunur (cwd $ROOT'tur, fixture ağacı $ROOT'un altında
  # OLMAYABİLİR — üretimde $ROOT/src altındadır, self-test'te değildir).
  # Çıktının ilk sütunu (dosya adı, awk'ın FILENAME'i) sonradan $rel ile
  # DEĞİŞTİRİLİR — baseline anahtarları hep REPO-GÖRELİ biçimde kalsın diye.
  awk -f "$AWK_ROUTE" "$f" | awk -F'\t' -v OFS='\t' -v r="$rel" '{ $1 = r; print }' >> "$CUR"
done < "$CONTROLLER_LIST"

TOTAL_ROUTES="$(wc -l < "$CUR" | tr -d ' ')"
if [ "$TOTAL_ROUTES" -eq 0 ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: $CONTROLLER_COUNT controller dosyası tarandı" >&2
  echo "!! ama SIFIR rota çıkarıldı — parser büyük olasılıkla bozuk (girinti/dekoratör" >&2
  echo "!! deseni değişmiş olabilir). Ölçüm YAPILMADI." >&2
  exit 2
fi

# --- bilinen guard sözlüğü — ÜÇÜNCÜ KANAL DUR'u ------------------------------
# Env override'lar SELF-TEST için (fixture'lar gerçek Reversal/SettlementGuard
# adlarını KULLANMAZ — kendi sentetik adlarını kullanır ki üretim listesiyle
# YANLIŞLIKLA örtüşüp kanalı yanlış doğrulamasın; migration-schema.sh'in
# GUARD_MIG_DIR deseniyle aynı aile).
# CapabilityGuard neden INFRA: ⚠️ REVİZE (A-prime review S1, 2026-08-27) —
# ~~capability.guard.ts:38-40: yetenek metadata'sı YOKSA canActivate TRUE
# döner~~ ARTIK YANLIŞ: `B4 A-prime` guard'ı DEFAULT-DENY yaptı, metadata
# yokken FALSE döner. Cümle `A-prime` altında AKTİF-YANLIŞTI ve bu bloğun
# YÜRÜRLÜKTEKİ gerekçesiydi. YENİ GEREKÇE (sınıflandırma DEĞİŞMİYOR, yalnız
# dayanağı): CapabilityGuard bir YETENEK kapısıdır, bir ALAN kapısı değil —
# ALAN_GUARD kovası "rota kendi erişimini KENDİ domain-guard'ı ile zorluyor"
# demektir; CapabilityGuard bunu YAPMAZ, yetenek bildirimine bakar. DOMAIN sayılsaydı yalnız CapabilityGuard
# taşıyan (ama @RequireCapability taşımayan) bir rota ALAN_GUARD = "korunuyor"
# diye sınıflanırdı — oysa KORUMASIZ. INFRA fail-safe taraftır; fixture ile
# ölçüldü (Dalga-M/W1 review D): DOMAIN altında böyle bir rota FILTRESIZ'den
# çıkıyor, INFRA altında çıkmıyor.
INFRA_GUARDS=" ${ROUTE_SCOPE_INFRA_GUARDS:-JwtAuthGuard RolesGuard CapabilityGuard} "
KNOWN_DOMAIN_GUARDS=" ${ROUTE_SCOPE_DOMAIN_GUARDS:-ReversalGuard SettlementGuard} "

UNKNOWN="$(awk -F'\t' '
  $7 != "-" {
    n = split($7, g, ",")
    for (i = 1; i <= n; i++) print g[i]
  }
' "$CUR" | sort -u | while read -r name; do
  [ -z "$name" ] && continue
  if [[ "$INFRA_GUARDS" == *" $name "* ]]; then continue; fi
  if [[ "$KNOWN_DOMAIN_GUARDS" == *" $name "* ]]; then continue; fi
  echo "$name"
done)"

if [ -n "$UNKNOWN" ]; then
  {
    echo "!! [$GUARD_NAME] SETUP HATASI / DUR: bilinmeyen guard adı(ları) bulundu:"
    printf '%s\n' "$UNKNOWN" | sed 's/^/!!   /'
    echo "!! Bilinen kanallar: JwtAuthGuard, RolesGuard, CapabilityGuard (altyapı) · ReversalGuard,"
    echo "!! SettlementGuard (alan — rol zorluyor). Bunların DIŞINDA bir isim ÜÇÜNCÜ"
    echo "!! bir koruma kanalı olabilir — T-252: 'kapsamı kendi başına genişletme,"
    echo "!! DUR'. Bu guard onu otomatik sınıflandırmaz; ölçüm YAPILMADI."
  } >&2
  exit 2
fi

# --- @Roles YAZILMIŞ AMA RolesGuard ZİNCİRDE DEĞİL — KURULUM HATASI --------
# (T-252 YENİDEN AÇILDI, T-267'nin kör noktası, 2026-08-22)
#
# roles.guard.ts:16-18: requiredRoles metadata'sı bulunamazsa canActivate
# TRUE döner. Yani @Roles(...) dekoratörü YAZILMIŞ olsa bile, RolesGuard
# zincirde (CONTROLLER YA DA ROTA seviyesinde @UseGuards içinde) YOKSA o
# metadata HİÇ OKUNMAZ ve dekoratör KOZMETİK kalır — RBAC UYGULANMAZ.
#
# ⛔ Bu bir KOVA (FILTRESIZ/ROLES/PUBLIC/ALAN_GUARD) DEĞİL — bir KURULUM
# HATASIDIR: "@Roles yazılmış ama okunmuyor" bir sınıflandırma sorusu değil,
# guard zincirinin YANLIŞ KURULDUĞUNUN kanıtıdır. T-267 aynı hatayı iki
# controller'da (settlement.controller sınıf seviyesi · auth.controller
# logout rota seviyesi) BULUP düzelttiği için bu kontrol bugün 0 bulguyla
# geçer — ama düzeltme kalıcı değildir, bir sonraki @Roles eklendiğinde
# RolesGuard unutulabilir. Ratchet değil KAPI: bu bir kurulum hatası, ratchet
# konusu (K-2.6.6, tanımlanmamış uç) değil.
#
# guardsCSV ($7) zaten CONTROLLER (cg) ve ROTA (rg) seviyesi guard adlarının
# BİRLEŞİMİ (route-scope.awk: csv_from_sets(cg, rg)) — yani TEK bir token
# taraması HER İKİ seviyeyi de kapsar; seviye ayrımı için ayrı kod GEREKMEZ
# (İlke: mevcut mekanizmayı yeniden kullan).
#
# ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1 — YALNIZ self-test için. S/2/3/4a/4b
# kanal-bağımsızlığı testleri route-scope.awk'ın @UseGuards TANIMASINI
# KASTEN bozuyor — ve o AYNI mekanizma RolesGuard'ı da topluyor (rg/cg). O
# testler SINIFLANDIRMA mantığını (FILTRESIZ/PUBLIC/ALAN_GUARD ayrımını)
# sınıyor, bu KURULUM HATASI kontrolünü değil; bu değişken olmadan o
# testlerin paylaştığı $SRC_DIR'e bu kontrolü tetikleyecek bir @Roles+
# RolesGuard rotası eklemek, kendi konusu OLMAYAN bir SETUP HATASI'yla
# kırılırlardı (route-scope-self-test.sh'in G-serisi bu kontrolü AYRI,
# izole fixture'larla, bu değişken OLMADAN sınar).
#
# ⛔ BU BAYRAK YALNIZ FIXTURE MODUNDA ONURLANDIRILIR (ROUTE_SCOPE_FIXTURE_MODE
# — yani ROUTE_SCOPE_SRC_DIR set edilmişse). GERÇEK REPODA (SRC_DIR set
# DEĞİLse) YOK SAYILIR — kontrol HER ZAMAN koşar. Gerekçe: "doğrulama bir
# KAPIDIR — durdurmuyorsa doğrulama değildir" ve bir kontrolü kapatabilen bir
# bayrak, kapatıldığında SESSİZ olur ve o kontrol artık bir kapı değildir.
# Ölçüldü (Team Lead, 2026-08-22): bu bayrağı set eden BEŞ yerin BEŞİ de
# ROUTE_SCOPE_SRC_DIR'i de set ediyor (self-test'in run()/R1/R2/R3/CASE U
# çağrıları) — yani bu koşul gerçek repoyu güvenilir şekilde ayırt eder.
# Üretimde (npm run guards, gerçek src/ taraması) bu bayrak HİÇBİR ZAMAN
# set edilmez VE set edilse bile FIXTURE_MODE=0 olduğu için YOK SAYILIR.
if [ "${ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK:-0}" = "1" ] && [ "$ROUTE_SCOPE_FIXTURE_MODE" = "1" ]; then
  : # fixture modunda bilinçli atlama — aşağıdaki blok koşulun DIŞINDA kalır
else
  ROLES_NO_GUARD="$(awk -F'\t' '
    $5 == 1 {
      has_rg = 0
      if ($7 != "-") {
        n = split($7, g, ",")
        for (i = 1; i <= n; i++) if (g[i] == "RolesGuard") { has_rg = 1; break }
      }
      if (!has_rg) printf "%s|%s|%s\n", $1, $3, $4
    }
  ' "$CUR")"

  if [ -n "$ROLES_NO_GUARD" ]; then
    {
      echo "!! [$GUARD_NAME] SETUP HATASI: @Roles taşıyan rota(lar) RolesGuard ZİNCİRDE DEĞİL:"
      printf '%s\n' "$ROLES_NO_GUARD" | sed 's/^/!!   /'
      echo "!! @Roles DEKORATÖRÜ YETMEZ — GUARD ZİNCİRİ de gerekir. roles.guard.ts:16-18:"
      echo "!! requiredRoles metadata'sı bulunamazsa canActivate TRUE döner; yani RolesGuard"
      echo "!! (CONTROLLER ya da ROTA seviyesinde @UseGuards içinde) zincirde olmadan bu"
      echo "!! metadata HİÇ OKUNMAZ ve @Roles KOZMETİK kalır. Çözüm: @UseGuards(...,"
      echo "!! RolesGuard) ekleyin (sınıf ya da rota seviyesi fark etmez — guardsCSV"
      echo "!! ikisinin birleşimidir). Bu bir KOVA DEĞİL, KURULUM HATASIDIR (T-252"
      echo "!! YENİDEN AÇILDI, T-267'nin kör noktası)."
    } >&2
    exit 2
  fi

  # ── İKİZ KONTROL (Dalga-M/W1 review S-3): @RequireCapability için AYNISI.
  # Bu blok olmadan CAPABILITY kovası, DOĞRULAYAMADIĞI bir korumayı iddia
  # ediyordu: kovanın geçerliliği single-mechanism.sh KURAL 2'ye yaslanıyordu
  # ve o bağ hiçbir yerde YAZILI DEĞİLDİ. Ölçüldü: iki controller'dan
  # CapabilityGuard cikarilinca single-mechanism rc=3 verdi ama route-scope
  # rc=0 ile "CAPABILITY: 3, filtresiz DEGIL" demeye DEVAM ETTI — kör.
  # T-111 port dersi: davranisi dogru kilan baglam TASINMAZ, ya beraber
  # tasinir ya davranis degisir. Veri zaten tuple'da (7. ve 9. sutun),
  # ikinci bir ayristirici GEREKMEZ.
  CAP_NO_GUARD="$(awk -F'\t' '
    $9 == 1 {
      has_cg = 0
      if ($7 != "-") {
        n = split($7, g, ",")
        for (i = 1; i <= n; i++) if (g[i] == "CapabilityGuard") { has_cg = 1; break }
      }
      if (!has_cg) printf "%s|%s|%s\n", $1, $3, $4
    }
  ' "$CUR")"

  if [ -n "$CAP_NO_GUARD" ]; then
    {
      echo "!! [$GUARD_NAME] SETUP HATASI: @RequireCapability taşıyan rota(lar) CapabilityGuard ZİNCİRDE DEĞİL:"
      printf '%s\n' "$CAP_NO_GUARD" | sed 's/^/!!   /'
      echo "!! @RequireCapability DEKORATÖRÜ YETMEZ — GUARD ZİNCİRİ de gerekir."
      echo "!! capability.guard.ts (A-prime sonrasi, 2026-08-27): guard ZINCIRDE ise"
      echo "!! ve yetenek metadata'si YOKSA canActivate FALSE doner (DEFAULT-DENY)."
      echo "!! Ama guard ZINCIRDE DEGILSE metadata HIC OKUNMAZ; ve @Roles de"
      echo "!! kaldırıldığı için RolesGuard da true döner ⇒ rota HER kimliği"
      echo "!! doğrulanmış kullanıcıya AÇILIR (BİLEŞİMSEL FAIL-OPEN, Dalga-M S2)."
      echo "!! Bu bir KOVA DEĞİL, KURULUM HATASIDIR."
    } >&2
    exit 2
  fi
fi

# --- sınıflandırma -----------------------------------------------------------
# bucket: PUBLIC | SELF | ROLES | ALAN_GUARD | FILTRESIZ
#
# Öncelik sırası: PUBLIC > SELF > ROLES > ALAN_GUARD > FILTRESIZ. `SELF`
# `ROLES`'ten ÖNCE kontrol edilir — `Z26`'nın göç ettirdiği uçlarda `@Roles`
# zaten kaldırılmıştır, ama sıra bir rotanın YANLIŞLIKLA iki işaret taşıdığı
# (geçiş anı) durumda da `SELF`'in `ROLES`'e YUTULMAMASINI garanti eder.
classify() {
  awk -F'\t' -v domain="$KNOWN_DOMAIN_GUARDS" '
    function has_domain(csv,    n, g, i) {
      if (csv == "-") return 0
      n = split(csv, g, ",")
      for (i = 1; i <= n; i++) if (index(domain, " " g[i] " ") > 0) return 1
      return 0
    }
    {
      key = $1 "|" $3 "|" $4
      if ($6 == 1) bucket = "PUBLIC"
      else if ($8 == 1) bucket = "SELF"
      else if ($5 == 1) bucket = "ROLES"
      # T-284 on kosulu (Dalga-M review S3): @RequireCapability tasiyan rota
      # FILTRESIZ DEGILDIR — yetenek kapisiyla korunuyor. Kova ROLES sonrasi
      # gelir; ikisini birden tasiyan bir rota single-mechanism.sh tarafindan
      # ZATEN engelleniyor (exit 3), yani bu sira bir tie-break degil.
      # Z26/Z28 emsali: @SelfScoped turunda dekoratorle AYNI TURDA
      # siniflandiriciya SELF kovasi eklenmisti; eklenmeseydi yeni uclar hic
      # kirmiziya donmeden FILTRESIZ kovasina duserdi. Ayni ders, yeni kovada.
      # (APOSTROF YOK: bu blok tek-tirnakli bir awk programinin ICINDE.)
      else if ($9 == 1) bucket = "CAPABILITY"
      else if (has_domain($7)) bucket = "ALAN_GUARD"
      else bucket = "FILTRESIZ"
      printf "%s\t%s\t%s\t%s\t%s\t%s\n", bucket, key, $1, $2, $3, $4
    }
  ' "$CUR"
}
CLASSIFIED="$TMP/classified.tsv"
classify > "$CLASSIFIED"

PUBLIC_N="$(awk -F'\t' '$1=="PUBLIC"' "$CLASSIFIED" | wc -l | tr -d ' ')"
SELF_N="$(awk -F'\t' '$1=="SELF"' "$CLASSIFIED" | wc -l | tr -d ' ')"
ROLES_N="$(awk -F'\t' '$1=="ROLES"' "$CLASSIFIED" | wc -l | tr -d ' ')"
ALAN_N="$(awk -F'\t' '$1=="ALAN_GUARD"' "$CLASSIFIED" | wc -l | tr -d ' ')"
CAP_N="$(awk -F'\t' '$1=="CAPABILITY"' "$CLASSIFIED" | wc -l | tr -d ' ')"
FILTRESIZ_N="$(awk -F'\t' '$1=="FILTRESIZ"' "$CLASSIFIED" | wc -l | tr -d ' ')"

# --- --list-roles: bugünkü ROLES envanterini bas (LİSTE, sayı DEĞİL) -------
# `roles-ratchet.sh`'ın kaynağı — İKİNCİ bir parser YAZILMADI (İlke: mevcut
# mekanizmayı yeniden kullan, `route-scope.sh`'ın kendi yorumundaki ders).
if [ "${1:-}" = "--list-roles" ]; then
  echo "# route-scope ROLES envanteri — B4 A′ kalan-@Roles ratchet kaynağı (Z44)"
  echo "# date:    $(date +%Y-%m-%d)"
  echo "# commit:  $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "# scope:   $TOTAL_ROUTES rota (src/**/*.controller.ts, $CONTROLLER_COUNT dosya)"
  echo "# format:  R <dosya>|<YÖNTEM>|<yol> <satır>"
  echo "#   anahtar <dosya>|<YÖNTEM>|<yol> — RATCHET yalnız bunu karşılaştırır."
  awk -F'\t' '$1=="ROLES" { printf "R %s %s\n", $2, $4 }' "$CLASSIFIED" | LC_ALL=C sort
  exit 0
fi

# --- --list-alan-guard: bugünkü ALAN_GUARD envanterini bas (LİSTE, sayı
# DEĞİL) — `alan-guard-ratchet.sh`'ın kaynağı, `--list-roles` İLE AYNI
# ŞEKİL (İKİNCİ bir parser YAZILMADI).
if [ "${1:-}" = "--list-alan-guard" ]; then
  echo "# route-scope ALAN_GUARD envanteri — B4 A′ keskinleştirme-2 ratchet kaynağı (Z44)"
  echo "# date:    $(date +%Y-%m-%d)"
  echo "# commit:  $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "# scope:   $TOTAL_ROUTES rota (src/**/*.controller.ts, $CONTROLLER_COUNT dosya)"
  echo "# format:  G <dosya>|<YÖNTEM>|<yol> <satır>"
  echo "#   anahtar <dosya>|<YÖNTEM>|<yol> — RATCHET yalnız bunu karşılaştırır."
  awk -F'\t' '$1=="ALAN_GUARD" { printf "G %s %s\n", $2, $4 }' "$CLASSIFIED" | LC_ALL=C sort
  exit 0
fi

# --- --baseline: bugünkü FILTRESIZ envanterini bas (LİSTE, sayı DEĞİL) ------
if [ "${1:-}" = "--baseline" ]; then
  echo "# route-scope baseline — ADIM 3 Faz B B0 ratchet reference (T-252)"
  echo "# date:    $(date +%Y-%m-%d)"
  echo "# commit:  $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "# scope:   $TOTAL_ROUTES rota (src/**/*.controller.ts, $CONTROLLER_COUNT dosya)"
  echo "# format:  F <dosya>|<YÖNTEM>|<yol> <satır>"
  echo "#   anahtar <dosya>|<YÖNTEM>|<yol> — RATCHET yalnız bunu karşılaştırır."
  echo "#   <satır> BİLGİ AMAÇLIDIR (mode-split F-satırı deseni) — dosyanın"
  echo "#   başka bir yerine eklenen/silinen bir satır anahtarı DEĞİŞTİRMEZ,"
  echo "#   yalnız bu sütunu bayatlatır. Bu dosya KENDİNİ YAZMAZ — B2'de her"
  echo "#   uç bağlandıkça AYRI, gözden geçirilebilir bir commit'te güncellenir."
  awk -F'\t' '$1=="FILTRESIZ" { printf "F %s %s\n", $2, $4 }' "$CLASSIFIED" | LC_ALL=C sort
  exit 0
fi

# --- kova özeti (HER ZAMAN basılır — GUARD_MODE'dan bağımsız) ---------------
echo "=== [$GUARD_NAME] kovalar ==="
echo "  FILTRESIZ (ratchet'in konusu): $FILTRESIZ_N"
awk -F'\t' '$1=="FILTRESIZ" { print "    " $2 }' "$CLASSIFIED" | LC_ALL=C sort | sed -n '1,5p'
[ "$FILTRESIZ_N" -gt 5 ] && echo "    ... (+$((FILTRESIZ_N - 5)) diğer)"
echo "  PUBLIC (bilinçli açık): $PUBLIC_N"
awk -F'\t' '$1=="PUBLIC" { print "    " $2 }' "$CLASSIFIED" | LC_ALL=C sort
echo "  SELF (kimlik-yüklemli, filtresiz DEĞİL — Z26/Z28): $SELF_N"
awk -F'\t' '$1=="SELF" { print "    " $2 }' "$CLASSIFIED" | LC_ALL=C sort
echo "  ALAN_GUARD (guard içinde rol zorluyor, filtresiz DEĞİL): $ALAN_N"
awk -F'\t' '$1=="ALAN_GUARD" { print "    " $2 }' "$CLASSIFIED" | LC_ALL=C sort
echo "  CAPABILITY (@RequireCapability — B3 göçü, filtresiz DEĞİL): $CAP_N"
awk -F'\t' '$1=="CAPABILITY" { print "    " $2 }' "$CLASSIFIED" | LC_ALL=C sort
echo "  (bilgi) ROLES: $ROLES_N · TOPLAM rota: $TOTAL_ROUTES"
echo

if [ ! -f "$BASELINE" ]; then
  # mode-split ile AYNI sözleşme: baseline yoksa SKIPPED (exit 0) — ilk
  # --baseline koşumundan ÖNCEki meşru geçiş durumu. run-all.sh SKIPPED'i
  # kaynak-kod guard'ı için kurulum hatası sayar (SKIPPED_BAD) — o güvenceyi
  # sağlayan bu guard DEĞİL, RUNNER'dır (mode-split'in aynı yorumunun
  # tekrarı, T-111'in port dersi: bu satırı güvenli kılan bağlamı da taşı).
  echo "-- [$GUARD_NAME] SKIPPED: baseline bulunamadı ($BASELINE)"
  exit 0
fi

# --- ratchet karşılaştırması -------------------------------------------------
# FULL_KEY_SET: bugünkü HER rotanın kovası (GONE/İYİLEŞTİ ayrımı için).
awk -F'\t' '{ print $2 "\t" $1 }' "$CLASSIFIED" | LC_ALL=C sort -u > "$TMP/full-keys.tsv"
awk -F'\t' '$1=="FILTRESIZ" { print $2 }' "$CLASSIFIED" | LC_ALL=C sort -u > "$TMP/cur-filtresiz-keys.txt"

# baseline'ı ayrıştır — F <key> <line>
BASE_KEYS="$TMP/base-keys.txt"
awk '/^F /{ print $2 }' "$BASELINE" | LC_ALL=C sort -u > "$BASE_KEYS"

# --- Şart 1 (ADIM3_FAZB_PLAN.md "AÇIK KARAR — ratchet'in TAMAMLANDI durumu",
# seçenek b, ürün sahibi kararı 2026-08-24): ayrıştırma SAĞLIĞI 'F ' satır
# SAYISINDAN BAĞIMSIZ ölçülür. Eskiden bu kontrol "SIFIR 'F ' satırı ayrıştı
# mı" diye soruyordu — ve ratchet'in AMACI FILTRESIZ'i (ve bu baseline'ı) tam
# olarak SIFIRA indirmekti; yani kontrol kendi BAŞARISINI hata sayıyordu.
# (§2.7 #9'un yeni bir biçimi — "bir kuralın doğru olduğunu kırmızıya
# dönmemesinden çıkarma; o kuralın reddedeceği girdi ona ULAŞIYOR mu?"
# FILTRESIZ bugüne kadar hiç 0 olmadığı için bu dal hiç koşmamıştı; SELF
# turu — Z26/Z27/Z28 — ilk kez ulaştı ve duvara çarptı.)
#
# Doğru soru: "beklenen BAŞLIK BİÇİMİ görüldü mü (ilk dolu satır '#' ile
# başlıyor mu), VE her VERİ satırı beklenen ŞEKİLDE mi ('F ' ile başlıyor
# mu)". Bu, ayrıştırılan anahtar SAYISINDAN bağımsızdır: sıfır 'F ' satırı,
# başlık ve satır şekli sağlamsa, RATCHET'İN HEDEFİNE ULAŞILDIĞININ (B0/B2
# tamamlandı) göstergesidir. Başlık YOKSA (dosya tümüyle boş/gövdesiz) ya da
# bir VERİ satırı 'F ' ile başlamıyorsa (karakter çorbası, yanlış dosya,
# yarım yazma) bu bozukluktur — `--baseline` HER ZAMAN önce başlığı yazar,
# yani gerçekten tamamlanmış bir baseline başlıksız OLAMAZ.
if ! head -1 "$BASELINE" 2>/dev/null | grep -q '^#'; then
  echo "!! [$GUARD_NAME] SETUP HATASI: baseline başlık biçimi TANINMADI ($BASELINE)." >&2
  echo "!! İlk satır '#' ile başlamalı (route-scope.sh --baseline HER ZAMAN önce" >&2
  echo "!! başlığı yazar) — dosya bozulmuş (karakter çorbası / boş / yanlış dosya)" >&2
  echo "!! olabilir. Ölçüm YAPILMADI." >&2
  exit 2
fi

MALFORMED_BASE_LINES="$(grep -vE '^(#|[[:space:]]*$|F )' "$BASELINE" || true)"
if [ -n "$MALFORMED_BASE_LINES" ]; then
  {
    echo "!! [$GUARD_NAME] SETUP HATASI: baseline TANINMAYAN satır(lar) içeriyor ($BASELINE):"
    printf '%s\n' "$MALFORMED_BASE_LINES" | sed 's/^/!!   /'
    echo "!! Her veri satırı 'F <anahtar> <satır>' ile başlamalı (yorumlar '#' ile"
    echo "!! başlar). Bozuk biçim ölçümü güvenilmez kılar. Ölçüm YAPILMADI."
  } >&2
  exit 2
fi

# --- Şart 2: SIFIR 'F ' satırı bir BAŞARI OLAYI olabilir, biçim SAĞLIKLIYSA -
# (yukarıdaki iki kontrol zaten doğruladı). SESSİZCE GEÇİLMEZ — B4'ün ön
# koşulu (FILTRESIZ = 0) tam bu satırı okuyacak.
if [ ! -s "$BASE_KEYS" ]; then
  echo "-- [$GUARD_NAME] RATCHET TAMAMLANDI: baseline biçimi SAĞLIKLI, SIFIR 'F '"
  echo "   satırı içeriyor — FILTRESIZ kovası tamamen boşaltılmış (B0/B2 hedefine"
  echo "   ulaşıldı). Bu bir BAŞARI OLAYIDIR, SETUP HATASI DEĞİL."
fi

RAW=""

# 1) YENİ filtresiz rota — baseline'da yok → İHLAL (bloklayan taraf).
while IFS= read -r key; do
  [ -z "$key" ] && continue
  if ! grep -qxF "$key" "$BASE_KEYS"; then
    file="${key%%|*}"
    RAW="${RAW}[$GUARD_NAME] ${file}:new-route
  YENİ FİLTRESİZ ROTA — baseline'da yok (ADIM 3 Faz B B0 ratchet)
  > anahtar: ${key}
  > çözüm: @Roles(...) ekle, @Public() ile bilinçli işaretle, ya da bir
    alan-guard'ı ile koru. Kademeli yol (K4/B2) ise: bu PR'da EKLEME —
    yeni rota BASELINE'A doğmaz (ADR 0007 Karar 8.2 ile aynı ilke: yeni
    kod filtresiz doğmaz).
"
  fi
done < "$TMP/cur-filtresiz-keys.txt"

# 2) baseline'daki bir anahtar bugün ARTIK filtresiz değil / hiç yok —
#    bilgi amaçlı, bloklamaz (mode-split'in "silme sessizce geçer" ilkesinin
#    GÖRÜNÜR hâli — money-float'ın "improved" mesajı gibi, T-252'nin
#    üçüncü sınavı: "baseline'daki bir rota @Roles kazanınca ne olur?").
IMPROVED=0
GONE=0
while IFS= read -r key; do
  [ -z "$key" ] && continue
  bucket="$(awk -F'\t' -v k="$key" '$1==k{print $2; exit}' "$TMP/full-keys.tsv")"
  if [ -z "$bucket" ]; then
    echo "-- [$GUARD_NAME] GONE: ${key} (baseline'da vardı, bugün rota HİÇ yok — silinmiş/yeniden adlandırılmış). Baseline satırını aynı commit'te düş."
    GONE=$((GONE + 1))
  elif [ "$bucket" != "FILTRESIZ" ]; then
    echo "-- [$GUARD_NAME] İYİLEŞTİ: ${key} artık ${bucket} (baseline'da FILTRESIZ'di). Baseline'ı AYRI bir commit'te güncelle: route-scope.sh --baseline > scripts/guards/route-scope-baseline.txt"
    IMPROVED=$((IMPROVED + 1))
  fi
  # bucket == FILTRESIZ → sessiz, steady state (mode-split ile AYNI).
done < "$BASE_KEYS"

[ "$IMPROVED" -gt 0 ] || [ "$GONE" -gt 0 ] && echo

report_guard "$RAW"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  echo "!! [$GUARD_NAME] B0 ratchet ihlali: yukarıdaki YENİ filtresiz rota(lar)" >&2
  echo "!! baseline'a EKLENEMEZ — K-2.6.6 (tanımlanmamış uç herkese açık)." >&2
  exit 1
fi
exit 0

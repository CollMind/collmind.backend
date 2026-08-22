#!/usr/bin/env bash
#
# self-test — route-scope (ADIM 3 Faz B `B0`, [[T-252]]).
#
# Gerçek guard'ı (`route-scope.sh`) fixture ağacına ENV override'larıyla
# (`ROUTE_SCOPE_SRC_DIR` / `ROUTE_SCOPE_BASELINE` / `ROUTE_SCOPE_DOMAIN_GUARDS`)
# yönlendirerek çağırır — mantığın hiçbir parçasını YENİDEN UYGULAMAZ (ADR
# 0007 E16: bir kontrolü sınayan test, o kontrolün kopyasını çalıştırmaz).
#
# --- DÖRT (+BİR) KANAL, HER BİRİ AYRI POZİTİF KONTROL (T-250 dersi) --------
#
#   1. rota dekoratörü   @Get/@Post/@Patch/@Put/@Delete  — "SPINE" kanalı:
#      bu kanal ölürse flush_pending() hiçbir şey basmaz (route-scope.awk'ın
#      p_has_http kapısı) — yani bu kanalın kırılması TÜM rotaları
#      SESSİZLEŞTİRİR, tek bir rotayı yanlış sınıflandırmaz. Bu, diğer
#      kanallardan YAPISAL OLARAK farklı bir başarısızlık şekli ve ayrı
#      test edilir (case S).
#   2. @Roles             — route-scope.awk:130
#   3. @Public             — route-scope.awk:132
#   4a. @UseGuards ROTA seviyesi    — route-scope.awk:134 (rg kümesi)
#   4b. @UseGuards CONTROLLER seviyesi — route-scope.awk:120 (cg kümesi)
#      ⚠️ 4a/4b AYRI test edilir — settlement.controller.ts (rota) ile
#      reversal.controller.ts (controller) arasındaki GERÇEK asimetrinin
#      aynısı (T-252 görev talimatı, "gerçek bir tuzak").
#
# Her mutasyon SIRAYLA uygulanır, ÖNCEKİNİN geri alındığı shasum ile
# doğrulanmadan bir sonrakine geçilmez (app-runtime-grants'ın deseni).
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/route-scope.sh"
AWK_ROUTE="$DIR/route-scope.awk"
FIXDIR="$DIR/fixtures/route-scope"

if [ ! -f "$GUARD" ] || [ ! -f "$AWK_ROUTE" ]; then
  echo "!! self-test: route-scope.sh/route-scope.awk yok" >&2
  exit 1
fi
if [ ! -d "$FIXDIR" ]; then
  echo "!! self-test: fixtures/route-scope/ eksik — guard doğrulanamıyor" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SRC_DIR="$TMP/src"
mkdir -p "$SRC_DIR"
for f in "$FIXDIR"/*.controller.ts.fixture; do
  cp "$f" "$SRC_DIR/$(basename "$f" .fixture)"
done

# Ratchet gürültüsü İSTEMEDEN salt SINIFLANDIRMA sınamak için: var olmayan
# bir baseline yolu → route-scope.sh "SKIPPED: baseline bulunamadı" der
# (exit 0), üç kova özeti YİNE basılır (baseline kontrolünden ÖNCE basılıyor
# — route-scope.sh'in kendi sırası).
NO_BASELINE="$TMP/no-such-baseline.txt"

FAIL=0

# ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1: bu grubun testleri (CASE 1, S, 2, 3,
# 4a, 4b, R1-R3) route-scope.awk'ın @UseGuards TANIMASINI kasten bozuyor —
# ve o AYNI mekanizma RolesGuard'ı da topluyor (cg/rg). Bu grup SINIFLANDIRMA
# mantığını (FILTRESIZ/PUBLIC/ALAN_GUARD ayrımını) sınıyor, "@Roles var ama
# RolesGuard yok" KURULUM HATASI kontrolünü değil — ve fixture-plain'in
# 'roled'/'roled-multiline' rotaları o kontrolü KASITLI OLARAK RolesGuard'sız
# bırakıyor (yalnız ROLES bucket sınıflandırmasını sınamak için). Bu bayrak
# olmadan o kontrol devreye girer ve bu grubun HİÇBİRİ kendi konusu OLMAYAN
# bir SETUP HATASI'yla kırılırdı. Yeni kontrol AŞAĞIDA, İZOLE fixture'larla,
# bu bayrak OLMADAN ayrıca sınanıyor (CASE G).
run() { # [extra env already exported by caller]
  ROUTE_SCOPE_SRC_DIR="$SRC_DIR" ROUTE_SCOPE_BASELINE="$NO_BASELINE" \
    ROUTE_SCOPE_DOMAIN_GUARDS="FixtureDomainGuard" \
    ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1 \
    GUARD_MODE=report bash "$GUARD"
}

# =============================================================================
# CASE 1 — sınıflandırma DOĞRULUĞU (mutasyonsuz, temiz fixture ağacı)
# =============================================================================
OUT1="$(run)"; RC1=$?
if [ "$RC1" -ne 0 ]; then
  echo "!! self-test FAIL [case 1]: report modu exit 0 bekleniyordu, $RC1 bulundu" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

assert_bucket() { # <case-etiketi> <bucket-başlığı deseni> <beklenen anahtar>
  local label="$1" header_pat="$2" key="$3"
  # Bölüm: header'dan bir sonraki header'a (veya boş satıra) kadar olan blok
  # içinde anahtarın GEÇTİĞİNİ doğrula — sabit satır sayısı DEĞİL, kova
  # başlıklarının kendisi sınır (T-252: "sabit pencere kullanma").
  if ! printf '%s\n' "$OUT1" | awk -v pat="$header_pat" -v key="$key" '
      $0 ~ pat { inblock = 1; next }
      inblock && /^  [A-Z(]/ { inblock = 0 }
      inblock && index($0, key) { found = 1 }
      END { exit !found }
    '; then
    echo "!! self-test FAIL [$label]: '$key' beklenen kovada YOK" >&2
    printf '%s\n' "$OUT1" >&2
    FAIL=1
  fi
}

assert_bucket "case 1a: FILTRESIZ" "^  FILTRESIZ " "fixture-plain.controller.ts|GET|fixture-plain/gap"
assert_bucket "case 1b: PUBLIC"    "^  PUBLIC "          "fixture-plain.controller.ts|GET|fixture-plain/pub"
assert_bucket "case 1c: ALAN_GUARD (rota-seviyesi UseGuards)" "^  ALAN_GUARD " "fixture-plain.controller.ts|POST|fixture-plain/route-guard"
assert_bucket "case 1d: ALAN_GUARD (controller-seviyesi UseGuards)" "^  ALAN_GUARD " "fixture-domain.controller.ts|GET|fixture-domain/inherited"

# roled / roled-multiline: ROLES kovası LİSTELENMİYOR (yalnız sayı basılıyor
# — bkz. route-scope.sh), o yüzden dolaylı doğrulanır: FILTRESIZ/PUBLIC/
# ALAN_GUARD kovalarının HİÇBİRİNDE görünmemeli VE ROLES sayısı 2 olmalı
# (roled + roled-multiline).
if printf '%s\n' "$OUT1" | grep -qF "fixture-plain/roled"; then
  # yalnız FILTRESIZ/PUBLIC/ALAN_GUARD satırlarında (ROLES bilgi satırı hariç)
  if printf '%s\n' "$OUT1" | grep -E "^    " | grep -qF "fixture-plain/roled"; then
    echo "!! self-test FAIL [case 1e]: 'roled' bir kova LİSTESİNDE göründü (ROLES'te listelenmemesi gerekir)" >&2
    FAIL=1
  fi
fi
ROLES_N="$(printf '%s\n' "$OUT1" | sed -n 's/.*(bilgi) ROLES: \([0-9]*\).*/\1/p')"
if [ "$ROLES_N" != "2" ]; then
  echo "!! self-test FAIL [case 1f]: ROLES sayısı 2 (roled + roled-multiline) bekleniyordu, '$ROLES_N' bulundu" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
else
  echo "-- [case 1f] çok satırlı @Roles(...) DOĞRU sayıldı (parantez derinliği testi geçti)"
fi

TOTAL_N="$(printf '%s\n' "$OUT1" | sed -n 's/.*TOPLAM rota: \([0-9]*\).*/\1/p')"
if [ "$TOTAL_N" != "6" ]; then
  echo "!! self-test FAIL [case 1g]: TOPLAM rota 6 bekleniyordu (gap,pub,roled,roled-multiline,route-guard,inherited), '$TOTAL_N' bulundu" >&2
  FAIL=1
fi

# =============================================================================
# KANAL BAĞIMSIZLIĞI — her mutasyon SIRAYLA, öncekinin geri alındığı
# doğrulanmadan bir sonrakine GEÇİLMEZ.
# =============================================================================
AWK_BACKUP="$TMP/route-scope.awk.orig"
cp "$AWK_ROUTE" "$AWK_BACKUP"
AWK_SHA="$(shasum -a 256 "$AWK_BACKUP" | awk '{print $1}')"

restore_awk() {
  cp "$AWK_BACKUP" "$AWK_ROUTE"
  printf '%s  %s\n' "$AWK_SHA" "$AWK_ROUTE" | shasum -a 256 -c - > /dev/null 2>&1
}

# --- case S: kanal 1 (rota dekoratörü) — SPINE, kırılırsa TÜM rotalar SESSİZLEŞİR
python3 - "$AWK_ROUTE" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = 'if (name == "Get" || name == "Post" || name == "Patch" || name == "Put" || name == "Delete") {'
assert s.count(marker) == 1, f"case S marker count={s.count(marker)}"
open(p, "w").write(s.replace(marker, 'if (name == "GetXX" || name == "Post" || name == "Patch" || name == "Put" || name == "Delete") {', 1))
PY
echo "-- [case S mutasyon] değiştirilen satır:"
grep -n 'name == "GetXX"' "$AWK_ROUTE"
OUT_S="$(run)"
# @Get ile tanımlı rotalar (gap, pub, roled, roled-multiline, inherited) TAMAMEN
# kaybolmalı — yalnız route-guard (@Post) hayatta kalır (TOPLAM rota: 1).
TOTAL_S="$(printf '%s\n' "$OUT_S" | sed -n 's/.*TOPLAM rota: \([0-9]*\).*/\1/p')"
if [ "$TOTAL_S" != "1" ]; then
  echo "!! self-test FAIL [case S]: @Get mutasyonu sonrası TOPLAM rota 1 (yalnız @Post route-guard) bekleniyordu, '$TOTAL_S' bulundu — SPINE kanalı beklenen şekilde kırılmadı" >&2
  printf '%s\n' "$OUT_S" >&2
  FAIL=1
else
  echo "-- [case S] SPINE kanalı (rota dekoratörü) mutasyonu TÜM @Get rotalarını sessizleştirdi — beklenen"
fi
restore_awk || { echo "!! self-test SETUP HATASI [case S geri alma]: shasum uyuşmuyor" >&2; FAIL=1; }
echo "-- [case S] geri alındı, satır:"
grep -n 'name == "Get"' "$AWK_ROUTE"

# --- case 2: kanal @Roles — bağımsızlık kontrolü ----------------------------
python3 - "$AWK_ROUTE" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = '} else if (name == "Roles") {'
assert s.count(marker) == 1, f"case 2 marker count={s.count(marker)}"
open(p, "w").write(s.replace(marker, '} else if (name == "RolesXX") {', 1))
PY
echo "-- [case 2 mutasyon] değiştirilen satır:"
grep -n 'name == "RolesXX"' "$AWK_ROUTE"
OUT2="$(run)"
# 'roled' artık @Roles TANINMADIĞI için hiçbir bayrak taşımıyor -> FILTRESIZ'e düşer.
if ! printf '%s\n' "$OUT2" | awk '/FILTRESIZ \(ratchet/{f=1;next} f && /^  [A-Z(]/{f=0} f && index($0,"fixture-plain/roled\"")==0 && index($0,"fixture-plain/roled")' | grep -q "roled\$"; then
  :
fi
ROLED_IN_FILTRESIZ="$(printf '%s\n' "$OUT2" | awk '/FILTRESIZ \(ratchet/{f=1;next} f && /^  [A-Z(]/{f=0} f' | grep -c 'fixture-plain/roled$')"
if [ "$ROLED_IN_FILTRESIZ" != "1" ]; then
  echo "!! self-test FAIL [case 2a]: @Roles mutasyonu sonrası 'roled' FILTRESIZ kovasına DÜŞMEDİ — kanal hedefe düşmedi" >&2
  printf '%s\n' "$OUT2" >&2
  FAIL=1
fi
# YAN ETKİ KONTROLÜ: diğer kanallar (PUBLIC, ALAN_GUARD x2) etkilenmemeli.
for key in "fixture-plain.controller.ts|GET|fixture-plain/pub" "fixture-plain.controller.ts|POST|fixture-plain/route-guard" "fixture-domain.controller.ts|GET|fixture-domain/inherited"; do
  if ! printf '%s\n' "$OUT2" | grep -qF "$key"; then
    echo "!! self-test FAIL [case 2 YAN ETKİ]: @Roles mutasyonu '$key' görünürlüğünü de bozdu" >&2
    FAIL=1
  fi
done
[ "$ROLED_IN_FILTRESIZ" = "1" ] && echo "-- [case 2] @Roles mutasyonu YALNIZ 'roled' rotasını kırdı, diğer kanallar bağımsız kaldı"
restore_awk || { echo "!! self-test SETUP HATASI [case 2 geri alma]: shasum uyuşmuyor" >&2; FAIL=1; }
echo "-- [case 2] geri alındı, satır:"
grep -n '} else if (name == "Roles")' "$AWK_ROUTE"

# --- case 3: kanal @Public — bağımsızlık kontrolü ---------------------------
python3 - "$AWK_ROUTE" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = '} else if (name == "Public") {'
assert s.count(marker) == 1, f"case 3 marker count={s.count(marker)}"
open(p, "w").write(s.replace(marker, '} else if (name == "PublicXX") {', 1))
PY
echo "-- [case 3 mutasyon] değiştirilen satır:"
grep -n 'name == "PublicXX"' "$AWK_ROUTE"
OUT3="$(run)"
PUB_IN_FILTRESIZ="$(printf '%s\n' "$OUT3" | awk '/FILTRESIZ \(ratchet/{f=1;next} f && /^  [A-Z(]/{f=0} f' | grep -c 'fixture-plain/pub$')"
if [ "$PUB_IN_FILTRESIZ" != "1" ]; then
  echo "!! self-test FAIL [case 3a]: @Public mutasyonu sonrası 'pub' FILTRESIZ kovasına DÜŞMEDİ" >&2
  printf '%s\n' "$OUT3" >&2
  FAIL=1
fi
for key in "fixture-plain.controller.ts|POST|fixture-plain/route-guard" "fixture-domain.controller.ts|GET|fixture-domain/inherited"; do
  if ! printf '%s\n' "$OUT3" | grep -qF "$key"; then
    echo "!! self-test FAIL [case 3 YAN ETKİ]: @Public mutasyonu '$key' görünürlüğünü de bozdu" >&2
    FAIL=1
  fi
done
[ "$PUB_IN_FILTRESIZ" = "1" ] && echo "-- [case 3] @Public mutasyonu YALNIZ 'pub' rotasını kırdı, diğer kanallar bağımsız kaldı"
restore_awk || { echo "!! self-test SETUP HATASI [case 3 geri alma]: shasum uyuşmuyor" >&2; FAIL=1; }
echo "-- [case 3] geri alındı, satır:"
grep -n '} else if (name == "Public")' "$AWK_ROUTE"

# --- case 4a: kanal @UseGuards ROTA seviyesi --------------------------------
python3 - "$AWK_ROUTE" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = '} else if (name == "UseGuards") {\n    collect_identifiers(text, rg)'
assert s.count(marker) == 1, f"case 4a marker count={s.count(marker)}"
open(p, "w").write(s.replace(marker, '} else if (name == "UseGuardsXX") {\n    collect_identifiers(text, rg)', 1))
PY
echo "-- [case 4a mutasyon] değiştirilen satır:"
grep -n 'name == "UseGuardsXX"' "$AWK_ROUTE"
OUT4A="$(run)"
RG_IN_FILTRESIZ="$(printf '%s\n' "$OUT4A" | awk '/FILTRESIZ \(ratchet/{f=1;next} f && /^  [A-Z(]/{f=0} f' | grep -c 'fixture-plain/route-guard$')"
if [ "$RG_IN_FILTRESIZ" != "1" ]; then
  echo "!! self-test FAIL [case 4a]: ROTA-seviyesi @UseGuards mutasyonu sonrası 'route-guard' FILTRESIZ kovasına DÜŞMEDİ" >&2
  printf '%s\n' "$OUT4A" >&2
  FAIL=1
fi
# YAN ETKİ: controller-seviyesi UseGuards (inherited) ETKİLENMEMELİ.
if ! printf '%s\n' "$OUT4A" | awk '/ALAN_GUARD /{f=1;next} f && /^  [A-Z(]/{f=0} f' | grep -q 'fixture-domain/inherited$'; then
  echo "!! self-test FAIL [case 4a YAN ETKİ]: rota-seviyesi mutasyon controller-seviyesi kanalı (inherited) da kırdı" >&2
  FAIL=1
else
  echo "-- [case 4a] rota-seviyesi @UseGuards mutasyonu YALNIZ 'route-guard'ı kırdı, controller-seviyesi kanal bağımsız kaldı"
fi
restore_awk || { echo "!! self-test SETUP HATASI [case 4a geri alma]: shasum uyuşmuyor" >&2; FAIL=1; }
echo "-- [case 4a] geri alındı:"
grep -n 'collect_identifiers(text, rg)' "$AWK_ROUTE"

# --- case 4b: kanal @UseGuards CONTROLLER seviyesi --------------------------
python3 - "$AWK_ROUTE" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
marker = 'if (name == "UseGuards") collect_identifiers(text, cg)'
assert s.count(marker) == 1, f"case 4b marker count={s.count(marker)}"
open(p, "w").write(s.replace(marker, 'if (name == "UseGuardsYY") collect_identifiers(text, cg)', 1))
PY
echo "-- [case 4b mutasyon] değiştirilen satır:"
grep -n 'name == "UseGuardsYY"' "$AWK_ROUTE"
OUT4B="$(run)"
CG_IN_FILTRESIZ="$(printf '%s\n' "$OUT4B" | awk '/FILTRESIZ \(ratchet/{f=1;next} f && /^  [A-Z(]/{f=0} f' | grep -c 'fixture-domain/inherited$')"
if [ "$CG_IN_FILTRESIZ" != "1" ]; then
  echo "!! self-test FAIL [case 4b]: CONTROLLER-seviyesi @UseGuards mutasyonu sonrası 'inherited' FILTRESIZ kovasına DÜŞMEDİ" >&2
  printf '%s\n' "$OUT4B" >&2
  FAIL=1
fi
if ! printf '%s\n' "$OUT4B" | awk '/ALAN_GUARD /{f=1;next} f && /^  [A-Z(]/{f=0} f' | grep -q 'fixture-plain/route-guard$'; then
  echo "!! self-test FAIL [case 4b YAN ETKİ]: controller-seviyesi mutasyon rota-seviyesi kanalı (route-guard) da kırdı" >&2
  FAIL=1
else
  echo "-- [case 4b] controller-seviyesi @UseGuards mutasyonu YALNIZ 'inherited'i kırdı, rota-seviyesi kanal bağımsız kaldı"
fi
restore_awk || { echo "!! self-test SETUP HATASI [case 4b geri alma]: shasum uyuşmuyor" >&2; FAIL=1; }
echo "-- [case 4b] geri alındı:"
grep -n 'if (name == "UseGuards") collect_identifiers(text, cg)' "$AWK_ROUTE"

# =============================================================================
# CASE E — BOŞ KAYNAK → SETUP HATASI (exit 2), sessizce yeşil DEĞİL (T-250)
# =============================================================================
EMPTY_SRC="$TMP/empty-src"
mkdir -p "$EMPTY_SRC"
ROUTE_SCOPE_SRC_DIR="$EMPTY_SRC" ROUTE_SCOPE_BASELINE="$NO_BASELINE" GUARD_MODE=report bash "$GUARD" > /dev/null 2>&1
RCE=$?
if [ "$RCE" -ne 2 ]; then
  echo "!! self-test FAIL [case E: boş kaynak]: exit 2 (SETUP HATASI) bekleniyordu, $RCE bulundu" >&2
  FAIL=1
else
  echo "-- [case E] boş kaynak → exit 2 (SETUP HATASI), sessiz yeşil DEĞİL"
fi

# =============================================================================
# CASE Z — SIFIR ROTA (dosya var ama hiç HTTP dekoratörü yok) → SETUP HATASI
# =============================================================================
ZERO_SRC="$TMP/zero-src"
mkdir -p "$ZERO_SRC"
cat > "$ZERO_SRC/noop.controller.ts" << 'EOF'
import { Controller } from '@nestjs/common';

@Controller('noop')
export class NoopController {}
EOF
ROUTE_SCOPE_SRC_DIR="$ZERO_SRC" ROUTE_SCOPE_BASELINE="$NO_BASELINE" GUARD_MODE=report bash "$GUARD" > /dev/null 2>&1
RCZ=$?
if [ "$RCZ" -ne 2 ]; then
  echo "!! self-test FAIL [case Z: sıfır rota]: exit 2 (SETUP HATASI) bekleniyordu, $RCZ bulundu" >&2
  FAIL=1
else
  echo "-- [case Z] dosya var, SIFIR rota → exit 2 (SETUP HATASI)"
fi

# =============================================================================
# CASE U — ÜÇÜNCÜ (bilinmeyen) koruma kanalı → SETUP HATASI / DUR (exit 2)
# =============================================================================
UNKNOWN_SRC="$TMP/unknown-src"
mkdir -p "$UNKNOWN_SRC"
cp "$FIXDIR/fixture-plain.controller.ts.fixture" "$UNKNOWN_SRC/unknown.controller.ts"
# ROUTE_SCOPE_DOMAIN_GUARDS bu koşuda VERİLMİYOR (varsayılan: Reversal/Settlement)
# — fixture'ın kullandığı FixtureDomainGuard o listede YOK, yani "bilinmeyen".
ROUTE_SCOPE_SRC_DIR="$UNKNOWN_SRC" ROUTE_SCOPE_BASELINE="$NO_BASELINE" ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1 GUARD_MODE=report bash "$GUARD" > /tmp/route-scope-case-u.log 2>&1
RCU=$?
if [ "$RCU" -ne 2 ]; then
  echo "!! self-test FAIL [case U: bilinmeyen guard]: exit 2 (SETUP HATASI/DUR) bekleniyordu, $RCU bulundu" >&2
  FAIL=1
elif ! grep -q "FixtureDomainGuard" /tmp/route-scope-case-u.log; then
  echo "!! self-test FAIL [case U]: hata mesajı bilinmeyen guard adını İSİMLENDİRMEDİ" >&2
  FAIL=1
else
  echo "-- [case U] üçüncü (bilinmeyen) koruma kanalı → exit 2, DUR mesajı adı içeriyor"
fi

# =============================================================================
# CASE R — RATCHET İKİ GİRDİ İKİ ÇIKTI (§2.7 #9) + baseline'daki rota
# @Roles kazanınca ne olur (T-252'nin üçüncü sınavı)
# =============================================================================
FIX_BASELINE="$TMP/fixture-baseline.txt"
cat > "$FIX_BASELINE" << 'EOF'
# fixture baseline — yalnız 'gap' FILTRESIZ olarak bilinir
F src/fixture-plain.controller.ts|GET|fixture-plain/gap 10
EOF

# R1: baseline'daki rota AYNEN duruyor → YEŞİL (RC=0), İYİLEŞTİ/GONE mesajı YOK.
OUT_R1="$(ROUTE_SCOPE_SRC_DIR="$SRC_DIR" ROUTE_SCOPE_BASELINE="$FIX_BASELINE" ROUTE_SCOPE_DOMAIN_GUARDS="FixtureDomainGuard" ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1 GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_R1=$?
if [ "$RC_R1" -ne 0 ]; then
  echo "!! self-test FAIL [case R1]: değişmemiş baseline rotası için exit 0 bekleniyordu, $RC_R1 bulundu" >&2
  printf '%s\n' "$OUT_R1" >&2
  FAIL=1
elif printf '%s\n' "$OUT_R1" | grep -qE "İYİLEŞTİ|GONE"; then
  echo "!! self-test FAIL [case R1]: değişmemiş rota için İYİLEŞTİ/GONE mesajı YANLIŞLIKLA basıldı" >&2
  FAIL=1
else
  echo "-- [case R1] baseline'daki rota AYNI → YEŞİL, sessiz (steady state)"
fi

# R2: YENİ bir filtresiz rota eklenince → KIRMIZI (RC=1).
SRC_DIR_R2="$TMP/r2/src"
mkdir -p "$SRC_DIR_R2"
cp "$SRC_DIR"/*.controller.ts "$SRC_DIR_R2/"
cat >> "$SRC_DIR_R2/fixture-plain.controller.ts" << 'EOF'
EOF
python3 - "$SRC_DIR_R2/fixture-plain.controller.ts" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
idx = s.rstrip().rfind("}")
new_route = "\n  @Get('new-gap')\n  newGap() {\n    return 'new-gap';\n  }\n"
s2 = s.rstrip()[:idx] + new_route + "}\n"
open(p, "w").write(s2)
PY
OUT_R2="$(ROUTE_SCOPE_SRC_DIR="$SRC_DIR_R2" ROUTE_SCOPE_BASELINE="$FIX_BASELINE" ROUTE_SCOPE_DOMAIN_GUARDS="FixtureDomainGuard" ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1 GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_R2=$?
if [ "$RC_R2" -ne 1 ]; then
  echo "!! self-test FAIL [case R2: pozitif kontrol]: YENİ filtresiz rota eklendi, exit 1 bekleniyordu, $RC_R2 bulundu" >&2
  printf '%s\n' "$OUT_R2" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT_R2" | grep -qF "fixture-plain/new-gap"; then
  echo "!! self-test FAIL [case R2]: ihlal mesajı yeni rotayı İSİMLENDİRMEDİ" >&2
  FAIL=1
else
  echo "-- [case R2] YENİ filtresiz rota → KIRMIZI (§2.7 #9 pozitif kontrol)"
fi

# R3: baseline'daki rota @Roles KAZANINCA → YEŞİL kalır (RC=0) + İYİLEŞTİ mesajı
# (T-252'nin üçüncü sınavı: "baseline'daki bir rota @Roles kazanınca ne olur?")
SRC_DIR_R3="$TMP/r3/src"
mkdir -p "$SRC_DIR_R3"
cp "$SRC_DIR"/*.controller.ts "$SRC_DIR_R3/"
python3 - "$SRC_DIR_R3/fixture-plain.controller.ts" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "  @Get('gap')\n  gap() {"
assert s.count(old) == 1
new = "  @Get('gap')\n  @Roles(UserRole.ADMIN)\n  gap() {"
open(p, "w").write(s.replace(old, new, 1))
PY
OUT_R3="$(ROUTE_SCOPE_SRC_DIR="$SRC_DIR_R3" ROUTE_SCOPE_BASELINE="$FIX_BASELINE" ROUTE_SCOPE_DOMAIN_GUARDS="FixtureDomainGuard" ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1 GUARD_MODE=block bash "$GUARD" 2>&1)"
RC_R3=$?
if [ "$RC_R3" -ne 0 ]; then
  echo "!! self-test FAIL [case R3]: baseline rotası @Roles kazandı, exit 0 (İYİLEŞME bloklamaz) bekleniyordu, $RC_R3 bulundu" >&2
  printf '%s\n' "$OUT_R3" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT_R3" | grep -q "İYİLEŞTİ.*fixture-plain/gap.*ROLES"; then
  echo "!! self-test FAIL [case R3]: İYİLEŞTİ mesajı basılmadı ya da doğru bucket'ı (ROLES) anmadı" >&2
  printf '%s\n' "$OUT_R3" >&2
  FAIL=1
else
  echo "-- [case R3] baseline'daki rota @Roles kazandı → YEŞİL kalır + İYİLEŞTİ mesajı (T-252 üçüncü sınav)"
fi

# =============================================================================
# CASE G — @Roles VAR AMA RolesGuard ZİNCİRDE YOK → SETUP HATASI (exit 2)
# (T-252 YENİDEN AÇILDI, T-267'nin kör noktası)
#
# İZOLE fixture'lar kullanılır, $SRC_DIR'İN PARÇASI DEĞİL: yukarıdaki grup
# (CASE 1, S, 2, 3, 4a, 4b, R1-R3) ROUTE_SCOPE_SKIP_ROLES_GUARD_CHECK=1 ile
# bu kontrolü KAPALI tutuyor (gerekçe: run()'ın üstündeki yorum). Bu kontrol
# BURADA, o bayrak OLMADAN, kendi fixture'larıyla sınanır.
# =============================================================================

# --- G-route: ROTA seviyesinde RolesGuard (gerçek repo deseni:
#     auth.controller.ts logout — @UseGuards route-level) ------------------
G_ROUTE_SRC="$TMP/g-route/src"
mkdir -p "$G_ROUTE_SRC"
cat > "$G_ROUTE_SRC/roles-route.controller.ts" << 'EOF'
import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../../../../src/common/decorators/roles.decorator';
import { RolesGuard } from '../../../../src/common/guards/roles.guard';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard';
import { UserRole } from '../../../../src/database/entities/user.entity';

@Controller('roles-route')
export class RolesRouteController {
  // ROTA seviyesinde RolesGuard — gerçek repo deseni (auth.controller.ts logout).
  @Get('protected')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  protectedRoute() {
    return 'protected';
  }
}
EOF

# G1: sağlıklı hâl (ROTA seviyesinde RolesGuard MEVCUT) → exit 0, yanlış
# pozitif YOK.
OUT_G1="$(ROUTE_SCOPE_SRC_DIR="$G_ROUTE_SRC" ROUTE_SCOPE_BASELINE="$NO_BASELINE" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC_G1=$?
if [ "$RC_G1" -ne 0 ]; then
  echo "!! self-test FAIL [case G1: rota-seviyesi RolesGuard MEVCUT]: exit 0 bekleniyordu, $RC_G1 bulundu" >&2
  printf '%s\n' "$OUT_G1" >&2
  FAIL=1
else
  echo "-- [case G1] rota-seviyesi RolesGuard MEVCUT → exit 0 (yanlış pozitif YOK)"
fi

# G2: ROTA seviyesinden RolesGuard KALDIRILINCA → exit 2 (POZİTİF KONTROL).
G_ROUTE_SRC2="$TMP/g-route2/src"
mkdir -p "$G_ROUTE_SRC2"
cp "$G_ROUTE_SRC/roles-route.controller.ts" "$G_ROUTE_SRC2/"
echo "-- [case G2 mutasyon] ROTA seviyesinden RolesGuard kaldırılıyor, ESKİ satır:"
grep -n "UseGuards(JwtAuthGuard, RolesGuard)" "$G_ROUTE_SRC2/roles-route.controller.ts" | sed 's/^/   /'
python3 - "$G_ROUTE_SRC2/roles-route.controller.ts" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "@UseGuards(JwtAuthGuard, RolesGuard)"
assert s.count(old) == 1, f"case G2 marker count={s.count(old)}"
open(p, "w").write(s.replace(old, "@UseGuards(JwtAuthGuard)", 1))
PY
echo "-- [case G2 mutasyon] YENİ satır:"
grep -n "UseGuards(JwtAuthGuard)" "$G_ROUTE_SRC2/roles-route.controller.ts" | sed 's/^/   /'
OUT_G2="$(ROUTE_SCOPE_SRC_DIR="$G_ROUTE_SRC2" ROUTE_SCOPE_BASELINE="$NO_BASELINE" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC_G2=$?
if [ "$RC_G2" -ne 2 ]; then
  echo "!! self-test FAIL [case G2: pozitif kontrol, ROTA seviyesi]: exit 2 bekleniyordu, $RC_G2 bulundu" >&2
  printf '%s\n' "$OUT_G2" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT_G2" | grep -qF "roles-route.controller.ts" || ! printf '%s\n' "$OUT_G2" | grep -qF "roles-route/protected"; then
  echo "!! self-test FAIL [case G2]: hata mesajı etkilenen rotayı İSİMLENDİRMEDİ" >&2
  printf '%s\n' "$OUT_G2" >&2
  FAIL=1
else
  echo "-- [case G2] ROTA seviyesinden RolesGuard kaldırılınca → exit 2 (POZİTİF KONTROL, rota isimlendirildi)"
fi

# --- G-class: CONTROLLER seviyesinde RolesGuard (gerçek repo deseni:
#     settlement.controller.ts — @UseGuards class-level, rota miras alır) --
G_CLASS_SRC="$TMP/g-class/src"
mkdir -p "$G_CLASS_SRC"
cat > "$G_CLASS_SRC/roles-class.controller.ts" << 'EOF'
import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../../../../src/common/decorators/roles.decorator';
import { RolesGuard } from '../../../../src/common/guards/roles.guard';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard';
import { UserRole } from '../../../../src/database/entities/user.entity';

// CONTROLLER seviyesinde RolesGuard — gerçek repo deseni (settlement.controller.ts).
@Controller('roles-class')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RolesClassController {
  @Get('protected')
  @Roles(UserRole.ADMIN)
  protectedRoute() {
    return 'protected';
  }
}
EOF

# G3: sağlıklı hâl (CONTROLLER seviyesinde RolesGuard MEVCUT, rota miras
# alıyor) → exit 0, yanlış pozitif YOK.
OUT_G3="$(ROUTE_SCOPE_SRC_DIR="$G_CLASS_SRC" ROUTE_SCOPE_BASELINE="$NO_BASELINE" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC_G3=$?
if [ "$RC_G3" -ne 0 ]; then
  echo "!! self-test FAIL [case G3: controller-seviyesi RolesGuard MEVCUT]: exit 0 bekleniyordu, $RC_G3 bulundu" >&2
  printf '%s\n' "$OUT_G3" >&2
  FAIL=1
else
  echo "-- [case G3] controller-seviyesi RolesGuard MEVCUT (miras) → exit 0 (yanlış pozitif YOK)"
fi

# G4: CONTROLLER seviyesinden RolesGuard KALDIRILINCA → exit 2 (POZİTİF
# KONTROL, İKİNCİ SEVİYE — G2'den AYRI fixture, AYRI mutasyon).
G_CLASS_SRC2="$TMP/g-class2/src"
mkdir -p "$G_CLASS_SRC2"
cp "$G_CLASS_SRC/roles-class.controller.ts" "$G_CLASS_SRC2/"
echo "-- [case G4 mutasyon] CONTROLLER seviyesinden RolesGuard kaldırılıyor, ESKİ satır:"
grep -n "@UseGuards(JwtAuthGuard, RolesGuard)" "$G_CLASS_SRC2/roles-class.controller.ts" | sed 's/^/   /'
python3 - "$G_CLASS_SRC2/roles-class.controller.ts" << 'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "@UseGuards(JwtAuthGuard, RolesGuard)"
assert s.count(old) == 1, f"case G4 marker count={s.count(old)}"
open(p, "w").write(s.replace(old, "@UseGuards(JwtAuthGuard)", 1))
PY
echo "-- [case G4 mutasyon] YENİ satır:"
grep -n "@UseGuards(JwtAuthGuard)" "$G_CLASS_SRC2/roles-class.controller.ts" | sed 's/^/   /'
OUT_G4="$(ROUTE_SCOPE_SRC_DIR="$G_CLASS_SRC2" ROUTE_SCOPE_BASELINE="$NO_BASELINE" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC_G4=$?
if [ "$RC_G4" -ne 2 ]; then
  echo "!! self-test FAIL [case G4: pozitif kontrol, CONTROLLER seviyesi]: exit 2 bekleniyordu, $RC_G4 bulundu" >&2
  printf '%s\n' "$OUT_G4" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT_G4" | grep -qF "roles-class.controller.ts" || ! printf '%s\n' "$OUT_G4" | grep -qF "roles-class/protected"; then
  echo "!! self-test FAIL [case G4]: hata mesajı etkilenen rotayı İSİMLENDİRMEDİ" >&2
  printf '%s\n' "$OUT_G4" >&2
  FAIL=1
else
  echo "-- [case G4] CONTROLLER seviyesinden RolesGuard kaldırılınca → exit 2 (POZİTİF KONTROL, İKİNCİ SEVİYE)"
fi

# G5: NEGATİF KONTROL — @Roles TAŞIMAYAN rotalarda (filtresiz · @Public ·
# alan-guard'lı) RolesGuard YOKLUĞU bulgu ÜRETMEMELİ. Üretmezse @Public
# uçları ve alan-guard'lı uçlar (ReversalGuard/SettlementGuard) bu yeni
# kontrol tarafından YANLIŞ yakalanır.
G_NEG_SRC="$TMP/g-neg/src"
mkdir -p "$G_NEG_SRC"
cat > "$G_NEG_SRC/roles-negative.controller.ts" << 'EOF'
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../../../src/common/decorators/public.decorator';
import { FixtureDomainGuard } from './fixture-domain-guard';

@Controller('roles-negative')
export class RolesNegativeController {
  // @Roles YOK, RolesGuard YOK — filtresiz bir rota; YENİ kontrolün
  // KONUSU DEĞİL (o, FILTRESIZ ratchet'inin konusu, bu kontrolün değil).
  @Get('no-roles')
  noRoles() {
    return 'no-roles';
  }

  // @Public — @Roles YOK, RolesGuard YOK. Bulgu ÜRETMEMELİ.
  @Get('pub')
  @Public()
  pub() {
    return 'pub';
  }

  // alan-guard'lı — @Roles YOK, RolesGuard YOK (guard kendi İÇİNDE rol
  // zorluyor, K-2.6.6 ⛔ şartı). Bulgu ÜRETMEMELİ.
  @Post('domain')
  @UseGuards(FixtureDomainGuard)
  domain() {
    return 'domain';
  }
}
EOF
OUT_G5="$(ROUTE_SCOPE_SRC_DIR="$G_NEG_SRC" ROUTE_SCOPE_BASELINE="$NO_BASELINE" ROUTE_SCOPE_DOMAIN_GUARDS="FixtureDomainGuard" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC_G5=$?
if [ "$RC_G5" -ne 0 ]; then
  echo "!! self-test FAIL [case G5: negatif kontrol]: @Roles taşımayan rotalar RolesGuard eksikliğinden REDDEDİLMEMELİ, exit 0 bekleniyordu, $RC_G5 bulundu" >&2
  printf '%s\n' "$OUT_G5" >&2
  FAIL=1
else
  echo "-- [case G5] @Roles taşımayan rotalar (filtresiz/@Public/alan-guard'lı) → bulgu ÜRETİLMEDİ (negatif kontrol)"
fi

if [ "$FAIL" -ne 0 ]; then
  {
    echo "!!"
    echo "!! route-scope self-test'i kendi fixture matrisini geçemedi. Bu, üretim"
    echo "!! rota envanterinin doğru sınıflandırıldığı anlamına GELMEZ — guard'ın"
    echo "!! ölçüm yaptığı anlamına gelmez."
  } >&2
  exit 1
fi

exit 0

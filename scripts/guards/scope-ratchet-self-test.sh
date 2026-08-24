#!/usr/bin/env bash
#
# self-test — scope-ratchet ([[T-266]], Z19b).
#
# Gerçek guard'ı (`scope-ratchet.sh`) fixture ağacına ENV override'larıyla
# (`SCOPE_RATCHET_SRC_DIR` / `SCOPE_RATCHET_A1` / `_A2` / `_B` / `_C`)
# yönlendirerek çağırır — mantığın hiçbir parçasını YENİDEN UYGULAMAZ (ADR
# 0007 E16 dersi: bir kontrolü sınayan test, o kontrolün kopyasını çalıştırmaz).
#
# A1 RATCHET git HEAD'e karşı çalıştığı için (CLAUDE.md: "taban ölçümü için
# git stash KULLANMA — git show HEAD:<dosya>"), bu self-test İZOLE, TEK
# KULLANIMLIK bir git deposu kurar (CLAUDE.md: "yan etkisi olan bir aracı
# İZOLE hedefte sına") — gerçek repo'nun git geçmişine HİÇ dokunmaz.
#
# --- KANALLAR, HER BİRİ AYRI POZİTİF KONTROL (T-250 dersi) ------------------
#   1. TAMLIK    — sınıflandırılmamış rota → exit 2
#   2. TEKİLLİK  — birden fazla listede sınıflandırılmış rota → exit 2
#   3. A1 büyüme — HEAD'den beri A1'e YENİ anahtar → exit 1 (block) + bulgu
#   4. A1 küçülme — A1'den çıkıp B/A2/C'ye taşınan anahtar → İYİLEŞTİ (exit 0)
#   5. A1 küçülme — A1'den çıkıp koddan da SİLİNEN anahtar → GONE (exit 0)
#   6. steady state — hiçbir değişiklik yok → sessiz, exit 0
#   7. boş liste / boş kaynak → exit 2 (T-250 "boş kaynak → setup hatası")
#
# exit 0 = matris tutuyor · exit 1 = guard beklendiği gibi davranmıyor
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/scope-ratchet.sh"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: scope-ratchet.sh yok" >&2
  exit 1
fi
if ! command -v git > /dev/null 2>&1; then
  echo "!! self-test: git bulunamadı — A1 ratchet kanalı sınanamıyor" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0

# --- İZOLE, TEK KULLANIMLIK git deposu ---------------------------------------
REPO="$TMP/repo"
mkdir -p "$REPO/src" "$REPO/guards"

write_src() { # <ek rota var mı: 0|1>
  cat > "$REPO/src/foo.controller.ts" << EOF
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('foo')
@UseGuards(JwtAuthGuard)
export class FooController {
  @Get('bar')
  bar() {
    return 'bar';
  }

  @Get('baz')
  baz() {
    return 'baz';
  }
$([ "$1" = "1" ] && printf '\n  @Get(%s)\n  extra() {\n    return %s;\n  }\n' "'extra'" "'extra'")
}
EOF
}

write_src 0

cat > "$REPO/guards/a1.txt" << 'EOF'
# scope-ratchet: A1 — fixture
src/foo.controller.ts|GET|foo/bar	# başlangıç debt
src/permanent-dummy.controller.ts|GET|permanent/dummy	# kalıcı dummy — envanterde YOK, dosya boşalmasın diye
EOF
cat > "$REPO/guards/a2.txt" << 'EOF'
# scope-ratchet: A2 — fixture
src/permanent-dummy.controller.ts|POST|permanent/dummy2	# kalıcı dummy
EOF
cat > "$REPO/guards/b.txt" << 'EOF'
# scope-ratchet: B — fixture
src/permanent-dummy.controller.ts|PATCH|permanent/dummy3	# kalıcı dummy
EOF
cat > "$REPO/guards/c.txt" << 'EOF'
# scope-ratchet: C — fixture
src/foo.controller.ts|GET|foo/baz	# gerekçeli
EOF

(
  cd "$REPO"
  git init -q
  git config user.email test@example.com
  git config user.name "scope-ratchet self-test"
  git add -A
  git commit -qm "initial fixture commit"
)

run() {
  SCOPE_RATCHET_SRC_DIR="$REPO/src" \
    SCOPE_RATCHET_A1="$REPO/guards/a1.txt" \
    SCOPE_RATCHET_A2="$REPO/guards/a2.txt" \
    SCOPE_RATCHET_B="$REPO/guards/b.txt" \
    SCOPE_RATCHET_C="$REPO/guards/c.txt" \
    GUARD_MODE="${1:-block}" bash "$GUARD"
}

# =============================================================================
# CASE 1 — steady state (mutasyonsuz, temiz commit) → exit 0, sessiz
# =============================================================================
OUT1="$(run block 2>&1)"; RC1=$?
if [ "$RC1" -ne 0 ]; then
  echo "!! self-test FAIL [case 1: steady state]: exit 0 bekleniyordu, $RC1 bulundu" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
elif printf '%s\n' "$OUT1" | grep -qE "İYİLEŞTİ|GONE|GEREKÇESİZ EKLEME"; then
  echo "!! self-test FAIL [case 1]: steady state'te ratchet/İYİLEŞTİ/GONE mesajı YANLIŞLIKLA çıktı" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
else
  echo "-- [case 1] steady state → sessiz, exit 0"
fi
if ! printf '%s\n' "$OUT1" | grep -q "rota envanteri: 2 "; then
  echo "!! self-test FAIL [case 1b]: envanter 2 (bar+baz) bekleniyordu" >&2
  printf '%s\n' "$OUT1" >&2
  FAIL=1
fi

# =============================================================================
# CASE 2 — TAMLIK: yeni bir rota (koda eklendi, HİÇBİR listeye eklenmedi)
# → exit 2, rotayı İSİMLENDİRİR
# =============================================================================
write_src 1
OUT2="$(run report 2>&1)"; RC2=$?
if [ "$RC2" -ne 2 ]; then
  echo "!! self-test FAIL [case 2: TAMLIK]: sınıflandırılmamış rota için exit 2 bekleniyordu, $RC2 bulundu" >&2
  printf '%s\n' "$OUT2" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT2" | grep -qF "foo.controller.ts|GET|foo/extra"; then
  echo "!! self-test FAIL [case 2]: hata mesajı sınıflandırılmamış rotayı İSİMLENDİRMEDİ" >&2
  printf '%s\n' "$OUT2" >&2
  FAIL=1
else
  echo "-- [case 2] TAMLIK: sınıflandırılmamış YENİ rota → exit 2, DUR mesajı rotayı adlandırıyor"
fi
write_src 0   # geri al

# =============================================================================
# CASE 3 — TEKİLLİK: aynı rota İKİ listede → exit 2
# =============================================================================
cp "$REPO/guards/a2.txt" "$TMP/a2.orig"
{ cat "$REPO/guards/a2.txt"; echo "src/foo.controller.ts|GET|foo/bar	# çakışan"; } > "$TMP/a2.dup"
cp "$TMP/a2.dup" "$REPO/guards/a2.txt"
OUT3="$(run report 2>&1)"; RC3=$?
if [ "$RC3" -ne 2 ]; then
  echo "!! self-test FAIL [case 3: TEKİLLİK]: çakışan sınıflandırma için exit 2 bekleniyordu, $RC3 bulundu" >&2
  printf '%s\n' "$OUT3" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT3" | grep -qF "foo.controller.ts|GET|foo/bar"; then
  echo "!! self-test FAIL [case 3]: hata mesajı çakışan rotayı İSİMLENDİRMEDİ" >&2
  FAIL=1
else
  echo "-- [case 3] TEKİLLİK: aynı rota iki listede → exit 2"
fi
cp "$TMP/a2.orig" "$REPO/guards/a2.txt"   # geri al

# =============================================================================
# CASE 4 — A1 BÜYÜME: foo/baz C'den A1'e taşındı (HEAD güncellenmeden)
# → exit 1 (block), bulgu rotayı İSİMLENDİRİR; POZ. KONTROL: report modunda
# exit 0 ama bulgu YİNE basılır (T-250: rapor davranışı ayrı sınanır)
# =============================================================================
cp "$REPO/guards/a1.txt" "$TMP/a1.orig"
cp "$REPO/guards/c.txt" "$TMP/c.orig"
{ cat "$REPO/guards/a1.txt"; echo "src/foo.controller.ts|GET|foo/baz	# YENİ debt, gerekçesiz"; } > "$TMP/a1.grown"
cp "$TMP/a1.grown" "$REPO/guards/a1.txt"
echo "# fixture c (foo/baz artık burada değil)" > "$REPO/guards/c.txt"
echo "src/permanent-dummy.controller.ts|DELETE|permanent/dummy4	# dummy" >> "$REPO/guards/c.txt"

OUT4="$(run block 2>&1)"; RC4=$?
if [ "$RC4" -ne 1 ]; then
  echo "!! self-test FAIL [case 4: A1 büyüme]: exit 1 bekleniyordu, $RC4 bulundu" >&2
  printf '%s\n' "$OUT4" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT4" | grep -q "\[scope-ratchet\] src/foo.controller.ts|GET|foo/baz"; then
  echo "!! self-test FAIL [case 4]: A1 büyüme bulgusu rotayı İSİMLENDİRMEDİ" >&2
  printf '%s\n' "$OUT4" >&2
  FAIL=1
else
  echo "-- [case 4a] A1 büyüme (gerekçesiz ekleme) → exit 1 (block), rota isimlendirildi"
fi

OUT4R="$(run report 2>&1)"; RC4R=$?
if [ "$RC4R" -ne 0 ]; then
  echo "!! self-test FAIL [case 4b: report modu]: exit 0 bekleniyordu (bulgu var ama block değil), $RC4R bulundu" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT4R" | grep -qF "GEREKÇESİZ EKLEME"; then
  echo "!! self-test FAIL [case 4b]: report modunda bulgu BASILMADI (yalnız exit kodu değişti sanılmasın)" >&2
  FAIL=1
else
  echo "-- [case 4b] POZ. KONTROL: report modunda exit 0 AMA bulgu yine basılıyor"
fi

cp "$TMP/a1.orig" "$REPO/guards/a1.txt"   # geri al
cp "$TMP/c.orig" "$REPO/guards/c.txt"

# =============================================================================
# CASE 5 — A1 KÜÇÜLME (İYİLEŞTİ): foo/bar A1'den B'ye taşındı → exit 0 + İYİLEŞTİ
# =============================================================================
cp "$REPO/guards/a1.txt" "$TMP/a1.orig2"
cp "$REPO/guards/b.txt" "$TMP/b.orig"
printf '%s\n%s\n' "# scope-ratchet: A1 — fixture" "src/permanent-dummy.controller.ts|GET|permanent/dummy	# kalıcı dummy" > "$REPO/guards/a1.txt"
{ cat "$REPO/guards/b.txt"; echo "src/foo.controller.ts|GET|foo/bar	# İYİLEŞTİ"; } > "$TMP/b.new"
cp "$TMP/b.new" "$REPO/guards/b.txt"

OUT5="$(run block 2>&1)"; RC5=$?
if [ "$RC5" -ne 0 ]; then
  echo "!! self-test FAIL [case 5: İYİLEŞTİ]: exit 0 bekleniyordu, $RC5 bulundu" >&2
  printf '%s\n' "$OUT5" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT5" | grep -q "İYİLEŞTİ: src/foo.controller.ts|GET|foo/bar"; then
  echo "!! self-test FAIL [case 5]: İYİLEŞTİ mesajı basılmadı ya da rotayı adlandırmadı" >&2
  printf '%s\n' "$OUT5" >&2
  FAIL=1
else
  echo "-- [case 5] A1 küçülme (B'ye taşındı) → exit 0 + İYİLEŞTİ mesajı"
fi

# =============================================================================
# CASE 6 — A1 KÜÇÜLME (GONE): foo/baz hem A1'den hem KODDAN silindi → GONE
# =============================================================================
cp "$REPO/guards/c.txt" "$TMP/c.orig2"
cat > "$REPO/src/foo.controller.ts" << 'EOF'
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('foo')
@UseGuards(JwtAuthGuard)
export class FooController {
  @Get('bar')
  bar() {
    return 'bar';
  }
}
EOF
echo "# fixture c (foo/baz koddan silindi)" > "$REPO/guards/c.txt"
echo "src/permanent-dummy.controller.ts|DELETE|permanent/dummy4	# dummy" >> "$REPO/guards/c.txt"
# a1.txt zaten yalnız permanent-dummy taşıyor (case 5'ten kalan hâl) — foo/baz
# HEAD'de A1'de değildi (C'deydi), yani bu GONE testi foo/baz'ı DOĞRUDAN HEAD'in
# C listesinden değil, orijinal A1 HEAD içeriğinden (case 4 senaryosu) türetmek
# için a1.txt'yi HEAD'deki foo/baz'ı içerecek şekilde ayarlamamız gerekmiyor —
# GONE, "A1 HEAD'de olup artık ne A1'de ne kodda" durumudur. Bu yüzden foo/baz'ı
# HEAD'in A1'inde varmış gibi test etmek için case 4'ün YAPISINI (A1'e ekleyip
# commit'lemeden bırakma) burada AYRI bir alt-depo ile kuruyoruz.
REPO2="$TMP/repo2"
mkdir -p "$REPO2/src" "$REPO2/guards"
cp "$REPO/src/foo.controller.ts" "$TMP/foo-one-route.ts"
cat > "$REPO2/src/foo.controller.ts" << 'EOF'
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('foo')
@UseGuards(JwtAuthGuard)
export class FooController {
  @Get('bar')
  bar() {
    return 'bar';
  }

  @Get('baz')
  baz() {
    return 'baz';
  }
}
EOF
cat > "$REPO2/guards/a1.txt" << 'EOF'
# scope-ratchet: A1 — fixture
src/foo.controller.ts|GET|foo/bar	# debt
src/foo.controller.ts|GET|foo/baz	# debt — bu route birazdan koddan silinecek
EOF
cat > "$REPO2/guards/a2.txt" << 'EOF'
# scope-ratchet: A2 — fixture
src/permanent-dummy.controller.ts|POST|permanent/dummy2	# kalıcı dummy
EOF
cat > "$REPO2/guards/b.txt" << 'EOF'
# scope-ratchet: B — fixture
src/permanent-dummy.controller.ts|PATCH|permanent/dummy3	# kalıcı dummy
EOF
cat > "$REPO2/guards/c.txt" << 'EOF'
# scope-ratchet: C — fixture
src/permanent-dummy.controller.ts|DELETE|permanent/dummy4	# kalıcı dummy
EOF
( cd "$REPO2" && git init -q && git config user.email t@e.com && git config user.name t && git add -A && git commit -qm "initial" )

# foo/baz'ı hem koddan hem A1'den sil (route tamamen kaldırıldı)
cat > "$REPO2/src/foo.controller.ts" << 'EOF'
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('foo')
@UseGuards(JwtAuthGuard)
export class FooController {
  @Get('bar')
  bar() {
    return 'bar';
  }
}
EOF
printf '%s\n%s\n' "# scope-ratchet: A1 — fixture" "src/foo.controller.ts|GET|foo/bar	# debt" > "$REPO2/guards/a1.txt"

OUT6="$(SCOPE_RATCHET_SRC_DIR="$REPO2/src" SCOPE_RATCHET_A1="$REPO2/guards/a1.txt" SCOPE_RATCHET_A2="$REPO2/guards/a2.txt" SCOPE_RATCHET_B="$REPO2/guards/b.txt" SCOPE_RATCHET_C="$REPO2/guards/c.txt" GUARD_MODE=block bash "$GUARD" 2>&1)"
RC6=$?
if [ "$RC6" -ne 0 ]; then
  echo "!! self-test FAIL [case 6: GONE]: exit 0 bekleniyordu, $RC6 bulundu" >&2
  printf '%s\n' "$OUT6" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT6" | grep -q "GONE: src/foo.controller.ts|GET|foo/baz"; then
  echo "!! self-test FAIL [case 6]: GONE mesajı basılmadı ya da rotayı adlandırmadı" >&2
  printf '%s\n' "$OUT6" >&2
  FAIL=1
else
  echo "-- [case 6] A1 küçülme (route koddan silindi) → exit 0 + GONE mesajı"
fi

# =============================================================================
# CASE 7 — boş kaynak / boş liste → exit 2 (T-250)
# =============================================================================
EMPTY_SRC="$TMP/empty-src"
mkdir -p "$EMPTY_SRC"
SCOPE_RATCHET_SRC_DIR="$EMPTY_SRC" SCOPE_RATCHET_A1="$REPO/guards/a1.txt" SCOPE_RATCHET_A2="$REPO/guards/a2.txt" SCOPE_RATCHET_B="$REPO/guards/b.txt" SCOPE_RATCHET_C="$REPO/guards/c.txt" GUARD_MODE=report bash "$GUARD" > /dev/null 2>&1
RC7=$?
if [ "$RC7" -ne 2 ]; then
  echo "!! self-test FAIL [case 7a: boş kaynak]: exit 2 bekleniyordu, $RC7 bulundu" >&2
  FAIL=1
else
  echo "-- [case 7a] boş kaynak → exit 2 (SETUP HATASI)"
fi

# CASE 7b — A1 listesi BAŞLIKSIZ (gerçek bozukluk: içerik var ama '#' başlığı
# YOK) → exit 2. Bu, eskiden "boş A1 listesi" olarak sınanan kapsamı DAR
# tanımlıyordu — sıfır anahtar TEK BAŞINA artık bir kusur DEĞİL (bkz. CASE T).
NOHDR_LIST="$TMP/nohdr-a1.txt"
echo "src/foo.controller.ts|GET|foo/bar	# başlıksız, bozuk" > "$NOHDR_LIST"
OUT7B="$(SCOPE_RATCHET_SRC_DIR="$REPO/src" SCOPE_RATCHET_A1="$NOHDR_LIST" SCOPE_RATCHET_A2="$REPO/guards/a2.txt" SCOPE_RATCHET_B="$REPO/guards/b.txt" SCOPE_RATCHET_C="$REPO/guards/c.txt" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC7B=$?
if [ "$RC7B" -ne 2 ]; then
  echo "!! self-test FAIL [case 7b: A1 başlıksız]: exit 2 bekleniyordu, $RC7B bulundu" >&2
  printf '%s\n' "$OUT7B" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT7B" | grep -qF "başlık biçimi TANINMADI"; then
  echo "!! self-test FAIL [case 7b]: hata mesajı başlık eksikliğini İSİMLENDİRMEDİ" >&2
  printf '%s\n' "$OUT7B" >&2
  FAIL=1
else
  echo "-- [case 7b] A1 listesi BAŞLIKSIZ (gerçek bozukluk) → exit 2 (SETUP HATASI)"
fi

# CASE 7c — A1 listesi başlıklı AMA bir veri satırı beklenen ŞEKİLDE değil
# (tab yok / '# ' önekiyle başlamıyor) → exit 2. Başlığın kendisi YETMEZ;
# İÇERİK BİÇİMİ de doğrulanır (route-scope.sh'in AYNI ikinci kontrolü).
MALFORMED_LIST="$TMP/malformed-a1.txt"
printf '%s\n%s\n' "# scope-ratchet: A1 — fixture" "bu-satir-tab-icermiyor-ve-bozuk" > "$MALFORMED_LIST"
OUT7C="$(SCOPE_RATCHET_SRC_DIR="$REPO/src" SCOPE_RATCHET_A1="$MALFORMED_LIST" SCOPE_RATCHET_A2="$REPO/guards/a2.txt" SCOPE_RATCHET_B="$REPO/guards/b.txt" SCOPE_RATCHET_C="$REPO/guards/c.txt" GUARD_MODE=report bash "$GUARD" 2>&1)"
RC7C=$?
if [ "$RC7C" -ne 2 ]; then
  echo "!! self-test FAIL [case 7c: A1 satır bozuk]: exit 2 bekleniyordu, $RC7C bulundu" >&2
  printf '%s\n' "$OUT7C" >&2
  FAIL=1
elif ! printf '%s\n' "$OUT7C" | grep -qF "TANINMAYAN satır"; then
  echo "!! self-test FAIL [case 7c]: hata mesajı bozuk satırı İSİMLENDİRMEDİ" >&2
  printf '%s\n' "$OUT7C" >&2
  FAIL=1
else
  echo "-- [case 7c] A1 listesi başlıklı ama VERİ satırı bozuk → exit 2 (SETUP HATASI)"
fi

# =============================================================================
# CASE T — RATCHET TAMAMLANDI: A1 listesi biçimi SAĞLIKLI, SIFIR anahtar
# (başlık var, hiç veri satırı yok) → exit 0 + görünür "TAMAMLANDI" mesajı.
# (ADIM3_FAZB_PLAN.md "AÇIK KARAR", seçenek b — B4'ün ön koşulu bu satırı
# okuyacak, §2.7: "sıfır bir BAŞARI OLAYIDIR ve GÖRÜNÜR olmalı".)
#
# A1'i BOŞALTMAK gerçek envanterden bir rota DÜŞÜRMEMELİ (aksi hâlde TAMLIK
# kontrolü — ayrı bir kanal — devreye girer); bu yüzden qux-only İZOLE bir
# repo kurulur ve tek rota baştan B'ye sınıflandırılır, A1 GERÇEKTEN boş
# doğar.
# =============================================================================
REPO4="$TMP/repo4"
mkdir -p "$REPO4/src" "$REPO4/guards"
cat > "$REPO4/src/qux.controller.ts" << 'EOF'
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('qux')
@UseGuards(JwtAuthGuard)
export class QuxController {
  @Get('only')
  only() {
    return 'only';
  }
}
EOF
cat > "$REPO4/guards/a1.txt" << 'EOF'
# scope-ratchet: A1 — fixture (boş — CASE T)
EOF
cat > "$REPO4/guards/a2.txt" << 'EOF'
# scope-ratchet: A2 — fixture
src/permanent-dummy.controller.ts|GET|permanent/dummy-a2	# kalıcı dummy
EOF
cat > "$REPO4/guards/b.txt" << 'EOF'
# scope-ratchet: B — fixture
src/qux.controller.ts|GET|qux/only	# kapsam UYGULANIYOR — kod doğrulandı
EOF
cat > "$REPO4/guards/c.txt" << 'EOF'
# scope-ratchet: C — fixture
src/permanent-dummy.controller.ts|GET|permanent/dummy-c	# kalıcı dummy
EOF
OUTT="$(SCOPE_RATCHET_SRC_DIR="$REPO4/src" SCOPE_RATCHET_A1="$REPO4/guards/a1.txt" SCOPE_RATCHET_A2="$REPO4/guards/a2.txt" SCOPE_RATCHET_B="$REPO4/guards/b.txt" SCOPE_RATCHET_C="$REPO4/guards/c.txt" GUARD_MODE=block bash "$GUARD" 2>&1)"
RCT=$?
if [ "$RCT" -ne 0 ]; then
  echo "!! self-test FAIL [case T: RATCHET TAMAMLANDI]: exit 0 bekleniyordu, $RCT bulundu" >&2
  printf '%s\n' "$OUTT" >&2
  FAIL=1
elif ! printf '%s\n' "$OUTT" | grep -qF "RATCHET TAMAMLANDI"; then
  echo "!! self-test FAIL [case T]: SIFIR anahtarlı sağlıklı A1 için 'RATCHET TAMAMLANDI'" >&2
  echo "!! mesajı basılmadı (Şart 2: sıfır SESSİZCE geçilemez)" >&2
  printf '%s\n' "$OUTT" >&2
  FAIL=1
else
  echo "-- [case T] A1 biçimi SAĞLIKLI + SIFIR anahtar → exit 0 + görünür 'RATCHET TAMAMLANDI'"
fi

# =============================================================================
# CASE 8/9 — HER KOVA ayrı pozitif kontrol (T-250 dersi): "bir kanalın deseni
# bozulsa diğerleri körlüğü gizler." Case 1'in steady-state'i A2/B'yi yalnız
# envanterde HİÇ olmayan 'permanent-dummy' anahtarlarıyla dolduruyordu — yani
# A2/B'nin GERÇEK bir envanter rotasını tamlık kontrolünden DÜŞÜRDÜĞÜ (union'a
# hiç girmediği) bir kusur bu ikisinde GÖRÜNMEZ kalırdı. Ayrı bir repo ile her
# kovanın TEK BAŞINA bir envanter rotasını "sınıflandırılmış" saydığını sına.
# =============================================================================
REPO3="$TMP/repo3"
mkdir -p "$REPO3/src" "$REPO3/guards"
cat > "$REPO3/src/qux.controller.ts" << 'EOF'
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('qux')
@UseGuards(JwtAuthGuard)
export class QuxController {
  @Get('only')
  only() {
    return 'only';
  }
}
EOF
check_single_bucket_absorbs() { # <kova-adı> <a1-içerik> <a2-içerik> <b-içerik> <c-içerik>
  local label="$1" a1="$2" a2="$3" b="$4" c="$5"
  printf '%s\n%s\n' "# scope-ratchet: A1 — fixture" "$a1" > "$REPO3/guards/a1.txt"
  printf '%s\n%s\n' "# scope-ratchet: A2 — fixture" "$a2" > "$REPO3/guards/a2.txt"
  printf '%s\n%s\n' "# scope-ratchet: B — fixture"  "$b"  > "$REPO3/guards/b.txt"
  printf '%s\n%s\n' "# scope-ratchet: C — fixture"  "$c"  > "$REPO3/guards/c.txt"
  local out rc
  out="$(SCOPE_RATCHET_SRC_DIR="$REPO3/src" SCOPE_RATCHET_A1="$REPO3/guards/a1.txt" SCOPE_RATCHET_A2="$REPO3/guards/a2.txt" SCOPE_RATCHET_B="$REPO3/guards/b.txt" SCOPE_RATCHET_C="$REPO3/guards/c.txt" GUARD_MODE=report bash "$GUARD" 2>&1)"
  rc=$?
  if [ "$rc" -eq 2 ] && printf '%s\n' "$out" | grep -q "sınıflandırılmamış"; then
    echo "!! self-test FAIL [case 8/9: $label]: TEK BAŞINA $label kovası envanter rotasını ABSORBE ETMEDİ (yanlışlıkla 'sınıflandırılmamış' dendi)" >&2
    printf '%s\n' "$out" >&2
    FAIL=1
  elif [ "$rc" -eq 2 ]; then
    echo "!! self-test FAIL [case 8/9: $label]: beklenmeyen exit 2 (sınıflandırılmamış DIŞINDA bir sebep)" >&2
    printf '%s\n' "$out" >&2
    FAIL=1
  else
    echo "-- [case 8/9: $label] TEK BAŞINA $label kovası envanter rotasını (qux/only) doğru absorbe etti"
  fi
}
QUX_KEY="src/qux.controller.ts|GET|qux/only	# test"
DUMMY_A1="src/permanent-dummy.controller.ts|GET|permanent/dummy-a1	# dummy"
DUMMY_A2="src/permanent-dummy.controller.ts|GET|permanent/dummy-a2	# dummy"
DUMMY_B="src/permanent-dummy.controller.ts|GET|permanent/dummy-b	# dummy"
DUMMY_C="src/permanent-dummy.controller.ts|GET|permanent/dummy-c	# dummy"
check_single_bucket_absorbs "A1" "$QUX_KEY" "$DUMMY_A2" "$DUMMY_B" "$DUMMY_C"
check_single_bucket_absorbs "A2" "$DUMMY_A1" "$QUX_KEY" "$DUMMY_B" "$DUMMY_C"
check_single_bucket_absorbs "B"  "$DUMMY_A1" "$DUMMY_A2" "$QUX_KEY" "$DUMMY_C"
check_single_bucket_absorbs "C"  "$DUMMY_A1" "$DUMMY_A2" "$DUMMY_B" "$QUX_KEY"
# POZ. KONTROL — qux/only HİÇBİR kovada değilken exit 2 vermeli (aksi hâlde
# yukarıdaki dört "geçti" mesajı guard'ın HER ZAMAN yeşil döndüğü için de çıkmış olabilir).
check_single_bucket_absorbs_neg() {
  printf '%s\n%s\n' "# scope-ratchet: A1 — fixture" "$DUMMY_A1" > "$REPO3/guards/a1.txt"
  printf '%s\n%s\n' "# scope-ratchet: A2 — fixture" "$DUMMY_A2" > "$REPO3/guards/a2.txt"
  printf '%s\n%s\n' "# scope-ratchet: B — fixture"  "$DUMMY_B" > "$REPO3/guards/b.txt"
  printf '%s\n%s\n' "# scope-ratchet: C — fixture"  "$DUMMY_C" > "$REPO3/guards/c.txt"
  local out rc
  out="$(SCOPE_RATCHET_SRC_DIR="$REPO3/src" SCOPE_RATCHET_A1="$REPO3/guards/a1.txt" SCOPE_RATCHET_A2="$REPO3/guards/a2.txt" SCOPE_RATCHET_B="$REPO3/guards/b.txt" SCOPE_RATCHET_C="$REPO3/guards/c.txt" GUARD_MODE=report bash "$GUARD" 2>&1)"
  rc=$?
  if [ "$rc" -ne 2 ] || ! printf '%s\n' "$out" | grep -qF "qux.controller.ts|GET|qux/only"; then
    echo "!! self-test FAIL [case 8/9 POZ. KONTROL]: qux/only HİÇBİR kovada değilken exit 2 + isimlendirme BEKLENİYORDU" >&2
    printf '%s\n' "$out" >&2
    FAIL=1
  else
    echo "-- [case 8/9 POZ. KONTROL] qux/only hiçbir kovada değilken doğru şekilde 'sınıflandırılmamış' → exit 2"
  fi
}
check_single_bucket_absorbs_neg

if [ "$FAIL" -ne 0 ]; then
  {
    echo "!!"
    echo "!! scope-ratchet self-test'i kendi fixture matrisini geçemedi. Bu, üretim"
    echo "!! rota sınıflandırmasının doğru olduğu anlamına GELMEZ — guard'ın ölçüm"
    echo "!! yaptığı anlamına gelmez."
  } >&2
  exit 1
fi

exit 0

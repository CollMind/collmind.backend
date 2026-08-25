#!/usr/bin/env bash
# B3 Dalga-M — ROTA BAŞINA TEK MEKANİZMA kapısı.
#
# Bir rota `@Roles` VEYA `@RequireCapability` taşır, İKİSİNİ BİRDEN DEĞİL.
# Sebep: iki mekanizma aynı rotada birbirini GEVŞETİR — hangisinin bağladığı
# bir OKUMA sorusu olur, ve `İlke 4` (aynı olgunun iki temsili) doğar.
#
# ⛔ 0 İHLAL BEKLENEN DURUMDUR — ve gerekçesi W1'den (2026-08-25) beri
# DEĞİŞTİ: artık "göç başlamadı" değil, "göç eden her rota TEK mekanizma
# taşıyor" demek. Sıfır bir BAŞARI OLAYI DEĞİL, sağlıklı hâl. Bu yüzden burada
# `Z29`'un "boş baseline = setup hatası" tuzağı YOK: sıfır ihlal sessizce
# yeşildir, ve ölçülen SAYILAR her koşumda BASILIR ki kapsam görünür kalsın.
#
# Kanonik ayrıştırıcı: route-scope.awk (9. sütun = hasCapability). İkinci bir
# rota ayrıştırıcısı YAZILMAZ.
#
# self-test:  bash scripts/guards/single-mechanism.sh --self-test
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
AWK_FILE="$HERE/route-scope.awk"
# ⚠️ SRC_ROOT run_gate İÇİNDE çözülür, script yüklenirken DEĞİL. İlk yazımda
# tepede donduruluyordu ve `SINGLE_MECH_SRC` override'ı ETKİSİZDİ — self-test'in
# C/D senaryoları gerçek `src`'yi tarayıp yeşil dönüyordu (§2.7 #4: kanıt
# kurulumu ölçülen durumu HİÇ KURMAMIŞTI). Self-test bunu yakaladı.

scan() {
  local root="$1"
  local files
  files=$(find "$root" -name '*.controller.ts' -type f 2>/dev/null | sort)
  [ -z "$files" ] && { echo "SETUP HATASI: '$root' altında controller yok" >&2; return 2; }
  # shellcheck disable=SC2086
  awk -f "$AWK_FILE" $files
}

run_gate() {
  local out both roles caps total src_root
  src_root="${SINGLE_MECH_SRC:-$ROOT/src}"
  out=$(scan "$src_root") || return 2
  total=$(printf '%s\n' "$out" | grep -c .)
  roles=$(printf '%s\n' "$out" | awk -F'\t' '$5=="1"' | grep -c . || true)
  caps=$(printf '%s\n' "$out" | awk -F'\t' '$9=="1"' | grep -c . || true)
  # N-1 (W1 review): ÜÇ mekanizma çifti de sayılır, yalnız ROLES×CAPABILITY
  # değil. @Public + @RequireCapability özellikle sinsi: JwtAuthGuard atlanır,
  # req.user OLMAZ, capability.guard `!user -> false` verir ⇒ KALICI 403 ÖLÜ
  # ROTA — ve route-scope onu "PUBLIC" diye sınıflar, yani hiçbir kapı görmez.
  # SELF×CAPABILITY de aynı aile (iki farklı yüklem, hangisi bağlıyor?).
  # Bugün üçü de 0 (ölçüldü), ama kova sırası bunları SESSİZCE çözüyordu.
  both=$(printf '%s\n' "$out" | awk -F'\t' '
    ($5=="1" && $9=="1") { printf "%s\t%s\t%s\t%s\t@Roles+@RequireCapability\n",$1,$2,$3,$4 }
    ($6=="1" && $9=="1") { printf "%s\t%s\t%s\t%s\t@Public+@RequireCapability\n",$1,$2,$3,$4 }
    ($8=="1" && $9=="1") { printf "%s\t%s\t%s\t%s\t@SelfScoped+@RequireCapability\n",$1,$2,$3,$4 }
  ' || true)

  echo "=== [single-mechanism] rota başına tek mekanizma ==="
  echo "  toplam rota      : $total"
  echo "  @Roles           : $roles"
  echo "  @RequireCapability: $caps"

  local viol=0

  if [ -n "$both" ]; then
    echo "  ⛔ İHLAL — aynı rotada İKİ mekanizma:"
    printf '%s\n' "$both" | awk -F'\t' '{printf "     %s %s  [%s]  (%s:%s)\n",$3,$4,$5,$1,$2}'
    echo "  Bir rota @Roles VEYA @RequireCapability taşır, ikisini birden DEĞİL."
    viol=1
  else
    echo "  ✅ iki mekanizmayı birden taşıyan rota yok"
  fi

  # ── KURAL 2 (S2) — FAIL-OPEN kipi: yetenek bildirildi ama guard TAKILMADI.
  # @RequireCapability taşıyan bir rotanın controller'ında CapabilityGuard yoksa
  # guard HİÇ KOŞMAZ → yetenek metadata'sı YOK SAYILIR → RolesGuard da
  # requiredRoles bulamayıp `true` döner ⇒ rota her kimliği doğrulanmış
  # kullanıcıya AÇIK. Bu, mekanizmanın TAM OLARAK fail-open başarısızlık kipi.
  # Veri zaten tuple'da (7. sütun = guardsCSV) — ayrı bir tarama YAZILMAZ.
  local unguarded
  unguarded=$(printf '%s\n' "$out" | awk -F'\t' '$9=="1" && $7 !~ /CapabilityGuard/' || true)
  if [ -n "$unguarded" ]; then
    echo "  ⛔ İHLAL — @RequireCapability var ama CapabilityGuard TAKILI DEĞİL (FAIL-OPEN):"
    printf '%s\n' "$unguarded" | awk -F'\t' '{printf "     %s %s  guards=[%s]  (%s:%s)\n",$3,$4,$7,$1,$2}'
    echo "  Guard koşmazsa yetenek yok sayılır ve rota HERKESE açılır."
    viol=1
  else
    echo "  ✅ yetenek bildiren her rotada CapabilityGuard takılı"
  fi

  # ⛔ İHLAL için 3, SETUP HATASI için 2 — run-all.sh taksonomisinde
  # exit 2 = "ölçüm YAPILMADI, bulgu DEĞİL". İkisini aynı koda yıkmak
  # yanlış teşhis bastırır (S4).
  [ "$viol" -eq 1 ] && return 3
  return 0
}

self_test() {
  local tmp rc fail=0
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  # case A — YALNIZ @Roles → exit 0
  mkdir -p "$tmp/a"
  cat > "$tmp/a/a.controller.ts" <<'EOF'
@Controller('a')
export class AController {
  @Get('x')
  @Roles(UserRole.ADMIN)
  x() {}
}
EOF
  SINGLE_MECH_SRC="$tmp/a" run_gate >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then echo "-- [case A] yalnız @Roles → exit 0"; else echo "⛔ [case A] beklenen 0, gelen $rc"; fail=1; fi

  # case B — YALNIZ @RequireCapability → exit 0
  mkdir -p "$tmp/b"
  # ⚠️ @UseGuards(CapabilityGuard) ŞART — yoksa KURAL 2 bunu haklı olarak
  # FAIL-OPEN sayar. İlk yazımda eksikti ve self-test yakaladı: fixture, tek
  # kurallı dünyaya göre yazılmıştı.
  cat > "$tmp/b/b.controller.ts" <<'EOF'
@Controller('b')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class BController {
  @Get('x')
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  x() {}
}
EOF
  SINGLE_MECH_SRC="$tmp/b" run_gate >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then echo "-- [case B] yalnız @RequireCapability → exit 0"; else echo "⛔ [case B] beklenen 0, gelen $rc"; fail=1; fi

  # case C — POZİTİF KONTROL: İKİSİ BİRDEN → exit 2, rota ADLANDIRILIR
  mkdir -p "$tmp/c"
  cat > "$tmp/c/c.controller.ts" <<'EOF'
@Controller('c')
export class CController {
  @Get('boom')
  @Roles(UserRole.ADMIN)
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  x() {}
}
EOF
  local outc
  outc=$(SINGLE_MECH_SRC="$tmp/c" run_gate 2>&1); rc=$?
  if [ "$rc" -eq 3 ] && printf '%s' "$outc" | grep -q 'c/boom'; then
    echo "-- [case C] POZ.KONTROL: iki mekanizma → exit 3 (İHLAL), rota adlandırıldı"
  else
    echo "⛔ [case C] beklenen exit 3 + rota adı; gelen rc=$rc"; printf '%s\n' "$outc"; fail=1
  fi

  # case E — POZ.KONTROL (S2): yetenek var, CapabilityGuard YOK → FAIL-OPEN
  mkdir -p "$tmp/e"
  cat > "$tmp/e/e.controller.ts" <<'EOF'
@Controller('e')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EController {
  @Get('open')
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  x() {}
}
EOF
  local oute
  oute=$(SINGLE_MECH_SRC="$tmp/e" run_gate 2>&1); rc=$?
  if [ "$rc" -eq 3 ] && printf '%s' "$oute" | grep -q 'FAIL-OPEN'; then
    echo "-- [case E] POZ.KONTROL: yetenek var, guard YOK → exit 3 (FAIL-OPEN yakalandı)"
  else
    echo "⛔ [case E] beklenen exit 3 + FAIL-OPEN; gelen rc=$rc"; printf '%s\n' "$oute"; fail=1
  fi

  # case F — yetenek var VE CapabilityGuard takılı → exit 0
  mkdir -p "$tmp/f"
  cat > "$tmp/f/f.controller.ts" <<'EOF'
@Controller('f')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class FController {
  @Get('ok')
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  x() {}
}
EOF
  SINGLE_MECH_SRC="$tmp/f" run_gate >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then echo "-- [case F] yetenek + CapabilityGuard → exit 0"; else echo "⛔ [case F] beklenen 0, gelen $rc"; fail=1; fi

  # case G — POZ.KONTROL (S1): CLASS seviyesi @Roles + ROTA @RequireCapability.
  # Nest'in getAllAndOverride([handler, class])'ı ikisini de okur; kapı da
  # okumalı. İlk yazımda yalnız rota-seviyesi sayılıyordu ve bu şekil kapıya
  # GÖRÜNMÜYORDU (ad, koruduğu SINIFTAN dardı).
  mkdir -p "$tmp/g"
  cat > "$tmp/g/g.controller.ts" <<'EOF'
@Controller('g')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Roles(UserRole.ADMIN)
export class GController {
  @Get('boom')
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  x() {}
}
EOF
  local outg
  outg=$(SINGLE_MECH_SRC="$tmp/g" run_gate 2>&1); rc=$?
  if [ "$rc" -eq 3 ] && printf '%s' "$outg" | grep -q 'g/boom'; then
    echo "-- [case G] POZ.KONTROL: CLASS @Roles + rota @RequireCapability → exit 3"
  else
    echo "⛔ [case G] beklenen exit 3 + rota adı; gelen rc=$rc"; printf '%s\n' "$outg"; fail=1
  fi

  # case H — class seviyesi bayrak SONRAKİ DOSYAYA SIZMAMALI (state leak).
  mkdir -p "$tmp/h"
  cp "$tmp/g/g.controller.ts" "$tmp/h/aaa.controller.ts"
  cat > "$tmp/h/zzz.controller.ts" <<'EOF'
@Controller('z')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class ZController {
  @Get('clean')
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  x() {}
}
EOF
  local outh
  outh=$(SINGLE_MECH_SRC="$tmp/h" run_gate 2>&1); rc=$?
  if [ "$rc" -eq 3 ] && printf '%s' "$outh" | grep -q 'g/boom' && ! printf '%s' "$outh" | grep -q 'z/clean'; then
    echo "-- [case H] class bayrağı sonraki dosyaya SIZMIYOR (yalnız g/boom bulundu)"
  else
    echo "⛔ [case H] sızıntı ya da yanlış tespit; rc=$rc"; printf '%s\n' "$outh"; fail=1
  fi

  # case I — POZ.KONTROL (N-1): @Public + @RequireCapability. JwtAuthGuard
  # atlanır → req.user yok → guard false → KALICI 403 ölü rota; route-scope
  # onu "PUBLIC" sanır. Kapı bunu görmeli.
  mkdir -p "$tmp/i"
  cat > "$tmp/i/i.controller.ts" <<'EOF'
@Controller('i')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class IController {
  @Get('dead')
  @Public()
  @RequireCapability(CAPABILITIES.ADMIN_READ)
  x() {}
}
EOF
  local outi
  outi=$(SINGLE_MECH_SRC="$tmp/i" run_gate 2>&1); rc=$?
  if [ "$rc" -eq 3 ] && printf '%s' "$outi" | grep -q '@Public+@RequireCapability'; then
    echo "-- [case I] POZ.KONTROL: @Public + @RequireCapability → exit 3, çift ADLANDIRILDI"
  else
    echo "⛔ [case I] beklenen exit 3 + çift adı; gelen rc=$rc"; printf '%s\n' "$outi"; fail=1
  fi

  # case D — boş kaynak → SETUP HATASI (sessiz yeşil DEĞİL)
  mkdir -p "$tmp/d"
  SINGLE_MECH_SRC="$tmp/d" run_gate >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 2 ]; then echo "-- [case D] boş kaynak → exit 2 (SETUP HATASI)"; else echo "⛔ [case D] beklenen 2, gelen $rc"; fail=1; fi

  [ "$fail" -eq 0 ] && echo "-- single-mechanism self-test: 9 senaryo tutuyor" && return 0
  echo "⛔ single-mechanism self-test DÜŞTÜ"; return 2
}

case "${1:-}" in
  --self-test) self_test ;;
  *) run_gate ;;
esac

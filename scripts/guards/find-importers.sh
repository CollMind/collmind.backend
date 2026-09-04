#!/usr/bin/env bash
#
# find-importers.sh — bir dizin/modülü İÇE AKTARAN her dosyayı bulur (T-212 Kalem 4)
#
# NEDEN (CLAUDE.md · "Ve bir import taraması, göreli yolun HER yazımını
# kapsamalıdır")
#
# Aynı hedef göreli bir yoldan üç (ya da daha fazla) şekilde yazılabilir:
#
#   './x'  ·  '../x'  ·  '../../x'  ·  bir alias
#
# Hepsi AYNI hedefi gösterir, ve tek bir öneki aramak tüketici sayısını
# SİSTEMATİK OLARAK DÜŞÜK gösterir. Ölçülmüş vaka (2026-08-14, iki ayrı
# turda), `entities/index.ts`'in tüketicisi arandı:
#
#   tur 1   grep "from './entities'"       → 1
#   tur 2   grep "entities'" (dizin adıyla) → 3
#           (database.module · typeorm.config · master-data.module)
#
# Birinci ölçüm bir KALDIRMA KARARININ girdisiydi ("tek tüketici, kaldırması
# dar") — oysa tüketicilerden biri KANONİK OLACAK DOSYANIN KENDİSİYDİ. Bu
# araç o hatayı bir daha üretmemek için var: göreli önekle değil, DİZİN
# ADIYLA arar.
#
# Bu bir GATE değildir — repoyu kırmaz, bir eşiğe karşı sınamaz. Bir
# KALDIRMA/TAŞIMA kararı vermeden önce elle çağrılan bir ENVANTER aracıdır.
# "Kapı" olan tek şey kendi self-test'idir: çıkarıcı bozulursa araç kendi
# doğruluğuna güvenmez ve exit 2 verir — sonucu hiç basmaz.
#
# Kullanım:
#   find-importers.sh <dizin-adı> [arama-kökü ...]
#
#   <dizin-adı>      hedef dizin/modülün BASENAME'i (ör. "entities"), bir
#                    yol DEĞİL — 'src/database/entities' değil 'entities'.
#                    Yalnız [A-Za-z0-9_-] kabul edilir (regex kaçışı riski
#                    olmayan bir alfabe; başka bir karakter kurulum hatası).
#   [arama-kökü ...] taranacak dizin(ler); verilmezse "src test".
#
# Çıktı:  <dosya>:<satır>:<eşleşen satır>   — bulunan HER importer, TAM LİSTE
#         (§7.1: "bir sayı, eşleşmeleri ÖRNEKLENMEDEN raporlanamaz" — liste
#         zaten örnektir, ayrı bir örnekleme adımı gerektirmez)
#
# Çıkış:  0  çalıştı (bulgu SIFIR olabilir — bu bir hata değil, envanterin
#            kendisi boş olabilir)
#         1  kullanım hatası (eksik argüman, geçersiz dizin adı)
#         2  self-test / kurulum hatası — ÖLÇÜM YAPILMADI, çıktıya güvenme
set -uo pipefail

TOOL_NAME="find-importers"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# ═══════════════════════════════════════════════ THE çıkarıcı — TEK uygulama
# Hem self-test hem üretim yolu bu fonksiyondan geçer (ADR 0007 E16 dersi:
# bir kontrolü sınayan test, kontrolün kopyasını çalıştırmamalı — kopya
# orijinaldeki regresyonu görmez).
#
# Eşleşme: `from`/`require(` sonrası tırnaklı bir metin YOLUN SON SEGMENTİ
# olarak dizin adını taşıyor mu? Önündeki './' '../' '../../' ya da bir
# alias önemli değil — hepsi `([^'"]*/)?` grubuna düşer. Bare import (önek
# YOK, ör. path-mapped bir alias `'entities'`) de kapsanır. `/index` sonu
# isteğe bağlı kapsanır (yaygın bir barrel-import biçimi).
#
# Neden ^ ANKORU KULLANILMADI: `(^|/)` bir grup içinde POSIX ERE'de taşınabilir
# değildir (^ yalnız desenin tam BAŞINDA anchor'dır, bir grup içinde
# implementasyona göre değişir — money-float.sh'ın `\?` E15 dersiyle aynı
# sınıf: taşınmaz bir regex özelliği sessizce hiçbir şey eşlemeyebilir).
# `([^'"]*/)?DİZİN` biçimi aynı iki durumu (önekli/öneksiz) ^ olmadan kapsar.
extract_importers() {
  local dirname="$1"; shift
  local roots=("$@")
  [ "${#roots[@]}" -gt 0 ] || return 0
  grep -rnE --include='*.ts' \
    "(from|require\()[[:space:]]*['\"]([^'\"]*/)?${dirname}(/index)?['\"]" \
    "${roots[@]}" 2>/dev/null
}

# ═══════════════════════════════════════════════════════ POZİTİF KONTROL
# Beklenen değerler ölçümden ÖNCE yazılıdır (CLAUDE.md · negatif sonuçlu
# tarama pozitif kontrolsüz raporlanamaz kuralının burada uygulanışı: sıfır
# bulgu döndüren bir çağıran, çıkarıcının BOZUK olduğunu göremez).
self_test() {
  local tmp fail=0 out want got
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  mkdir -p "$tmp/pkg/sub"

  # üç göreli yazım — hepsi AYNI hedefi (dizin adı: entities) göstermeli
  printf "import { X } from './entities';\n"        > "$tmp/f-dot.ts"
  printf "import { X } from '../entities';\n"        > "$tmp/pkg/f-dotdot.ts"
  printf "import { X } from '../../entities';\n"     > "$tmp/pkg/sub/f-dotdotdot.ts"
  # require() biçimi — farklı yazım, aynı hedef
  printf "const x = require('../../database/entities');\n" > "$tmp/pkg/f-require.ts"
  # barrel-import biçimi: /index sonu
  printf "import { X } from '../entities/index';\n"  > "$tmp/pkg/f-index.ts"

  # NEGATİF kontrol 1: dizin adı bir ALT DİZE olarak geçiyor ama YOL SEGMENTİ
  # değil ("not-entities" ≠ "entities" — sınır: hemen önünde '/' ya da tırnak
  # olmalı, tire değil)
  printf "import { X } from '../not-entities';\n"    > "$tmp/pkg/f-decoy1.ts"
  # NEGATİF kontrol 2: dizin adından sonra fazladan karakter var
  # ("entities-extra" ≠ "entities" — hemen sonrası ) kapanış tırnağı olmalı)
  printf "import { X } from '../entities-extra';\n"  > "$tmp/pkg/f-decoy2.ts"
  # NEGATİF kontrol 3: yorum satırı — grep satır-bazlı taradığı için BULUNUR
  # (bu araç bir yorum filtresi taşımaz; money-float.sh'tan FARKLI olarak
  # niyeti "her metinsel referansı say", bilinçli tasarım — bir importer'ı
  # yorumlayan bir satır da kararla ilgili bir sinyaldir)
  printf "// import { X } from '../entities'; (geçici devre dışı)\n" > "$tmp/pkg/f-comment.ts"

  out="$(extract_importers 'entities' "$tmp")"

  want=6
  got="$(printf '%s\n' "$out" | grep -c ":" || true)"
  if [ "$got" != "$want" ]; then
    echo "!! self-test DÜŞTÜ: beklenen $want eşleşme (3 göreli önek + require + /index + yorumdaki referans), bulunan $got" >&2
    printf '%s\n' "$out" >&2
    fail=1
  fi

  for f in f-dot f-dotdot f-dotdotdot f-require f-index f-comment; do
    if ! grep -q "/$f\.ts:" <<< "$out"; then
      echo "!! self-test DÜŞTÜ: $f.ts eşleşmeliydi, eşleşmedi" >&2
      fail=1
    fi
  done
  for f in f-decoy1 f-decoy2; do
    if grep -q "/$f\.ts:" <<< "$out"; then
      echo "!! self-test DÜŞTÜ: $f.ts YANLIŞ POZİTİF — dizin adı ALT DİZE olarak eşleşti, SEGMENT olarak değil" >&2
      fail=1
    fi
  done

  return $fail
}

usage() {
  echo "kullanım: $TOOL_NAME.sh <dizin-adı> [arama-kökü ...]" >&2
  echo "  <dizin-adı>: hedef dizin/modülün basename'i (yol değil), ör. 'entities'" >&2
  echo "  [arama-kökü ...]: verilmezse 'src test'" >&2
}

if ! self_test; then
  {
    echo "!!"
    echo "!! $TOOL_NAME kendi çıkarıcısını doğrulayamadı — ÖLÇÜM YAPILMADI."
    echo "!! Bu araç önce kendi self-test'ini geçmeden hiçbir sonuç basmaz;"
    echo "!! aksi hâlde bozuk bir regex sessizce 'tüketici yok' der ve o"
    echo "!! sayı bir kaldırma kararının girdisi olarak kullanılabilir."
  } >&2
  exit 2
fi

DIRNAME="${1:-}"
if [ -z "$DIRNAME" ]; then
  usage
  exit 1
fi
case "$DIRNAME" in
  */*)
    echo "!! [$TOOL_NAME] HATA: '$DIRNAME' bir YOL içeriyor — bu araç bir dizin ADI bekler, yol değil" >&2
    echo "!! (yol vermek, tam olarak bu aracın önlemek için var olduğu düşük-sayım hatasını üretir)" >&2
    exit 1
    ;;
  *[!A-Za-z0-9_-]*|'')
    echo "!! [$TOOL_NAME] HATA: geçersiz dizin adı '$DIRNAME' — yalnız [A-Za-z0-9_-] kabul edilir" >&2
    exit 1
    ;;
esac
shift || true

ROOTS=("$@")
if [ "${#ROOTS[@]}" -eq 0 ]; then
  ROOTS=(src test)
fi
for r in "${ROOTS[@]}"; do
  if [ ! -d "$r" ]; then
    echo "!! [$TOOL_NAME] HATA: arama kökü bulunamadı: $r" >&2
    exit 1
  fi
done

OUT="$(extract_importers "$DIRNAME" "${ROOTS[@]}")"
N="$(printf '%s\n' "$OUT" | grep -c ":" || true)"

echo "== $TOOL_NAME: '$DIRNAME' — $N tüketici (kök: ${ROOTS[*]}) =="
if [ "$N" -gt 0 ]; then
  printf '%s\n' "$OUT"
else
  echo "(tüketici bulunamadı)"
fi

exit 0

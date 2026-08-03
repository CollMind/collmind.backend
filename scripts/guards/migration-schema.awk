# migration-schema guard — template literal çıkarıcı (INV-M-002)
#
# Neden ayrı dosya: awk programı tek tırnaklı bash dizgisi içine gömülünce hem
# tırnak kaçışları ('"'"') okunmaz hâle geliyor hem de Türkçe kesme işareti bash
# tırnağını kapatıyor. Ayrı .awk dosyası ikisini de ortadan kaldırır.
#
# Neden lexer: önceki iki yaklaşım da SEZGİSELDİ ve ikisi de sessiz yanlış
# negatif üretti:
#   1. ±10 satırlık pencere  → komşu sorgu maskeliyordu
#   2. backtick paritesi + yorum ön-temizliği → `*` ile başlayan SQL satırı
#      (`SELECT\n  * FROM ...`) yorum sanılıp backtick'i siliniyordu; parite
#      kayıyor, guard hiçbir çıktı vermeden yeşil dönüyordu.
# Sezgisel yok artık: literal içi/dışı durumu karakter karakter izleniyor.
# Bir `//` ancak literal DIŞINDAYSA yorumdur; bir `*` hiçbir zaman tek başına
# yorum başlatmaz.
#
# Bilinen sınır: tek bir literal içinde birden çok catalogue sorgusu varsa blok
# bütün olarak değerlendirilir (biri nitelendirilmişse diğeri maskelenebilir).
# Bugün böyle bir blok var: 1795000000000-AddSpendTypeToBudgetDimensions.ts:148-160
# — maskeleme yok, ikisi de `table_schema = 'main'` taşıyor.

BEGIN {
  SQ  = sprintf("%c", 39)
  BT  = sprintf("%c", 96)
  CAT    = "pg_constraint|pg_indexes|pg_class|pg_tables|information_schema"
  SCHEMA = "nspname|schemaname|table_schema"

  inLit = 0; inBlockComment = 0; buf = ""; startline = 0
}

# Bir template literal bloğunu değerlendirir ve gerekirse bulgu basar.
function evaluate(b, s,   n, L, i, t, cat) {
  if (b !~ CAT)    return       # catalogue sorgusu yok
  if (b ~ SCHEMA)  return       # sorgunun kendisinde şema predicate-i var

  # Şema-güvenli desenler: nitelendirilmiş literal zaten şemayı belirtir.
  if (b ~ (SQ "[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*" SQ "[ \t]*::[ \t]*regclass")) return
  if (b ~ ("to_regclass\\([ \t]*" SQ "[A-Za-z_][A-Za-z0-9_]*\\.")) return
  if (b ~ /::[ \t]*regnamespace/) return

  n = split(b, L, "\n")
  for (i = 1; i <= n; i++) {
    if (L[i] !~ CAT) continue
    t = L[i]; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
    if (t ~ /^--/) continue     # SQL yorum satırı
    match(t, CAT); cat = substr(t, RSTART, RLENGTH)
    printf "[%s] %s:%d\n", guard, file, s + i - 1
    printf "  %s sorgusunda şema predicate%si yok\n", cat, SQ
    printf "  > %s\n", t
    return
  }
}

{
  line = $0
  n = length(line)
  i = 1

  while (i <= n) {
    c   = substr(line, i, 1)
    two = substr(line, i, 2)

    if (inBlockComment) {
      if (two == "*/") { inBlockComment = 0; i += 2; continue }
      i++; continue
    }

    if (inLit) {
      if (c == "\\") { buf = buf substr(line, i, 2); i += 2; continue }   # kaçırılmış karakter
      if (c == BT)   { inLit = 0; evaluate(buf, startline); buf = ""; i++; continue }
      buf = buf c; i++; continue
    }

    # --- literal DIŞI ---
    if (two == "//") break                                   # satır sonuna kadar yorum
    if (two == "/*") { inBlockComment = 1; i += 2; continue }
    if (c == SQ || c == "\"") {                              # normal dizgi: içindeki backtick sayılmaz
      q = c; i++
      while (i <= n) {
        cc = substr(line, i, 1)
        if (cc == "\\") { i += 2; continue }
        if (cc == q)    { i++; break }
        i++
      }
      continue
    }
    if (c == BT) { inLit = 1; buf = ""; startline = NR; i++; continue }
    i++
  }

  if (inLit) buf = buf "\n"    # çok satırlı literal sürüyor
}

END {
  # Kapanmamış literal: dosya bozuk ya da lexer yanılmış. Sessizce geçmek
  # yanlış negatiftir; bloklayıcı bir kapıda bu kabul edilemez.
  if (inLit || inBlockComment) {
    printf "[%s] %s:%d\n", guard, file, startline
    printf "  kapanmamış template literal veya blok yorum — dosya güvenle taranamadı\n"
    printf "  > catalogue sorgularını elle doğrula\n"
  }
}

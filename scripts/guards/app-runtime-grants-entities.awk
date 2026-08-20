# app-runtime-grants guard — sınıf adı → TABLO adı eşlemesi (T-250, K-2.6.13f).
#
# CLAUDE.md: "bir varlığın yokluğunu sorarken TANIMININ yaşadığı yüzeyde ara" —
# tablo adı `@Entity({ name: '...' })`'den okunur, SINIF ADINDAN değil
# (`MechanicSpendBreakdown` sınıfı ↔ `mechanic_spend_breakdown` tablosu farklı
# yazılır, ve GRANT tablo adıyla yazılır).
#
# SABİT PENCERE YOK — T-249'un `grep -A2` tuzağının doğrudan düzeltmesi: o
# pencere `@Entity(...)` ile `export class ...` arasına `@Index(...)` gibi
# dekoratör satırları girdiğinde yetişmiyordu (11 tablonun 11'i "entity=YOK"
# çıkmıştı). Burada `@Entity(`/`@ViewEntity(` görüldükten SONRA, dekoratör
# satırı sayısı ne olursa olsun, İLK `export class` satırına kadar taranır
# (blok sınırı, satır sayısı değil).
#
# @ViewEntity de tanınır (BudgetSummaryView gibi) — kaynak A'yı GENİŞLETMEZ
# (bu guard yalnız forFeature/InjectRepository ile enjekte edilen sınıfları
# A'ya alır, ve BudgetSummaryView bugün HİÇBİRİNDEN enjekte edilmiyor — bkz.
# guard'ın kendi başlık yorumu, "ÜÇÜNCÜ KANAL" notu). Burada tanınması yalnız
# eşleme tablosunu eksiksiz tutar; zararsız fazlalık.
#
# Çıktı: `<SınıfAdı> <tablo_adı>` — boşlukla ayrılmış, satır başına bir çift.
#
# BİLİNEN SINIR: `@Entity()` boş ya da `name:` içermeyen bir formda
# kullanılırsa (TypeORM'un varsayılan tablo adı türetimi) bu sınıf
# EŞLENEMEZ ve stderr'e `UNMAPPED_ENTITY:<sınıf>` yazılır — guard'ın kendisi
# bunu SESSİZCE atlar (o sınıf kaynak A'da asla görünmez, yani bir yanlış
# pozitif üretmez, ama bir yanlış NEGATİF üretebilir: o sınıf gerçekten
# forFeature ile enjekte ediliyorsa bu guard onu hiç göremez). Bugün repoda
# vakası YOK (her @Entity açık `name:` taşıyor, ölçüldü) — İlke 1.

BEGIN { pending = 0; tbl = "" }

{
  line = $0
  sub(/\/\/.*/, "", line)

  if (line ~ /@Entity\(/ || line ~ /@ViewEntity\(/) {
    buf = line
    # Dekoratör tek satırda kapanmadıysa (bugün bu dosyalarda yok, ama
    # savunmalı) kapanana kadar devam et.
    while (buf !~ /\)[ \t]*$/ && (getline nextline) > 0) {
      sub(/\/\/.*/, "", nextline)
      buf = buf " " nextline
    }
    tbl = ""
    if (match(buf, /name:[ \t]*['"][a-zA-Z_][a-zA-Z0-9_]*['"]/)) {
      tok = substr(buf, RSTART, RLENGTH)
      gsub(/^name:[ \t]*['"]/, "", tok)
      gsub(/['"]$/, "", tok)
      tbl = tok
    }
    pending = 1
    next
  }

  # Dekoratör ile sınıf arasında kaç satır olursa olsun (index/unique/vb.),
  # ilk "export class" satırına kadar `pending` açık kalır.
  if (pending && match(line, /export class [A-Za-z_][A-Za-z0-9_]*/)) {
    cls = substr(line, RSTART, RLENGTH)
    sub(/^export class /, "", cls)
    if (tbl != "") {
      print cls, tbl
    } else {
      print "UNMAPPED_ENTITY:" cls > "/dev/stderr"
    }
    pending = 0
    tbl = ""
  }
}

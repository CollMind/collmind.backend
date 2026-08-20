# app-runtime-grants guard — kaynak A çıkarıcı (T-250, K-2.6.13f).
#
# Bir kaynak dosyada ÜÇ KANALI da tarar (CLAUDE.md: "bir kalıbı ararken her
# iki ucunu ara" — burada üç uç):
#   1. TypeOrmModule.forFeature([Entity1, Entity2, ...])  — modül kayıt kanalı
#   2. @InjectRepository(Entity)                          — DI enjeksiyon kanalı
#   3. dataSource.getRepository(Entity)                   — DOĞRUDAN erişim
#      kanalı (DUR #1, T-250 — `budget.repository.ts:488,502`'de
#      BudgetSummaryView için ÖLÇÜLDÜ: forFeature/InjectRepository'nin HİÇBİRİ
#      bu erişimi görmüyordu, guard'ın kendisi bu kanalla erişilen bir
#      entity'ye asla bulgu üretemiyordu — kör noktanın ta kendisi).
#
#      Sınıflandırma notu (ürün sahibi): bu, `find-importers.sh`'ın çözdüğü
#      "aynı hedef, başka yazım" sınıfının BİR DAHA vakası — orada bir
#      dizin üç göreli yoldan (`./x` · `../x` · dizin adı) içe aktarılıyordu,
#      burada aynı entity üç DI YOLUNDAN (modül kaydı / dekoratör enjeksiyonu
#      / doğrudan DataSource çağrısı) erişiliyor. Dördüncü bir yazım
#      (ör. değişkene alınmış bir `DataSource` referansı üzerinden çağrı,
#      `const ds = this.dataSource; ds.getRepository(...)`) bulunursa aynı
#      ailenin bir sonraki vakasıdır — `find-importers.sh`'ın kalıbına bak.
#
# ⚠️ KAPSAM SINIRI (ÇAĞIRAN TARAFTAN uygulanır, bu dosyada DEĞİL):
#   `dataSource.getRepository(...)` `src/database/seeds/` altında YOĞUN
#   olarak kullanılıyor (ölçüldü: 30+ çağrı, 20 dosya) — ama seed script'leri
#   `app_migrate` (DDL-yetkili CLI rolü) ile çalışır, `app_runtime` ile DEĞİL
#   (K-2.6.13). Bu dizini kaynak A'ya dahil etmek DÜZİNELERCE sahte bulgu
#   üretirdi (ör. `BudgetPolicy`/`FiscalPeriod` yalnız seed'de kullanılıyor,
#   `app_runtime`'a hiç GRANT edilmemiş VE edilmemesi de doğru — seed onları
#   `app_migrate` ile yazıyor). Bu yüzden çağıran (`app-runtime-grants.sh`)
#   `src/database/seeds/` dizinini TARAMA KÖKÜNDEN HARİÇ TUTAR. Bu dosya
#   (`*-source.awk`) kendi başına dizin farkı GÖZETMEZ — hangi dosyaların
#   ona verildiğine bağlıdır.
#
# SABİT PENCERE YOK (T-249'un iki kez düştüğü tuzak). Üç kanal da
# PARANTEZ/KÖŞELİ-PARANTEZ DENGESİYLE izlenir — çok satırlı bir forFeature
# listesi ya da (bugün yok ama savunmalı) çok satırlı bir InjectRepository/
# getRepository çağrısı, kapanış karakterine kadar TAKİP EDİLİR, sabit bir
# satır sayısına değil.
#
# `//` satır yorumları KABACA temizlenir (dize/URL içeriği ayırt edilmez —
# migration-schema.awk'daki tam lexer burada YOK, çünkü bu üç kanalın
# çağrıları bu repoda dize literal'i taşımıyor; bilinen sınır).
#
# Çıktı: her satırda bir SINIF ADI (büyük harfle başlayan tanımlayıcı).
# Aynı sınıf birden çok kanaldan gelebilir — tekilleştirme ÇAĞIRANDA yapılır.
#
# BİLİNEN SINIR (ölçüldü, T-250 DUR #1 turu): `manager.getRepository(X)` /
# `m.getRepository(X)` (transaction içi, ör. `budget-allocation.service.ts`)
# BİR DÖRDÜNCÜ KANAL OLARAK EKLENMEDİ — 14 sınıf ölçüldü ve HEPSİ zaten
# forFeature/InjectRepository birleşiminde MEVCUTTU (`comm -23` → 0 fark).
# Yani bugün eklemek kaynak A'yı DEĞİŞTİRMEZ (İlke 1: bugün vakası olmayan
# bir kanalı taramak fazladan karmaşıklıktır). Bu ölçüm bir GARANTİ DEĞİL —
# yalnız BUGÜNÜN durumu. `manager`/`m` yalnız `forFeature` ile kaydedilmemiş
# bir entity için kullanılırsa bu guard yine görmez; böyle bir vaka
# ÖLÇÜLÜRSE bu kanal da eklenir (aynı üç-kanal deseniyle).

BEGIN {
  ff_depth = 0; ff_buf = ""
  ir_depth = 0; ir_buf = ""
  dr_depth = 0; dr_buf = ""
}

# forFeature([...]) — köşeli parantez derinliği.
function scan_ff(s,   i, c, n, toks, j) {
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (ff_depth == 0) {
      if (c == "[") { ff_depth = 1; ff_buf = "" }
      continue
    }
    if (c == "[") { ff_depth++; ff_buf = ff_buf c; continue }
    if (c == "]") {
      ff_depth--
      if (ff_depth == 0) {
        n = split(ff_buf, toks, /[^A-Za-z0-9_]+/)
        for (j = 1; j <= n; j++) {
          if (toks[j] ~ /^[A-Z][A-Za-z0-9_]*$/) print toks[j]
        }
        ff_buf = ""
        return
      }
      ff_buf = ff_buf c
      continue
    }
    ff_buf = ff_buf c
  }
}

# InjectRepository(...) — normal parantez derinliği. Regex eşleşmesi açılış
# "("i ZATEN tükettiği için ir_depth çağıran tarafta 1'e önceden set edilir
# (bkz. ana kural) — aksi hâlde scan_ir hiçbir zaman "(" görmez ve derinlik
# hiç açılmaz (bu guard'ın ilk taslağında ölçülmüş bir kapanmama hatasıydı).
function scan_ir(s,   i, c, tok) {
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "(") { ir_depth++; ir_buf = ir_buf c; continue }
    if (c == ")") {
      ir_depth--
      if (ir_depth == 0) {
        tok = ir_buf
        sub(/,.*$/, "", tok)          # ikinci argüman (ör. connection name) yok say
        gsub(/[ \t]/, "", tok)
        if (tok ~ /^[A-Z][A-Za-z0-9_]*$/) print tok
        ir_buf = ""
        return
      }
      ir_buf = ir_buf c
      continue
    }
    ir_buf = ir_buf c
  }
}

# dataSource.getRepository(...) — InjectRepository ile AYNI parantez-denge
# mekaniği (kasten kopya, ayrı buffer/depth: aynı satırda ikisi bir arada
# olabilir — bugün yok ama bağımsız durumları paylaşmamaları gerekir).
function scan_dr(s,   i, c, tok) {
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "(") { dr_depth++; dr_buf = dr_buf c; continue }
    if (c == ")") {
      dr_depth--
      if (dr_depth == 0) {
        tok = dr_buf
        sub(/,.*$/, "", tok)
        gsub(/[ \t]/, "", tok)
        if (tok ~ /^[A-Z][A-Za-z0-9_]*$/) print tok
        dr_buf = ""
        return
      }
      dr_buf = dr_buf c
      continue
    }
    dr_buf = dr_buf c
  }
}

{
  line = $0
  sub(/\/\/.*/, "", line)

  if (ff_depth > 0) {
    scan_ff(line)
  } else if (match(line, /forFeature[ \t]*\(/)) {
    rest = substr(line, RSTART + RLENGTH)
    scan_ff(rest)
  }

  if (ir_depth > 0) {
    scan_ir(line)
  } else if (match(line, /InjectRepository[ \t]*\(/)) {
    rest = substr(line, RSTART + RLENGTH)
    ir_depth = 1
    ir_buf = ""
    scan_ir(rest)
  }

  # "this.dataSource.getRepository(" VE bare "dataSource.getRepository("
  # İKİSİNİ DE yakalar — sınır yalnız "dataSource" token'ının hemen
  # ÖNCESİNDE bir tanımlayıcı karakteri (harf/rakam/_) OLMAMASI: "." kabul
  # edilir (this.dataSource), satır başı/boşluk kabul edilir (bare
  # dataSource). Farklı adlandırılmış bir DataSource değişkeni (ör. `ds`)
  # bu desenle YAKALANMAZ — bilinen sınır, yukarıdaki başlık notuna bak.
  if (dr_depth > 0) {
    scan_dr(line)
  } else if (match(line, /(^|[^A-Za-z0-9_])dataSource[ \t]*\.[ \t]*getRepository[ \t]*\(/)) {
    rest = substr(line, RSTART + RLENGTH)
    dr_depth = 1
    dr_buf = ""
    scan_dr(rest)
  }
}

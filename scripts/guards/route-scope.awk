# route-scope guard — rota çıkarıcı ([[T-252]], ADIM 3 Faz B `B0`).
#
# Tek bir controller.ts dosyasını işler (çağıran `.sh` her dosya için ayrı
# invocation yapar — app-runtime-grants-entities.awk'ın deseni: dosyalar
# arası durum SIZDIRMAZ, her invocation temiz BEGIN state'iyle başlar).
#
# NE ÇIKARIR (her satır bir ROTA):
#   <dosya> <satır> <YÖNTEM> <yol> <hasRoles:0|1> <hasPublic:0|1> <guardsCSV|-> <hasSelfScoped:0|1> <hasCapability:0|1>
#
# hasCapability (9. sütun, `B3 Dalga-M`): rota `@RequireCapability(...)` taşıyor mu.
# EKLEME-ONLY: 1-8. sütunlar DEĞİŞMEDİ (ölçüldü 2026-08-25: 223/223 satırda
# 1-8 birebir aynı, poz.kontrollü). Bu tuple'ı okuyan ÜÇ tüketici var —
# `route-scope.sh` · `route-cell-map.py` (`len(c)<8`) · `scope-ratchet.sh` —
# ve üçü de kırılmadı (kendi self-test'leri rc=0).
# 9. sütunun tüketicisi: `scripts/guards/single-mechanism.sh`.
#
# ⚠️ SINIFLANDIRICI col9'u BİLMEZ: `route-scope.sh`'in dört kovası yalnız
# `@Roles`/`@Public`/`SELF`/`ALAN_GUARD` tanır. Bugün etkisi YOK (col9 223/223
# sıfır), ama İLK GÖÇEN ROTA `FILTRESIZ`/`A1`'e düşer — `Z26`/`Z28` emsalinde
# `@SelfScoped` turunda sınıflandırıcıya da bir kova eklenmişti. `Faz B`
# (`W1`) ön koşulu: kova eklenmeli.
#
# guardsCSV = CONTROLLER-seviyesi @UseGuards ∪ ROTA-seviyesi @UseGuards'taki
# guard adlarının virgülle ayrılmış, sıralı birleşimi ("-" boşsa).
#
# hasSelfScoped (8. sütun, `Z26`/`Z28` — `docs/brd-v2/04_KARAR_KAYDI.md`):
# `@SelfScoped()` dekoratörü — YALNIZ rota seviyesinde tanınır (`@Roles`/
# `@Public` ile AYNI kapsam modeli, ölçüldü: bugün repoda class-level
# `@SelfScoped()` YOK). `SELF_OLCUM_RAPORU.md §4`'ün ölçtüğü sessizlik
# ("`v1` çıplak `@SelfScoped()` → FILTRESIZ'de KALDI, EXIT=0") bu sütunun
# EKLENME gerekçesidir — dekoratör + bu ayrıştırıcı AYNI TURDA inmezse yeni
# bir `SELF` ucu hiç kırmızıya dönmeden FILTRESIZ'e düşer.
#
# --- KAPSAM MODELİ (ölçüldü, T-252 hazırlığı, 34 controller dosyasının
#     TAMAMI TARANDI) -----------------------------------------------------
#
#   @Roles / @Public       YALNIZ rota seviyesinde bulundu (34/34 dosyada
#                           class-level @Roles/@Public YOK — ölçüldü).
#   @UseGuards              HEM controller hem rota seviyesinde bulunabilir
#                           (reversal.controller.ts:28 controller-seviyesi,
#                           settlement.controller.ts:77 rota-seviyesi).
#   @Controller/@Roles/@Public/@UseGuards argümanları HEPSİ tek satırda
#                           dengeli (ölçüldü) — @Roles'ün rol listesi ÇOK
#                           SATIRLI olabilir (plan.controller.ts vb.) ve
#                           parantez derinliğiyle takip edilir (SABİT
#                           PENCERE YOK).
#
# --- BLOK SINIRI NASIL BULUNUR (SABİT PENCERE YOK) ------------------------
#
# Girinti bu kod tabanında YAPISAL bir sinyal (Prettier, ölçüldü — 34/34
# dosyada tutarlı):
#   0 boşluk + @   → CLASS-seviyesi dekoratör (@Controller/@UseGuards/...)
#   2 boşluk + @   → ROTA-seviyesi dekoratör (parametre dekoratörleri DEĞİL)
#   4+ boşluk      → parametre dekoratörü (@Body/@Param/@TenantId/...) VEYA
#                     gövde içeriği VEYA çok-satırlı bir dekoratörün argüman
#                     satırı — HİÇBİRİ blok sınırı ÜRETMEZ, sessizce atlanır
#   2 boşluk + @-DEĞİL (üçüncü karakter boşluk değil) → BLOK SINIRI: ya bir
#                     sonraki metodun imzası (FLUSH tetikler) ya bir önceki
#                     metodun kapanış `}`'ı (pending zaten boş, no-op FLUSH)
#
# Bu SATIR SAYISINA değil, GİRİNTİ + DEKORATÖR SÖZDİZİMİNE bağlıdır — bir
# metodun gövdesi kaç satır olursa olsun (T-249'un `grep -A2` tuzağı
# TEKRARLANMAZ).
#
# --- BİLİNEN SINIR (ölçüldü, kabul edildi) --------------------------------
#
# Yorum/blok-yorum satırları money-float ile AYNI sezgiyle atlanır (trim
# edilmiş satır `//`, `/*`, `*` ile başlıyorsa yok say) — tam bir lexer
# DEĞİL. Girinti + trim edilmiş `//`/`/*`/`*` önekiyle başlayan bir yorum
# satırı, blok sınırı ÜRETMEZ (pending'i bozmaz). Bu repo'da JSDoc bloklarının
# İÇİNDE bir dekoratör metni geçmiyor (ölçüldü) — geçseydi bu sezgi onu
# YANLIŞLIKLA bir dekoratör sanmazdı (yorum satırları @ ile BAŞLAMADIĞI
# sürece zaten dekoratör deseniyle eşleşmez), ama YANLIŞLIKLA blok sınırı da
# ÜRETMEZ (skip edilir) — güvenli yön.

function reset_pending() {
  p_has_http = 0
  p_http_method = ""
  p_http_path = ""
  p_http_line = 0
  p_has_roles = 0
  p_has_public = 0
  p_has_self_scoped = 0
  p_has_capability = 0
  delete rg
}

# Bir dekoratör başlangıç satırından adı çıkarır: "@Foo(" -> "Foo".
# RSTART/RLENGTH global'lerini kullanır (match() awk sözleşmesi).
function decorator_name(line,   save_rs, save_rl, nm) {
  save_rs = RSTART; save_rl = RLENGTH
  match(line, /@[A-Za-z_][A-Za-z0-9_]*\(/)
  nm = substr(line, RSTART + 1, RLENGTH - 2)
  RSTART = save_rs; RLENGTH = save_rl
  return nm
}

# Bir satırdaki net parantez dengesini döndürür ("(" +1, ")" -1) — decorator
# başlangıç satırının "@Foo(" kısmı DAHİL tüm satır verilir, yani ilk "("
# zaten sayılır (app-runtime-grants-source.awk'ın scan_ir'ıyla AYNI mekanik).
function paren_delta(s,   i, c, d) {
  d = 0
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "(") d++
    else if (c == ")") d--
  }
  return d
}

# Tek/çift tırnaklı İLK dizge literalini çıkarır ("" varsa arg yoktur).
function quoted_arg(s,   save_rs, save_rl, out) {
  save_rs = RSTART; save_rl = RLENGTH
  if (match(s, /'[^']*'/)) {
    out = substr(s, RSTART + 1, RLENGTH - 2)
  } else if (match(s, /"[^"]*"/)) {
    out = substr(s, RSTART + 1, RLENGTH - 2)
  } else {
    out = ""
  }
  RSTART = save_rs; RLENGTH = save_rl
  return out
}

# Metin içindeki büyük-harfle-başlayan tanımlayıcıları (guard sınıf adları)
# bir SET'e (assoc array, çağıranın verdiği isimle) ekler. Dekoratörün KENDİ
# adı ("@UseGuards(" içindeki "UseGuards") argüman sanılmasın diye ilk "("
# karakterine kadar olan kısım (dekoratör adının kendisi dahil) ÖNCE atılır
# — atılmazsa "UseGuards" kendi argüman listesine sızar (ölçüldü: ilk
# taslak `reversal.controller.ts` için "JwtAuthGuard,ReversalGuard,
# UseGuards" üretti).
function collect_identifiers(s, arr,   n, toks, j, body) {
  body = s
  sub(/^[^(]*\(/, "", body)
  n = split(body, toks, /[^A-Za-z0-9_]+/)
  for (j = 1; j <= n; j++) {
    if (toks[j] ~ /^[A-Z][A-Za-z0-9_]*$/) arr[toks[j]] = 1
  }
}

function finalize_decorator(name, text, is_class, line,   arg) {
  if (is_class) {
    if (name == "UseGuards") collect_identifiers(text, cg)
    else if (name == "Controller") ctrl_base = quoted_arg(text)
    # S1 (Dalga-M review): CLASS seviyesi @Roles / @RequireCapability de
    # KAYDEDİLİR. Nest'in `getAllAndOverride([handler, class])`'ı ikisini de
    # okur; yalnız rota-seviyesini saymak, "rota başına TEK mekanizma" kapısını
    # koruduğu SINIFTAN DAR yapıyordu (class @Roles + rota @RequireCapability
    # kapıya GÖRÜNMÜYORDU, ama guard fail-closed reddediyordu → sebebi hiçbir
    # kapıda görünmeyen ölü rota).
    # ⚠️ EKLEME-ONLY KALIR: bugün class-seviyesi @Roles sayısı 0 (ölçüldü
    # 2026-08-25; poz.kontrol: class-seviyesi @UseGuards 31), yani 5. sütun
    # bugünkü HİÇBİR satırda değişmiyor.
    else if (name == "Roles") c_has_roles = 1
    else if (name == "RequireCapability") c_has_capability = 1
    return
  }
  # rota seviyesi
  if (name == "Get" || name == "Post" || name == "Patch" || name == "Put" || name == "Delete") {
    p_has_http = 1
    p_http_method = toupper(name)
    p_http_line = line
    p_http_path = quoted_arg(text)
  } else if (name == "Roles") {
    p_has_roles = 1
  } else if (name == "Public") {
    p_has_public = 1
  } else if (name == "RequireCapability") {
    p_has_capability = 1
  } else if (name == "SelfScoped") {
    p_has_self_scoped = 1
  } else if (name == "UseGuards") {
    collect_identifiers(text, rg)
  }
  # diğerleri (ApiOperation, ApiResponse, HttpCode, ApiParam, ApiBody,
  # ApiConsumes, UseInterceptors, ...) sınıflandırma için ilgisiz — yok say.
}

function join_path(base, arg,   b, a) {
  b = base; a = arg
  if (b == "") return a
  if (a == "") return b
  return b "/" a
}

# Birleşim + DETERMİNİSTİK sıralama. POSIX awk'ta `for (k in arr)` sırası
# TANIMSIZ — sıralamadan bırakılsaydı guardsCSV metni koşumdan koşuma
# farklılaşabilirdi (baseline dosyası flap eder). Küçük kümeler (bugün en
# fazla 2 eleman) için elle eklemeli sıralama yeterli.
function csv_from_sets(a, b,   list, n, k, i, j, tmp, out) {
  n = 0
  for (k in a) { list[n] = k; n++ }
  for (k in b) {
    dup = 0
    for (i = 0; i < n; i++) if (list[i] == k) { dup = 1; break }
    if (!dup) { list[n] = k; n++ }
  }
  for (i = 0; i < n; i++)
    for (j = i + 1; j < n; j++)
      if (list[j] < list[i]) { tmp = list[i]; list[i] = list[j]; list[j] = tmp }
  out = ""
  for (i = 0; i < n; i++) out = (i == 0) ? list[i] : out "," list[i]
  if (out == "") out = "-"
  return out
}

function flush_pending(   guards) {
  if (p_has_http) {
    guards = csv_from_sets(cg, rg)
    printf "%s\t%d\t%s\t%s\t%d\t%d\t%s\t%d\t%d\n", \
      FILENAME, p_http_line, p_http_method, join_path(ctrl_base, p_http_path), \
      (p_has_roles || c_has_roles), p_has_public, guards, p_has_self_scoped, \
      (p_has_capability || c_has_capability)
  }
  reset_pending()
}

BEGIN {
  seen_export = 0
  ctrl_base = ""
  c_has_roles = 0
  c_has_capability = 0
  in_ml = 0
  ml_depth = 0
  ml_name = ""
  ml_text = ""
  ml_is_class = 0
  ml_start_line = 0
  reset_pending()
}

FNR == 1 {
  # Dosyalar arası durum sızmasın (bu awk her dosya için ayrı invocation
  # alsa da savunmalı: aynı çalışmada birden çok dosya verilirse BEGIN
  # yalnız BİR kez koşar).
  if (FNR == 1 && NR != 1) {
    seen_export = 0; ctrl_base = ""; in_ml = 0; ml_depth = 0
    ml_name = ""; ml_text = ""; ml_is_class = 0
    # ⚠️ class-seviyesi bayraklar da SIFIRLANIR — yoksa bir dosyanın class
    # @Roles'ü sonraki dosyanın TÜM rotalarına sızardı (S1 eklenirken
    # yakalandı: ctrl_base ile aynı yaşam döngüsü).
    c_has_roles = 0; c_has_capability = 0
    delete cg
    reset_pending()
  }
}

{
  line = $0

  if (in_ml) {
    ml_text = ml_text "\n" line
    ml_depth += paren_delta(line)
    if (ml_depth <= 0) {
      finalize_decorator(ml_name, ml_text, ml_is_class, ml_start_line)
      in_ml = 0; ml_text = ""; ml_name = ""
    }
    next
  }

  trimmed = line
  sub(/^[ \t]+/, "", trimmed)
  if (trimmed == "" || trimmed ~ /^(\/\/|\/\*|\*)/) next   # yorum/boş — sınır ÜRETMEZ

  if (!seen_export) {
    if (line ~ /^export class/) { seen_export = 1; next }
    if (line ~ /^@[A-Za-z_][A-Za-z0-9_]*\(/) {
      nm = decorator_name(line)
      d = paren_delta(line)
      if (d <= 0) {
        finalize_decorator(nm, line, 1, FNR)
      } else {
        in_ml = 1; ml_name = nm; ml_text = line; ml_depth = d
        ml_is_class = 1; ml_start_line = FNR
      }
      next
    }
    next   # diğer 0-indent satırlar (import, vb.) — ilgisiz
  }

  # seen_export == 1: sınıf gövdesindeyiz
  if (line ~ /^  @[A-Za-z_][A-Za-z0-9_]*\(/) {
    nm = decorator_name(line)
    d = paren_delta(line)
    if (d <= 0) {
      finalize_decorator(nm, line, 0, FNR)
    } else {
      in_ml = 1; ml_name = nm; ml_text = line; ml_depth = d
      ml_is_class = 0; ml_start_line = FNR
    }
    next
  }

  if (line ~ /^  [^ ]/) {
    # blok sınırı: bir sonraki metodun imzası YA DA önceki metodun kapanışı
    flush_pending()
  }
  # 4+ girintili satırlar (parametre dekoratörleri, gövde) — sessizce atla
}

END {
  flush_pending()
}

#!/usr/bin/env bash
#
# Guard ortak kitaplığı — allowlist doğrulama ve filtreleme.
#
# Faz 1'de bu mantık dört guard'da birebir kopyalanmıştı ve gerekçesiz satırı
# SESSİZCE yok sayıyordu. Faz 2'de guard'lar bloklayıcı olduğu için sessiz yok
# sayma tehlikeli: bozuk bir allowlist satırı "susturma çalışmıyor" yerine
# "susturma çalışıyor sanılıyor" durumunu üretir. Artık parse hatası verir.
#
# Allowlist formatı:
#   <guard-adı>|<anahtar>|<gerekçe>
#
#   <anahtar> = `<dosya>:<satır>`  (kaynak kod bulguları)
#             | `ENV`              (dosya:satır'ı olmayan ortam bulguları;
#                                    ör. schema-isolation'ın `db:<veritabanı>` anahtarı)
#
# Gerekçesiz veya alan sayısı eksik satır → parse hatası, exit 2.

# Guard adlarının TEK doğruluk kaynağı. `run-all.sh` koşacağı guard listesini
# buradan okur — iki yerde tutulursa biri güncellenip diğeri unutulduğunda ya
# doğrulama reddeder ya runner sessizce atlar.
GUARD_NAMES_VALID="migration-schema ledger-direction financial-ordering schema-isolation money-float mode-split lint-ratchet app-runtime-grants route-scope"

# `ENV` joker anahtarını kullanabilen guard'lar (dosya:satır'ı olmayan bulgular).
GUARD_NAMES_ENV_OK="schema-isolation"

# validate_allowlist <allowlist-yolu>
# Bozuk satır varsa stderr'e yazar ve 2 döner. Dosya yoksa sorun değil (boş allowlist).
validate_allowlist() {
  local al="$1"
  [ -f "$al" ] || return 0

  local errors
  errors="$(awk -v valid="$GUARD_NAMES_VALID" -v envok="$GUARD_NAMES_ENV_OK" '
    BEGIN {
      split(valid, v, " "); for (i in v) known[v[i]] = 1
      split(envok, e, " "); for (i in e) env_allowed[e[i]] = 1
    }
    {
      line = $0
      if (line ~ /^[ \t]*#/ || line ~ /^[ \t]*$/) next

      n = split(line, p, "|")
      for (i = 1; i <= n; i++) gsub(/^[ \t]+|[ \t]+$/, "", p[i])

      if (n != 3) {
        printf "  satır %d: tam 3 alan bekleniyor (<guard>|<anahtar>|<gerekçe>), %d bulundu\n", NR, n
        printf "    > %s\n", line
        printf "    (gerekce metninde ayrac karakteri kullanma: sessizce budanmasin diye reddediliyor)\n"
        next
      }
      if (p[3] == "") {
        printf "  satır %d: gerekçe alanı boş — gerekçesiz susturma yasak\n", NR
        printf "    > %s\n", line
        next
      }
      if (!(p[1] in known)) {
        printf "  satır %d: bilinmeyen guard adı %s\n", NR, p[1]
        printf "    > %s\n", line
        next
      }
      if (p[2] == "") {
        printf "  satır %d: anahtar alanı boş (<dosya>:<satır> veya ENV bekleniyor)\n", NR
        printf "    > %s\n", line
        next
      }
      # ENV joker anahtari yalniz ortam guardi icin anlamli. Kaynak kod
      # guardinda ENV yazmak o guardin tum dosya-disi bulgularini susturur:
      # anlamsiz ve tehlikeli bir kombinasyon.
      # (NOT: bu blok bash icinde tek tirnakli awk programi; Turkce kesme
      #  isareti tirnagi kapatir, o yuzden awk-ici yorumlar aksansizdir.)
      if (p[2] == "ENV" && !(p[1] in env_allowed)) {
        printf "  satır %d: ENV anahtari yalniz su guardlar icin gecerli: %s (%s yazilmis)\n", NR, envok, p[1]
        printf "    > %s\n", line
      }
    }
  ' "$al")"

  if [ -n "$errors" ]; then
    {
      echo "!! allowlist parse hatası: $al"
      printf "%s\n" "$errors"
      echo "!! Guard'lar bozuk bir allowlist ile çalıştırılmaz."
    } >&2
    return 2
  fi
  return 0
}

# report_guard <ham-bulgu-akışı>
# Allowlist filtresini uygular, sonucu basar, susturulan sayısını GÖRÜNÜR kılar ve
# COUNT/SUPPRESSED değişkenlerini set eder.
#
# Susturmanın çıktıda görünmesi şart: `schema-isolation` bugün canlı bir gerçek
# pozitif üretiyor ve allowlist onu düşürüyor. Çıktı sadece "0 bulgu" deseydi,
# ortam ihlalinin (T-067) tek kaydı allowlist dosyası olurdu — kimse bakmazdı.
report_guard() {
  local raw="$1" out
  out="$(printf '%s\n' "$raw" | filter_allowlist)"

  local rawc outc
  rawc="$(printf '%s' "$raw" | grep -c "^\[$GUARD_NAME\]" || true)"
  outc="$(printf '%s' "$out" | grep -c "^\[$GUARD_NAME\]" || true)"

  [ -n "$out" ] && printf '%s\n' "$out"

  COUNT="$outc"
  SUPPRESSED=$((rawc - outc))
  if [ "$SUPPRESSED" -gt 0 ]; then
    echo "-- [$GUARD_NAME] SUPPRESSED: $SUPPRESSED bulgu allowlist ile susturuldu"
  fi
}

# filter_allowlist — stdin'deki bulgu akışından allowlist'tekileri düşürür.
# GUARD_NAME ve ALLOWLIST değişkenlerini çağıran guard'dan alır.
#
# Kabul kuralları `validate_allowlist` ile BİREBİR aynı olmalı. Farklı olurlarsa
# validate'in reddettiği bir satırı filtre kabul eder ve susturma sessizce geri
# gelir. Bugün validate her zaman önce koşuyor, ama iki fonksiyonun aynı formatı
# iki kuralla okuması kendi başına bir hata kaynağı.
filter_allowlist() {
  awk -v guard="$GUARD_NAME" -v al="$ALLOWLIST" -v envok="$GUARD_NAMES_ENV_OK" '
    BEGIN {
      split(envok, e, " "); for (k in e) env_allowed[e[k]] = 1
      while ((getline l < al) > 0) {
        if (l ~ /^[ \t]*#/ || l ~ /^[ \t]*$/) continue
        n = split(l, p, "|")
        if (n != 3) continue                       # validate ile aynı: TAM 3 alan
        if (p[3] ~ /^[ \t]*$/) continue
        gsub(/^[ \t]+|[ \t]+$/, "", p[1]); gsub(/^[ \t]+|[ \t]+$/, "", p[2])
        if (p[1] != guard) continue
        if (p[2] == "") continue
        if (p[2] == "ENV") {
          if (!(p[1] in env_allowed)) continue     # validate ile aynı: ENV her guard-a değil
          env_skip = 1
        } else skip[p[2]] = 1
      }
    }
    /^\[/ {
      key = $0; sub(/^\[[^]]*\] /, "", key)
      # ENV anahtarı: dosya:satır biçiminde OLMAYAN bulguları (ör. db:<ad>) susturur.
      is_file = (key ~ /:[0-9]+$/)
      drop = (key in skip) || (env_skip && !is_file)
    }
    { if (!drop) print }
  '
}

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

GUARD_NAMES_VALID="migration-schema ledger-direction financial-ordering schema-isolation"

# validate_allowlist <allowlist-yolu>
# Bozuk satır varsa stderr'e yazar ve 2 döner. Dosya yoksa sorun değil (boş allowlist).
validate_allowlist() {
  local al="$1"
  [ -f "$al" ] || return 0

  local errors
  errors="$(awk -v valid="$GUARD_NAMES_VALID" '
    BEGIN { split(valid, v, " "); for (i in v) known[v[i]] = 1 }
    {
      line = $0
      if (line ~ /^[ \t]*#/ || line ~ /^[ \t]*$/) next

      n = split(line, p, "|")
      for (i = 1; i <= n; i++) gsub(/^[ \t]+|[ \t]+$/, "", p[i])

      if (n < 3) {
        printf "  satır %d: 3 alan bekleniyor (<guard>|<anahtar>|<gerekçe>), %d bulundu\n", NR, n
        printf "    > %s\n", line
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

# filter_allowlist — stdin'deki bulgu akışından allowlist'tekileri düşürür.
# GUARD_NAME ve ALLOWLIST değişkenlerini çağıran guard'dan alır.
filter_allowlist() {
  awk -v guard="$GUARD_NAME" -v al="$ALLOWLIST" '
    BEGIN {
      while ((getline l < al) > 0) {
        if (l ~ /^[ \t]*#/ || l ~ /^[ \t]*$/) continue
        n = split(l, p, "|")
        if (n < 3) continue
        if (p[3] ~ /^[ \t]*$/) continue
        gsub(/^[ \t]+|[ \t]+$/, "", p[1]); gsub(/^[ \t]+|[ \t]+$/, "", p[2])
        if (p[1] != guard) continue
        if (p[2] == "ENV") env_skip = 1; else skip[p[2]] = 1
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

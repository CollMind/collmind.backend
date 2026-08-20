# app-runtime-grants guard — kaynak B çıkarıcı (T-250, K-2.6.13f).
#
# `scripts/db-roles/02-runtime-grants.sql`'den `app_runtime`'a GRANT edilen
# TABLO adlarını çıkarır. `REVOKE ALL ON ALL TABLES IN SCHEMA ...` satırı
# BİLEREK yok sayılır (o satırda `GRANT` yok, ve `:"schema"` bir `.` ile
# devam etmiyor — bir tablo adı taşımıyor).
#
# BLOK SINIRI `;`dir, satır sayısı değil: bir GRANT ifadesi ("user_scopes"
# örneğinde olduğu gibi, dosyanın 450-451. satırları) iki satıra
# yayılabilir — `ON :"schema".<tablo>` bir sonraki satırda olabilir. Bu
# yüzden bir `GRANT` görüldüğünde `;` görülene kadar TAMPONLANIR, sonra
# tamponun TAMAMI `TO app_runtime` içeriyor mu diye kontrol edilir ve
# içindeki HER `:"schema".<tablo>` referansı çıkarılır (kolon-düzeyi
# `(kolon1, kolon2)` listesi ayrıca yakalanmaz — bu guard'ın kapsam dışı
# bıraktığı `kolon düzeyi` sınırıyla TUTARLI, bkz. ana guard'ın başlığı).
#
# `--` SQL satır yorumu KABACA temizlenir (bu dosyada dize literal'i
# içinde `--` geçen bir GRANT/REVOKE satırı yok — ölçüldü, tam dosya okundu).
#
# Çıktı: satır başına bir tablo adı (tekrarlı olabilir — tekilleştirme
# çağıranda).

BEGIN { buf = ""; instmt = 0 }

{
  line = $0
  sub(/--.*/, "", line)

  if (!instmt && line ~ /GRANT[ \t]/) { instmt = 1; buf = "" }

  if (instmt) {
    buf = buf " " line
    if (line ~ /;/) {
      if (buf ~ /TO[ \t]+app_runtime/) {
        s = buf
        while (match(s, /:"schema"\.[A-Za-z_][A-Za-z0-9_]*/)) {
          tok = substr(s, RSTART, RLENGTH)
          sub(/^:"schema"\./, "", tok)
          print tok
          s = substr(s, RSTART + RLENGTH)
        }
      }
      instmt = 0
      buf = ""
    }
  }
}

END {
  if (instmt) {
    # Kapanmamış bir GRANT ifadesi — dosya bozuk ya da lexer yanılmış.
    # Sessizce geçmek yanlış negatiftir; ana guard bu durumda kaynak B'yi
    # boş bulup SETUP HATASI verir (0 satır çıkar).
    print "UNCLOSED_STATEMENT" > "/dev/stderr"
  }
}

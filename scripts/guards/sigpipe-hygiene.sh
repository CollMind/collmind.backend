#!/usr/bin/env bash
#
# Guard: sigpipe-hygiene ([[T-359]])
#
# NE YAPAR: `pipefail` taşıyan bir `.sh` dosyasında `<üretici> | grep -q...`
# desenini YASAKLAR.
#
# NEDEN ([[T-359]] — mekanizma ÖLÇÜLDÜ, adlandırıldı)
#
#   grep -q eşleşince ERKEN ÇIKAR  →  yazan taraf SIGPIPE alır  →  exit 141
#   set -o pipefail                →  141'i PIPELINE'ın kodu yapar
#   sonuç                          →  başarılı bir eşleşme, BAŞARISIZLIK gibi okunur
#
# Canlı vaka: `app-runtime-grants-self-test.sh:314` — standalone 20 koşumda
# 6 kırmızı verdi, hepsi `line 314: printf: write error: Broken pipe`.
# Aralıklı, çünkü YARIŞ: `printf` çoğu zaman `grep -q` çıkmadan bitiriyor —
# ama çıktı büyüdükçe olasılık artıyor.
#
# İSTİSNA — ALLOWLIST DEĞİL, DESEN bazlı: `head -N <kaynak> | grep -q ...`
# güvenlidir çünkü `head -N` üreticisi zaten TEK/SINIRLI satır yazar — SIGPIPE
# riski yapısal olarak yok (bkz. `alan-guard-ratchet.sh`, `roles-ratchet.sh`,
# `route-scope.sh`, `scope-ratchet.sh` — dördü de dokunulmadan bırakıldı,
# T-359 turunda).
#
# DOĞUM ŞARTI (Z83): bilinen-yeşil + bilinen-kırmızı + boş-evren TEK
# self-test'te — `--self-test` ile çağrılır.
#
# ⚠️ KAYNAK BOŞALIRSA FARK BOŞ KALIR (Z95 dersi, T-100'ün aynısı): taranan
# dosya sayısı 0 çıkarsa guard SESSİZCE YEŞİL DEĞİL, exit 2 (ÖLÇEMEDİM) verir.
#
# GUARD_MODE=block   → bulgu varsa exit 1 (varsayılan)
# GUARD_MODE=report  → bulguları bas, exit 0 (runner çağrısı / triyaj)
# exit 2             → KURULUM HATASI / ÖLÇÜM YAPILMADI (boş evren, taranacak
#                       dizin yok) — bulgu DEĞİL, "bu koşumun sonucuna güvenme"
#
# ENV override (yalnız self-test için):
#   SIGPIPE_HYGIENE_SCAN_DIR   taranacak kökü değiştirir (varsayılan: scripts/)
set -uo pipefail

GUARD_NAME="sigpipe-hygiene"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SCAN_DIR="$(cd "$DIR/.." && pwd)"

# ── ÜRETİCİ | grep -q TESPİTİ ────────────────────────────────────────────
#
# `apply_sigpipe_check`: hem üretim taraması HEM self-test AYNI fonksiyondan
# geçer (ADR 0007 E16 dersi — bir kontrolü sınayan test kendi kopyasını
# çalıştırmaz).
#
# 1) dosya gerçekten `pipefail` mi taşıyor (yorum satırı DEĞİL)?
# 2) taşıyorsa: `[^|]| *grep -[a-zA-Z]*q` deseni var mı (`||` mantıksal OR
#    hariç tutuluyor — tek `|` karakteri arıyoruz, önünde başka bir `|` yok)?
# 3) varsa: hemen önündeki üretici `head -N <kaynak>` mi (GÜVENLİ, atla)?
# `strip_noise`: YORUM satırlarını ve HEREDOC GÖVDELERİNİ (`<< 'EOF' ... EOF`)
# eler — bunlar ÇALIŞAN kod değil, çoğu zaman TAM DA bu deseni ANLATAN metin
# (bkz. CLAUDE.md "YORUM KİRLİLİĞİ iki yönde birden yanıltır"). Heredoc
# gövdesi elenmezse bu guard'ın KENDİ self-test fixture'ları (aşağıda) kendi
# taramasında YANLIŞ POZİTİF üretir — [[T-359]] turunda ÖLÇÜLDÜ.
strip_noise() { # <dosya>  → satır_no:içerik  (yorum/heredoc-gövdesi HARİÇ)
  awk '
    BEGIN { in_heredoc = 0; delim = "" }
    {
      line = $0
      if (in_heredoc) {
        t = line
        gsub(/^\t+/, "", t)
        if (t == delim) { in_heredoc = 0 }
        next
      }
      if (match(line, /<<-?[ \t]*['"'"'"]?[A-Za-z_][A-Za-z0-9_]*['"'"'"]?/)) {
        seg = substr(line, RSTART, RLENGTH)
        d = seg
        gsub(/<<-?[ \t]*/, "", d)
        gsub(/['"'"'"]/, "", d)
        delim = d
        in_heredoc = 1
        next
      }
      t2 = line
      gsub(/^[ \t]*/, "", t2)
      if (t2 ~ /^#/) next
      print NR ":" line
    }
  ' "$file"
}

apply_sigpipe_check() { # <dosya>
  local file="$1" noise
  noise="$(strip_noise "$file")"
  # yorum-satırı-DIŞI VE heredoc-gövdesi-DIŞI pipefail bildirimi var mı
  # (KENDİ kodumuz da bu guard'ın sınadığı kurala uyar — herestring, boru DEĞİL)
  if ! grep -qE '\bpipefail\b' <<< "$noise"; then
    return 0
  fi
  local entry lineno content
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    lineno="${entry%%:*}"
    content="${entry#*:}"
    # `[^|]| *grep -[a-zA-Z]*q`: TEK boru (`||` mantıksal OR hariç)
    if ! grep -qE '[^|]\| *grep +-[a-zA-Z]*q' <<< "$content"; then
      continue
    fi
    # GÜVENLİ desen: `head -N ... | grep -q...` — head zaten sınırlı satır yazar
    if grep -qE '\bhead +-[0-9]+ [^|]*\| *grep +-[a-zA-Z]*q' <<< "$content"; then
      continue
    fi
    # ⛔ BULGU SATIRI `[<guard>]` ile PREFİKSLENİR — `run-all.sh:400` bulguları
    # `grep -c "^\[$g\]"` ile sayar. Prefikssiz bir bulgu satırı runner
    # tarafından GÖRÜLMEZ (sessiz yeşil).
    printf '[%s] %s:%s: %s\n' "$GUARD_NAME" "$file" "$lineno" "$(printf '%s' "$content" | sed -e 's/^[[:space:]]*//')"
  done <<< "$noise"
}

SCAN_DIR="${SIGPIPE_HYGIENE_SCAN_DIR:-$DEFAULT_SCAN_DIR}"
GUARD_MODE="${GUARD_MODE:-block}"

run_scan() { # <scan-dir>  →  stdout: ihlaller (dosya:satır: içerik)  ·  $? üzerinden dosya sayısı yok, ayrı hesaplanır
  local scan_dir="$1" f
  while IFS= read -r f; do
    apply_sigpipe_check "$f"
  done < <(find "$scan_dir" -type f -name '*.sh' | sort)
}

# ── SELF-TEST ────────────────────────────────────────────────────────────
self_test() {
  local tmp fail=0
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  # bilinen-yeşil: pipefail var, ama yasak desen YOK (yalnız güvenli head -1 var)
  mkdir -p "$tmp/green"
  cat > "$tmp/green/clean.sh" << 'EOF'
#!/usr/bin/env bash
set -uo pipefail
if ! head -1 "$SOME_FILE" 2>/dev/null | grep -q '^#'; then
  echo "no header"
fi
out="$(printf '%s\n' "$VAR")"
grep -q "pattern" <<< "$out"
EOF
  local green_out
  green_out="$(SIGPIPE_HYGIENE_SCAN_DIR="$tmp/green" GUARD_MODE=report bash "$DIR/$GUARD_NAME.sh" 2>&1)"
  local green_rc=$?
  if [ "$green_rc" -ne 0 ]; then
    echo "!! self-test FAIL [bilinen-yeşil]: exit 0 bekleniyordu, $green_rc bulundu" >&2
    printf '%s\n' "$green_out" >&2
    fail=1
  fi
  if grep -q "clean.sh" <<< "$green_out"; then
    echo "!! self-test FAIL [bilinen-yeşil]: temiz dosya YANLIŞ POZİTİF verdi" >&2
    printf '%s\n' "$green_out" >&2
    fail=1
  else
    echo "-- [bilinen-yeşil] pipefail + güvenli desenler (head -1, herestring) → bulgu YOK"
  fi

  # bilinen-kırmızı: pipefail var VE yasak desen var (T-359'un canonik vakası)
  mkdir -p "$tmp/red"
  cat > "$tmp/red/dirty.sh" << 'EOF'
#!/usr/bin/env bash
set -uo pipefail
detector_alive() {
  printf '%s\n' "$(run report)" | grep -q "^ALIVE$"
}
EOF
  local red_out red_rc
  red_out="$(SIGPIPE_HYGIENE_SCAN_DIR="$tmp/red" GUARD_MODE=report bash "$DIR/$GUARD_NAME.sh" 2>&1)"
  red_rc=$?
  if [ "$red_rc" -ne 0 ]; then
    echo "!! self-test FAIL [bilinen-kırmızı]: report modunda exit 0 bekleniyordu (bulgu VAR ama block değil), $red_rc bulundu" >&2
    fail=1
  fi
  if ! grep -q "dirty.sh:4" <<< "$red_out"; then
    echo "!! self-test FAIL [bilinen-kırmızı]: ihlal dosya:satır İLE ADLANDIRILMADI" >&2
    printf '%s\n' "$red_out" >&2
    fail=1
  else
    echo "-- [bilinen-kırmızı] pipefail + yasak desen (printf, ardından grep -q'ya borulu) → bulgu VAR, dosya:satır ile adlandırıldı (dirty.sh:4)"
  fi
  # block modunda gerçekten exit 1 veriyor mu
  local red_block_rc
  SIGPIPE_HYGIENE_SCAN_DIR="$tmp/red" GUARD_MODE=block bash "$DIR/$GUARD_NAME.sh" > /dev/null 2>&1
  red_block_rc=$?
  if [ "$red_block_rc" -ne 1 ]; then
    echo "!! self-test FAIL [bilinen-kırmızı/block]: GUARD_MODE=block exit 1 bekleniyordu, $red_block_rc bulundu" >&2
    fail=1
  else
    echo "-- [bilinen-kırmızı/block] GUARD_MODE=block → exit 1 (doğru)"
  fi

  # boş-evren: taranacak .sh dosyası YOK → exit 2 (ÖLÇEMEDİM), sessiz yeşil DEĞİL
  mkdir -p "$tmp/empty"
  local empty_rc
  SIGPIPE_HYGIENE_SCAN_DIR="$tmp/empty" GUARD_MODE=block bash "$DIR/$GUARD_NAME.sh" > /tmp/sigpipe_empty_out.$$ 2>&1
  empty_rc=$?
  if [ "$empty_rc" -ne 2 ]; then
    echo "!! self-test FAIL [boş-evren]: exit 2 (ÖLÇEMEDİM) bekleniyordu, $empty_rc bulundu — boş evren SESSİZCE YEŞİL kaldı" >&2
    fail=1
  else
    echo "-- [boş-evren] taranan dosya sayısı 0 → exit 2 (ÖLÇEMEDİM, sessiz yeşil DEĞİL)"
  fi
  rm -f /tmp/sigpipe_empty_out.$$

  if [ "$fail" -eq 0 ]; then
    echo "-- $GUARD_NAME self-test: 4 senaryo tutuyor (bilinen-yeşil, bilinen-kırmızı/report, bilinen-kırmızı/block, boş-evren)"
    return 0
  fi
  echo "⛔ $GUARD_NAME self-test DÜŞTÜ"
  return 1
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

# ── ÜRETİM TARAMASI ──────────────────────────────────────────────────────
if [ ! -d "$SCAN_DIR" ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: taranacak dizin yok: $SCAN_DIR — ÖLÇÜM YAPILMADI" >&2
  exit 2
fi

FILE_COUNT="$(find "$SCAN_DIR" -type f -name '*.sh' | wc -l | tr -d ' ')"
if [ "$FILE_COUNT" -eq 0 ]; then
  echo "!! [$GUARD_NAME] SETUP HATASI: taranan dosya sayısı 0 (kaynak: $SCAN_DIR) — evren boş, ÖLÇÜM YAPILMADI (sessiz yeşil DEĞİL)" >&2
  exit 2
fi

FINDINGS="$(run_scan "$SCAN_DIR")"
FINDING_COUNT=0
if [ -n "$FINDINGS" ]; then
  FINDING_COUNT="$(printf '%s\n' "$FINDINGS" | grep -c . || true)"
fi

# ⛔ ÖZET SATIRI `[<guard>]` PREFİKSİ TAŞIYAMAZ — runner onu BİR BULGU sayardı
# ve bulgu 0 iken bile TOPLAM'ı 1 yapardı (ölçüldü 2026-09-04: kapı KALICI
# KIRMIZI doğardı — `Z83`: "kırmızı doğan kapı ölür"). `--` ile başlar.
echo "-- [$GUARD_NAME] taranan dosya: $FILE_COUNT · bulgu: $FINDING_COUNT"
if [ "$FINDING_COUNT" -gt 0 ]; then
  printf '%s\n' "$FINDINGS"
fi

if [ "$FINDING_COUNT" -gt 0 ] && [ "$GUARD_MODE" = "block" ]; then
  exit 1
fi
exit 0

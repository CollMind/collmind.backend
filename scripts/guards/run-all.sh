#!/usr/bin/env bash
#
# Guard runner — Faz 2 (BLOKLAMA modu)
#
# Faz 1'de varsayılan `report` idi: hiçbir guard build'i, testi veya commit'i
# kırmıyordu. Gerekçe, ilk koşumda yüzlerce yanlış pozitif çıkarsa ekibin
# guard'ları tümden kapatmasıydı. Ölçüm yapıldı, ihlaller düzeltildi, allowlist
# insan triyajıyla dolduruldu — artık kapı kapalı.
#
#   GUARD_MODE=block (varsayılan) → bulgu varsa exit 1
#   GUARD_MODE=report             → bulguları bas, exit 0 (triyaj için)
#   exit 2                        → KURULUM HATASI / ÖLÇÜM YAPILMADI, bulgu
#                                    DEĞİL — dört üretici var, hepsi aynı
#                                    anlama gelir ("bu koşumun sonucuna
#                                    güvenme"): allowlist parse hatası (:84) ·
#                                    bir alt guard koşamadı (:112) · money-float
#                                    SKIPPED (domain listesi yok/boş — :188,
#                                    T-212 S-1) · money-float --ratchet
#                                    koşamadı (:193, baseline yok/bozuk).
#                                    Mesaj bunların HANGİSİ olduğunu ayırt
#                                    etmeye çalışmaz; stderr'deki guard'ın
#                                    kendi satırı ayırt eder.
#
# CI yok (CLAUDE.md §5: manuel promote, pipeline yok). Çağrı yolları:
#   - `/qa` komutu            → .claude/commands/qa.md
#   - `code-reviewer` ajanı   → .claude/agents/code-reviewer.md
#   - Done checklist'i        → .claude/backlog/BACKLOG.md
set -uo pipefail

GUARD_MODE="${GUARD_MODE:-block}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Guard listesi lib.sh'teki tek doğruluk kaynağından gelir (S1).
source "$DIR/lib.sh"
# shellcheck disable=SC2206
GUARDS=($GUARD_NAMES_VALID)

# Guards that are INFORMATIONAL for now: their RAW finding count is printed
# and counted in the summary, but never turns `npm run guards` red by itself.
# Making the raw count blocking today would block every commit until the whole
# conversion lands — the "big-bang or never" trap Karar 3b rejects.
#
# N2 (T-212 code-review): the exact count is NOT written here on purpose — an
# earlier version said "119 findings across 22 files" while the measured
# reality was already 168/28. A number in a comment goes stale the moment
# someone repays debt; it never turns red to say so. The live count is
# whatever `money-float-baseline.txt`'s `# total:` line says (regenerate with
# `money-float.sh --baseline`), and the `money-float: N bulgu` line this
# runner prints below is the current measurement — read that, not this
# comment.
#
# T-212 (2026-08-14): this does NOT mean money-float is unenforced. The
# RATCHET (`money-float.sh --ratchet`, invoked below as a separate gate) IS
# blocking: a touched/new Domain A file's finding count must not exceed its
# baseline. Before T-212 the ratchet's only invocation path was a human
# remembering the BACKLOG.md Done checklist — "doğrulama bir kapıdır, çıkışı
# durdurmuyorsa doğrulama değildir" (CLAUDE.md). When Domain A reaches zero,
# move money-float out of this list entirely (raw count becomes blocking too).
#
# lint-ratchet (T-113) joins for the SAME reason, measured the same way:
# `npm run lint:check` is 1087 problems / 183 files today (see lint-ratchet.sh
# header) and making the raw count blocking would fail every commit until the
# whole repo is lint-clean — the same "big-bang or never" trap. Its RATCHET
# (below, alongside money-float's) is the actual blocking gate.
REPORT_ONLY_GUARDS="money-float lint-ratchet"

is_report_only() {
  case " $REPORT_ONLY_GUARDS " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# Guard'lar ölçüme başlamadan ÖNCE kendi doğruluklarını kanıtlar.
# Gerekçe: bozuk bir guard sessizce "0 bulgu" döner ve her şey yeşil görünür —
# iki code review turunda tam olarak bu oldu. Self-test kırmızıysa bulgu
# sayıları anlamsızdır, dolayısıyla koşum burada durur.
echo "=== self-test ==="
if bash "$DIR/self-test.sh"; then
  echo "(guard fixture matrisi tutuyor)"
  echo
else
  echo "!! guard'lar kendi fixture matrisini geçemedi — ölçüm güvenilmez, exit 1" >&2
  exit 1
fi

# lint-ratchet'in kendi self-test'i AYRI bir dosyadır (self-test.sh'in awk/
# fixture-copy mekanizmasından farklı bir mekanizma kullanır: gerçek eslint'i
# fixture'lara karşı koşturur — bkz. lint-ratchet-self-test.sh başlığı).
# Frontend'de bu ayrım `npm run guard:lint` = "self-test && ratchet" zinciriyle
# sağlanıyordu; backend'in gerçek giriş noktası bu runner olduğu için aynı
# zincirleme burada kurulmalı — yoksa self-test dosyası VAR ama hiçbir gerçek
# kapı yolu onu ÇAĞIRMIYOR olurdu (CLAUDE.md: "doğrulama bir kapıdır,
# durdurmuyorsa doğrulama değildir").
echo "=== self-test (lint-ratchet) ==="
if bash "$DIR/lint-ratchet-self-test.sh"; then
  echo "(lint-ratchet fixture matrisi tutuyor)"
  echo
else
  echo "!! lint-ratchet kendi fixture matrisini geçemedi — ölçüm güvenilmez, exit 1" >&2
  exit 1
fi

TOTAL=0
TOTAL_SUP=0
SKIPPED_OK=0
SKIPPED_BAD=0
RATCHET_FAILED=0
LINT_RATCHET_FAILED=0
SUMMARY=""

for g in "${GUARDS[@]}"; do
  # Alt guard'ları her zaman report modunda çalıştır; exit kararını runner verir.
  OUT="$(GUARD_MODE=report bash "$DIR/$g.sh")"
  RC=$?

  # exit 2 = kurulum hatası / ölçüm yapılmadı — bulgu DEĞİL. Bu tek bir nedene
  # (yalnız allowlist) bağlı değil: allowlist parse hatası, self-test
  # başarısızlığı, ya da (money-float için) SKIPPED — domain listesi yok/boş
  # (T-212 S-1). Hepsi aynı tepkiyi gerektirir: sessizce yutulamaz, mod ne
  # olursa olsun koşumu durdurur. Hangisi olduğunu bu blok İDDİA ETMEZ — $OUT
  # (guard'ın kendi stdout'u, ör. "SKIPPED: domain list not found") aşağıda
  # basılır; ayırt eden odur, stderr'deki guard mesajı da ayrıca görünür.
  if [ "$RC" -eq 2 ]; then
    echo "=== $g ==="
    [ -n "$OUT" ] && printf '%s\n' "$OUT"
    echo "!! guard KURULUM HATASI / ÖLÇÜM YAPILMADI (exit 2, detay yukarıda/stderr'de) — koşum durduruldu"
    exit 2
  fi

  # SIFIRDAN FARKLI HER RC BİR KURULUM HATASIDIR — ve bu satır 2026-08-13'te
  # ÖLÇÜLMÜŞ bir delik yüzünden var.
  #
  # Alt guard'lar `GUARD_MODE=report` ile koşuyor: sözleşme gereği bulgu VARKEN
  # bile 0 dönerler (beşi de ölçüldü, hepsi 0). Yani sıfırdan farklı bir kod
  # "bulgu" demek değil, "guard KOŞAMADI" demektir.
  #
  # Delik neydi: yalnız `RC -eq 2` sınanıyordu. Çöken bir guard (RC=1, çıktı yok)
  #   → COUNT=0 → "(bulgu yok)" → TOPLAM değişmez → RUNNER exit 0.
  # Ampirik kanıt (mutasyon: guard yalnız GERÇEK repoda çöksün, fixture'da değil):
  #   self-test EXIT=0   ·   guard çıplak EXIT=1   ·   RUNNER EXIT=0  ⛔
  #
  # Self-test bunu yakalayamaz ÇÜNKÜ guard'ları fixture env değişkeniyle çağırır
  # (`GUARD_SRC_DIR=...`), runner ise çıplak — ikisi farklı girdi kümesini ölçer.
  # Runner'ın kendi yorumu (yukarıda) tam bu sınıfa karşı yazılmıştı ve sınıf
  # yine de açıktı: savunma self-test'e devredilmişti, self-test ise başka bir
  # şey ölçüyordu.
  #
  # exit 2 seçildi, 1 değil: bu bir bulgu değil, ÖLÇÜMÜN YAPILMAMASI. 1 dönmek
  # birini var olmayan bir borcu aramaya gönderirdi (frontend runner'ın aynı
  # gerekçesi).
  if [ "$RC" -ne 0 ]; then
    echo "=== $g ==="
    echo "!! guard KOŞAMADI (exit $RC) — bulgu sayısı anlamsız, ölçüm yapılmadı"
    echo "!! report modunda sıfırdan farklı çıkış bir kurulum hatasıdır."
    exit 2
  fi

  COUNT="$(printf "%s" "$OUT" | grep -c "^\[$g\]" || true)"
  SKIPPED="$(printf "%s" "$OUT" | grep -c "^-- \[$g\] SKIPPED" || true)"
  SUP="$(printf "%s" "$OUT" | sed -n "s/^-- \[$g\] SUPPRESSED: \([0-9]*\) .*/\1/p")"
  SUP="${SUP:-0}"

  echo "=== $g ==="
  if [ -n "$OUT" ]; then
    printf "%s\n" "$OUT"
  else
    echo "(bulgu yok)"
  fi
  echo

  if [ "$SKIPPED" -gt 0 ]; then
    # SKIPPED "0 bulgu" DEĞİLDİR — "ölçülmedi"dir. Ayrı raporlanır, çünkü
    # `npm run guards` yeşili artık Done kriteri (CLAUDE.md §4.2): Docker
    # kapalıyken "guards yeşil" işaretlenebilmesi sessiz bir boşluk olurdu.
    SUMMARY="${SUMMARY}  ${g}: ÖLÇÜLMEDİ (SKIPPED)\n"
    if [ "$g" = "schema-isolation" ]; then
      # Tek meşru SKIPPED: DB'siz ortamda DB kontrolü yapılamaz.
      SKIPPED_OK=$((SKIPPED_OK + 1))
    else
      # Kaynak kod guard'ı atlanıyorsa bu bir kurulum hatasıdır, mazeret değil.
      SKIPPED_BAD=$((SKIPPED_BAD + 1))
    fi
  else
    LINE="  ${g}: ${COUNT} bulgu"
    [ "$SUP" -gt 0 ] && LINE="${LINE} (${SUP} susturuldu → allowlist)"
    if is_report_only "$g"; then
      LINE="${LINE} [BİLGİ AMAÇLI — bloklamaz; kapı: ${g}.sh --ratchet]"
      SUMMARY="${SUMMARY}${LINE}\n"
    else
      SUMMARY="${SUMMARY}${LINE}\n"
      TOTAL=$((TOTAL + COUNT))
    fi
    TOTAL_SUP=$((TOTAL_SUP + SUP))
  fi
done

# --- money-float ratchet: KAPI (T-212 Kalem 2) ------------------------------
# money-float TOPLAM bulgu sayısı (168) REPORT_ONLY_GUARDS'ta kalmaya devam
# ediyor — "big-bang or never" tuzağı hâlâ geçerli, tüm dosyalar dönüştürülene
# kadar her PR'ı kırmak istemiyoruz. Ama RATCHET artık farklı bir şey ölçüyor:
# dokunulan/yeni bir dosyanın baseline'ı AŞIP AŞMADIĞI. Bu, "doğrulama bir
# kapıdır" kuralının uygulanışı — önceden yalnız BACKLOG.md'nin Done
# checklist'i (bir insanın hatırlaması) buna bağlıydı; artık bu runner bağlı.
#
# money-float-baseline.txt zaten LİSTE biçiminde (<dosya> <sayı>, mode-split
# ile aynı aile) — ölçüldü, format değişikliği gerekmedi. Bu yüzden doğrudan
# --ratchet'e bağlanabilir.
echo "=== money-float --ratchet (kapı) ==="
RATCHET_OUT="$(bash "$DIR/money-float.sh" --ratchet 2>&1)"
RATCHET_RC=$?
if [ -n "$RATCHET_OUT" ]; then
  printf "%s\n" "$RATCHET_OUT"
else
  echo "(ratchet: baseline aşılmadı)"
fi
echo

# B3 (T-212 code-review, ölçüldü) → S-1 (T-212, 2026-08-14): SKIPPED bir
# "temiz" DEĞİLDİR. money-float.sh iki yerde --ratchet dispatch'ine hiç
# ULAŞMADAN SKIPPED döner: domain listesi bulunamazsa (money-float.sh:~59)
# ya da liste sıfır dosyaya çözülürse (money-float.sh:~183).
#
# B3'ün ilk düzeltmesi burada RATCHET_OUT'u `grep -q 'SKIPPED'` ile metin
# olarak arıyordu. Mutasyon testi (T-212 S-1) bunun kör noktasını gösterdi:
# money-float.sh'daki "SKIPPED" kelimesini "ATLANDI" yapmak — guard mantığına
# hiç dokunmadan, yalnız bir insan mesajını değiştirerek — BU satırı VE
# döngüdeki yapılandırılmış eşdeğerini (aşağıdaki RC==2 kontrolünün üstü)
# aynı anda kör etti: RATCHET_RC yine 0'dı (o zamanki money-float.sh SKIPPED
# durumunda exit 0 dönüyordu), metin eşleşmedi, özet "money-float --ratchet:
# temiz" yazdı — ÖLÇÜM HİÇ YAPILMAMIŞKEN.
#   Ampirik (mutasyon öncesi/kanıt): MONEY_FLOAT_DOMAIN_LIST=/nonexistent
#     + money-float.sh:59 "SKIPPED"->"ATLANDI" → RUNNER EXIT 0 (önce)
#
# Yapısal düzeltme metin aramayı GEREKSİZ kıldı: money-float.sh artık SKIPPED
# durumunda (her modda, --ratchet dispatch'ine ulaşmadan) exit 2 dönüyor —
# yani aşağıdaki RATCHET_RC==2 kontrolü SKIPPED'i de, self-test/allowlist
# kurulum hatalarını da, eksik/bozuk baseline'ı da AYNI koddan yakalar. Metin
# eşleşmesi yerine exit kodu okunuyor; iki kapı artık AYNI kaynağı okuyor
# (ürün sahibinin tercih sırası: (1) ayırt edici çıkış kodu — bu uygulandı).
if [ "$RATCHET_RC" -eq 2 ]; then
  echo "!! money-float --ratchet KOŞAMADI / SKIPPED (kurulum hatası, exit 2) — ölçüm yapılmadı, özet 'temiz' DİYEMEZ" >&2
  exit 2
fi
if [ "$RATCHET_RC" -ne 0 ]; then
  RATCHET_FAILED=1
fi

# --- lint-ratchet: KAPI (T-113) ----------------------------------------------
# Aynı desen, money-float'ın birebir yanında: TOPLAM (1087 problem / 183
# dosya) REPORT_ONLY_GUARDS'ta bilgi amaçlı kalıyor, RATCHET dokunulan/yeni
# bir (dosya, kural) çiftinin baseline'ı AŞIP AŞMADIĞINI ölçüyor ve bloklayan
# odur. exit kodu sözleşmesi money-float ile AYNI kaynaktan okunuyor —
# ayırt edici metin arama YOK (T-212 S-1'in dersi buraya da uygulandı,
# yeniden keşfedilmedi): 2 = kurulum hatası/ölçüm yapılmadı (bkz.
# lint-ratchet.sh: node yok, eslint fatal, JSON parse hatası, sıfır dosya
# tarandı, baseline yok/bozuk), sıfırdan farklı ama 2 değilse = ratchet
# ihlali.
echo "=== lint-ratchet --ratchet (kapı) ==="
LINT_RATCHET_OUT="$(bash "$DIR/lint-ratchet.sh" --ratchet 2>&1)"
LINT_RATCHET_RC=$?
if [ -n "$LINT_RATCHET_OUT" ]; then
  printf "%s\n" "$LINT_RATCHET_OUT"
else
  echo "(ratchet: baseline aşılmadı)"
fi
echo

if [ "$LINT_RATCHET_RC" -eq 2 ]; then
  echo "!! lint-ratchet --ratchet KOŞAMADI (kurulum hatası, exit 2) — ölçüm yapılmadı, özet 'temiz' DİYEMEZ" >&2
  exit 2
fi
if [ "$LINT_RATCHET_RC" -ne 0 ]; then
  LINT_RATCHET_FAILED=1
fi

echo "=== ÖZET (GUARD_MODE=$GUARD_MODE) ==="
printf "%b" "$SUMMARY"
echo "  TOPLAM: $TOTAL bulgu"
[ "$TOTAL_SUP" -gt 0 ] && echo "  SUSTURULAN: $TOTAL_SUP (gerekçeleri: scripts/guards/allowlist.txt)"
[ "$SKIPPED_OK" -gt 0 ] && echo "  ÖLÇÜLMEYEN (DB erişimi yok): $SKIPPED_OK guard"
if [ "$RATCHET_FAILED" -eq 1 ]; then
  echo "  money-float --ratchet: İHLAL — bir dosya baseline'ı aştı (yukarıya bak)"
else
  echo "  money-float --ratchet: temiz"
fi
if [ "$LINT_RATCHET_FAILED" -eq 1 ]; then
  echo "  lint-ratchet --ratchet: İHLAL — bir (dosya, kural) çifti baseline'ı aştı (yukarıya bak)"
else
  echo "  lint-ratchet --ratchet: temiz"
fi

if [ "$GUARD_MODE" = "block" ]; then
  if [ "$SKIPPED_BAD" -gt 0 ]; then
    echo "  → kaynak kod guard'ı çalıştırılamadı ($SKIPPED_BAD adet): exit 1"
    exit 1
  fi
  if [ "$TOTAL" -gt 0 ]; then
    echo "  → GUARD_MODE=block ve bulgu var: exit 1"
    exit 1
  fi
  if [ "$RATCHET_FAILED" -eq 1 ]; then
    echo "  → GUARD_MODE=block ve money-float --ratchet ihlali var: exit 1"
    exit 1
  fi
  if [ "$LINT_RATCHET_FAILED" -eq 1 ]; then
    echo "  → GUARD_MODE=block ve lint-ratchet --ratchet ihlali var: exit 1"
    exit 1
  fi
fi
exit 0

#!/usr/bin/env bash
#
# self-test — lint-ratchet (backend), T-113.
#
# Runs the REAL lint-ratchet.sh against fixture files via its own
# LINT_RATCHET_TARGETS/LINT_RATCHET_BASELINE overrides — it does not
# reimplement any part of the scan or the ratchet comparison (ADR 0007 E16:
# a self-test that rebuilds its own copy of the mechanism goes blind to the
# exact regression it exists to catch).
#
# Ports collmind.frontend/scripts/guards/lint-ratchet-self-test.sh's 8 cases
# and adds a 9th (case 9) that frontend's per-file-total baseline cannot
# express: SAME total, DIFFERENT distribution across two rules in one file.
# That is this guard's entire reason for keying the baseline by (file, rule)
# instead of file alone — see lint-ratchet.sh's header. A self-test that
# ported only the 8 frontend cases would never exercise the one thing this
# port changed.
#
# exit 0 = all cases held · exit 1 = the guard is not behaving as documented
# (or fixtures/lint/ is missing) — the ratchet itself is not trustworthy
# until this passes.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$DIR/lint-ratchet.sh"
FIXDIR="$DIR/fixtures/lint"
ERROR_FIXTURE="$FIXDIR/lint-ratchet-error.ts"
CLEAN_FIXTURE="$FIXDIR/lint-ratchet-clean.ts"

if [ ! -f "$GUARD" ]; then
  echo "!! self-test: $GUARD yok" >&2
  exit 1
fi
if [ ! -f "$ERROR_FIXTURE" ] || [ ! -f "$CLEAN_FIXTURE" ]; then
  echo "!! self-test: fixtures/lint/*.ts eksik — guard doğrulanamıyor" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

REL_ERROR="scripts/guards/fixtures/lint/lint-ratchet-error.ts"
REL_CLEAN="scripts/guards/fixtures/lint/lint-ratchet-clean.ts"
TARGETS="$REL_ERROR $REL_CLEAN"

run_report() {
  LINT_RATCHET_TARGETS="$TARGETS" GUARD_MODE=report bash "$GUARD"
}

run_ratchet() {
  # $1 = baseline file, $2 = extra targets (optional, space-separated)
  LINT_RATCHET_TARGETS="${2:-$TARGETS}" LINT_RATCHET_BASELINE="$1" bash "$GUARD" --ratchet
}

FAIL=0

# --- case 1: detector alive — the error fixture's known tuples (measured
# directly with `npx eslint <fixture> --format json`: 2 no-unused-vars, 1
# no-explicit-any) must be COUNTED exactly, per rule.
REPORT_OUT="$(run_report 2>&1)"
if ! grep -qE "^\[lint-ratchet\] ${REL_ERROR} @typescript-eslint/no-unused-vars: 2 problems$" <<< "$REPORT_OUT"; then
  echo "!! self-test FAIL [case 1a: no-unused-vars]: beklenen '${REL_ERROR} @typescript-eslint/no-unused-vars: 2 problems', çıktı:"
  echo "$REPORT_OUT"
  FAIL=1
fi
if ! grep -qE "^\[lint-ratchet\] ${REL_ERROR} @typescript-eslint/no-explicit-any: 1 problems$" <<< "$REPORT_OUT"; then
  echo "!! self-test FAIL [case 1b: no-explicit-any]: beklenen '${REL_ERROR} @typescript-eslint/no-explicit-any: 1 problems', çıktı:"
  echo "$REPORT_OUT"
  FAIL=1
fi

# --- case 2: clean fixture reports zero — must not appear in findings at all.
if grep -q "$REL_CLEAN" <<< "$REPORT_OUT"; then
  echo "!! self-test FAIL [case 2: temiz]: $REL_CLEAN olmasa gereken bir bulguda göründü"
  echo "$REPORT_OUT"
  FAIL=1
fi

# --- case 3: ratchet, baseline == current (per tuple) → exit 0.
printf '%s @typescript-eslint/no-unused-vars 2\n%s @typescript-eslint/no-explicit-any 1\n' \
  "$REL_ERROR" "$REL_ERROR" > "$TMP/baseline-equal.txt"
if run_ratchet "$TMP/baseline-equal.txt" >"$TMP/ratchet-equal.out" 2>&1; then
  :
else
  echo "!! self-test FAIL [case 3: taban eşit]: --ratchet exit 0 vermeliydi"
  cat "$TMP/ratchet-equal.out"
  FAIL=1
fi

# --- case 4: ratchet, baseline < current for ONE tuple (regression) → exit 1.
printf '%s @typescript-eslint/no-unused-vars 1\n%s @typescript-eslint/no-explicit-any 1\n' \
  "$REL_ERROR" "$REL_ERROR" > "$TMP/baseline-under.txt"
if run_ratchet "$TMP/baseline-under.txt" >"$TMP/ratchet-under.out" 2>&1; then
  echo "!! self-test FAIL [case 4: taban aşıldı]: --ratchet bir artışı kabul etti, exit 0 döndü"
  cat "$TMP/ratchet-under.out"
  FAIL=1
else
  if ! grep -q "RATCHET VIOLATION: 1 -> 2" "$TMP/ratchet-under.out"; then
    echo "!! self-test FAIL [case 4: taban aşıldı]: exit 1 doğru ama beklenen mesaj yok"
    cat "$TMP/ratchet-under.out"
    FAIL=1
  fi
fi

# --- case 5: NEW file with findings, absent from baseline → exit 1
# ("born lint-clean").
printf '# empty baseline (no entries)\n' > "$TMP/baseline-empty.txt"
if run_ratchet "$TMP/baseline-empty.txt" >"$TMP/ratchet-new.out" 2>&1; then
  echo "!! self-test FAIL [case 5: yeni dosya]: bulgulu yeni bir dosyayı sessizce kabul etti"
  cat "$TMP/ratchet-new.out"
  FAIL=1
else
  if ! grep -q "NEW file with 2 problems" "$TMP/ratchet-new.out"; then
    echo "!! self-test FAIL [case 5: yeni dosya]: exit 1 doğru ama beklenen mesaj yok"
    cat "$TMP/ratchet-new.out"
    FAIL=1
  fi
fi

# --- case 6: GONE — a baseline line for a file that no longer exists must be
# reported and dropped from enforcement, NOT treated as a violation.
printf '%s @typescript-eslint/no-unused-vars 2\n%s @typescript-eslint/no-explicit-any 1\nscripts/guards/fixtures/lint/DOES_NOT_EXIST.ts @typescript-eslint/no-unused-vars 7\n' \
  "$REL_ERROR" "$REL_ERROR" > "$TMP/baseline-gone.txt"
if run_ratchet "$TMP/baseline-gone.txt" >"$TMP/ratchet-gone.out" 2>&1; then
  if ! grep -q "GONE: scripts/guards/fixtures/lint/DOES_NOT_EXIST.ts @typescript-eslint/no-unused-vars" "$TMP/ratchet-gone.out"; then
    echo "!! self-test FAIL [case 6: silinmiş dosya]: GONE mesajı beklenirdi"
    cat "$TMP/ratchet-gone.out"
    FAIL=1
  fi
else
  echo "!! self-test FAIL [case 6: silinmiş dosya]: GONE bir ihlal SAYILMAMALI, exit 1 döndü"
  cat "$TMP/ratchet-gone.out"
  FAIL=1
fi

# --- case 7: OUT OF SCOPE — a baseline line for a file that exists on disk
# but sits outside this run's TARGETS (i.e. ESLint's own scan never touched
# it) must be flagged, not silently treated as "0 findings, improved".
printf '%s @typescript-eslint/no-unused-vars 2\n%s @typescript-eslint/no-explicit-any 1\n%s @typescript-eslint/no-unused-vars 999\n' \
  "$REL_ERROR" "$REL_ERROR" "$REL_CLEAN" > "$TMP/baseline-outofscope.txt"
if run_ratchet "$TMP/baseline-outofscope.txt" "$REL_ERROR" >"$TMP/ratchet-oos.out" 2>&1; then
  echo "!! self-test FAIL [case 7: kapsam dışı]: kapsam daralmasını sessizce 'improved' saydı, exit 0"
  cat "$TMP/ratchet-oos.out"
  FAIL=1
else
  if ! grep -q "OUT OF SCOPE: still on disk but no longer covered" "$TMP/ratchet-oos.out"; then
    echo "!! self-test FAIL [case 7: kapsam dışı]: exit 1 doğru ama OUT OF SCOPE mesajı yok"
    cat "$TMP/ratchet-oos.out"
    FAIL=1
  fi
fi

# --- case 8: missing baseline file → SETUP FAILURE (exit 2), not a pass.
LINT_RATCHET_TARGETS="$TARGETS" LINT_RATCHET_BASELINE="$TMP/does-not-exist.txt" bash "$GUARD" --ratchet >"$TMP/ratchet-nobaseline.out" 2>&1
rc=$?
if [ "$rc" -ne 2 ]; then
  echo "!! self-test FAIL [case 8: taban yok]: SETUP FAILURE exit 2 bekleniyordu, $rc alındı"
  cat "$TMP/ratchet-nobaseline.out"
  FAIL=1
fi

# --- case 9 (THE PORT'S REASON TO EXIST): SAME total, DIFFERENT distribution
# across two rules in one file. Baseline claims no-unused-vars=1, no-
# explicit-any=2 (total 3) against a fixture whose REAL current counts are
# no-unused-vars=2, no-explicit-any=1 (also total 3). A per-file-TOTAL
# ratchet (frontend's shape, or this guard's own logic with the key
# collapsed to just `file`) would see 3 == 3 and stay silent. Per-tuple
# comparison must catch the no-unused-vars tuple growing 1 -> 2, REGARDLESS
# of no-explicit-any shrinking 2 -> 1 in the same file, same commit.
printf '%s @typescript-eslint/no-unused-vars 1\n%s @typescript-eslint/no-explicit-any 2\n' \
  "$REL_ERROR" "$REL_ERROR" > "$TMP/baseline-shifted.txt"
if run_ratchet "$TMP/baseline-shifted.txt" >"$TMP/ratchet-shifted.out" 2>&1; then
  echo "!! self-test FAIL [case 9: aynı toplam farklı dağılım]: --ratchet exit 0 verdi — total (3=3) sessiz bıraktı, TUPLE'ı görmedi"
  cat "$TMP/ratchet-shifted.out"
  FAIL=1
else
  if ! grep -q "RATCHET VIOLATION: 1 -> 2" "$TMP/ratchet-shifted.out"; then
    echo "!! self-test FAIL [case 9: aynı toplam farklı dağılım]: exit 1 doğru ama beklenen no-unused-vars mesajı yok"
    cat "$TMP/ratchet-shifted.out"
    FAIL=1
  fi
  # And the shrinking tuple (no-explicit-any 2 -> 1) must be reported as
  # "improved", not silently absorbed into a passing total either.
  if ! grep -q "improved: ${REL_ERROR} @typescript-eslint/no-explicit-any 2 -> 1" "$TMP/ratchet-shifted.out"; then
    echo "!! self-test FAIL [case 9b: iyileşme kaydı]: no-explicit-any'nin 2->1 iyileşmesi raporlanmadı"
    cat "$TMP/ratchet-shifted.out"
    FAIL=1
  fi
fi

if [ "$FAIL" -ne 0 ]; then
  {
    echo "!!"
    echo "!! lint-ratchet self-test'i kendi beklenen matrisini geçemedi. Bu, kaynak"
    echo "!! kodun temiz olduğu anlamına GELMEZ — ratchet'in ölçüm yaptığı anlamına"
    echo "!! gelmez. Beklentiyi değiştirmeden önce başlıktaki gerekçeleri oku."
  } >&2
  exit 1
fi

echo "-- [lint-ratchet] self-test: 9/9 vaka tuttu (dedektör(x2 kural), temiz-dosya, taban-eşit, taban-aşıldı, yeni-dosya, silinmiş-dosya, kapsam-dışı, taban-yok, aynı-toplam-farklı-dağılım)"
exit 0

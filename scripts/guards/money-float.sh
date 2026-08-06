#!/usr/bin/env bash
#
# Guard: money-float  (ADR 0007 Karar 3b, Karar 8.2)
#
# Catches: IEEE-754 entry points on money paths — `parseFloat`, `Number(`,
# `toFixed`, `Math.round` — inside Domain A files.
#
# WHY THIS GUARD EXISTS
# ADR 0007 chose scope option C: new modules are born with exact representation,
# existing Domain A code converts opportunistically. Karar 3b states the problem
# with that plainly:
#
#   "Fırsatçı" tetikleyicisiz bırakılırsa "asla" demektir.
#   (Opportunistic without a trigger means never.)
#
# This guard is half of that trigger. The other half is the recorded baseline
# (`money-float-baseline.txt`) plus a Done-checklist rule: a touched Domain A
# file's finding count must not increase. Decreases are the ratchet turning.
#
# THIS GUARD CONVERTS NOTHING. It measures.
#
# MONEY-CONTEXT RULE (documented decision, F0)
# Not every `Number()` is money — pagination, ids and counters are legitimate.
# 0010 measured 347 `Number(` codebase-wide, only 130 in money context. Static
# detection of "is this value money?" is not reliable, so this guard does NOT
# attempt it. Instead the money context IS the Domain A membership: ADR Karar 1
# already decided which modules handle money. Inside those modules the guard
# OVER-REPORTS by design and the allowlist absorbs the legitimate non-money
# uses, each with a written justification.
# Consequence, stated openly: the baseline contains some findings that will
# never be converted. They are visible and justified rather than silently
# excluded by a heuristic nobody can review.
#
# GUARD_MODE=block   → findings cause exit 1
# GUARD_MODE=report  → print findings, exit 0 (F0 runs in report mode)
# allowlist parse error → exit 2 (both modes)
set -uo pipefail

GUARD_NAME="money-float"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$ROOT/scripts/guards/allowlist.txt"
DOMAIN_LIST="${MONEY_FLOAT_DOMAIN_LIST:-$ROOT/scripts/guards/money-float-domain-a.txt}"
BASELINE="${MONEY_FLOAT_BASELINE:-$ROOT/scripts/guards/money-float-baseline.txt}"
cd "$ROOT"
# shellcheck source=lib.sh
source "$ROOT/scripts/guards/lib.sh"

validate_allowlist "$ALLOWLIST" || exit 2

# Domain B paths. A finding here is not a finding — it is evidence that either
# ADR Karar 1's boundary or the domain list is wrong. Reported as a hard error
# so it cannot be triaged away into the allowlist.
DOMAIN_B_RE="finance-reporting|kpi-engine|dashboard"

if [ ! -f "$DOMAIN_LIST" ]; then
  # SKIPPED is not a pass — run-all.sh counts a skipped source guard as a
  # setup failure, not as green.
  echo "-- [$GUARD_NAME] SKIPPED: domain list not found ($DOMAIN_LIST)"
  exit 0
fi

# EXACTNESS PRIMITIVES — ADR 0007 errata E15.
#
# This directory is Domain A and is declared in NEW_MODULES, i.e. blocking. The
# detector still does not fire inside it, and the reason is not an exemption:
#
# The guard looks for `Number(`, `parseFloat`, `toFixed` and `Math.round`
# because those are the patterns by which exactness is LOST. In the module that
# BUILDS exactness the same patterns produce it. `money.ts` parses a decimal
# string into minor units — calling `Number()` on a digit substring is exactly
# how an exact integer is obtained, not a lapse. `rounding.ts`'s `Math.round`
# is not a `Math.round` to be banned; it is the one sanctioned rounding
# primitive the ban exists to funnel everything into. A textual scanner cannot
# tell those apart, and should not be expected to: it has no semantics.
#
# So this is guard KNOWLEDGE, not an allowlist entry — the same class as
# migration-schema.sh learning that `'main.x'::regclass` is schema-safe.
# allowlist.txt's own rule requires it to be here: "a known false-positive
# pattern must be recognised by the guard itself".
#
# WHAT REPLACES THE DETECTOR HERE
# Silencing a detector without replacing the protection would be the real
# defect. The exactness guarantee of this module is held by F1's 17
# property-based tests (`numeric.property.spec.ts`), not by this scan. E15 is
# not "exempted, unprotected" — it is "protected by a stronger instrument".
#
# THE RULE FOR ADDING A FILE HERE (the risk of a directory-level rule)
# Putting a file in this directory ASSERTS that it is an exactness primitive
# and is covered by property-based tests. Business logic does not go here. A
# file that does not meet that description belongs in its module, where the
# detector does fire.
# E16 (T-086): the exemption is declared PER FILE, not per directory. See
# scripts/guards/exactness-primitives.txt for why — in short, a per-directory
# rule cannot tell a repaid finding from one relocated into the exempt path, and
# E15's "putting a file here asserts it is a primitive" lived only in a comment.
PRIMITIVES_LIST="${MONEY_FLOAT_PRIMITIVES:-$ROOT/scripts/guards/exactness-primitives.txt}"

# The declared set, comments and blanks stripped. Empty is a legitimate state
# (nothing exempt) and must NOT become "exempt everything" — `grep -F -f` with an
# empty pattern file matches nothing, which is the safe direction, and the
# self-test below pins it either way.
primitives() {
  [ -f "$PRIMITIVES_LIST" ] || return 0
  grep -vE '^[[:space:]]*(#|$)' "$PRIMITIVES_LIST"
}

# THE filter. Both the scan and the self-test go through this one function, and
# that is not tidiness — it is the whole reason the self-test means anything.
#
# An earlier version had the self-test build its own copy of the same `grep`.
# Mutation testing showed what that bought: replacing the SCAN's filter with a
# per-directory prefix match — precisely the regression E16 exists to prevent —
# left the self-test green and the guard exited 0. The test was checking a
# private replica of the thing under test.
#
# `-F -x -v -f`: fixed strings, WHOLE LINE, inverted, from a file. Whole-line is
# what makes this per-file; a prefix match would exempt everything beneath a
# declared path and put us back at E15.
apply_primitive_filter() {
  grep -Fxv -f <(primitives)
}

# Resolve the declared modules to a concrete, deterministically sorted file set.
domain_files() {
  local d
  while IFS= read -r d; do
    case "$d" in ''|\#*) continue ;; esac
    [ -d "$d" ] || continue
    find "$d" -type f -name "*.ts" ! -name "*.spec.ts" 2>/dev/null
  done < "$DOMAIN_LIST" | apply_primitive_filter | sort -u
}

# E15 self-test — the filter above must EXCLUDE the primitives and INCLUDE
# everything else. Both directions, because a broken filter fails silently in
# both: a pattern that matches nothing leaves the directory scanned (what BSD
# grep's unsupported `\?` actually did when E15 was written, caught only by
# measuring the baseline), and a pattern that matches too much would empty the
# whole scan while still exiting 0.
# Three directions, because a filter can fail in three ways and two of them look
# like success: it can stop excluding what it should (findings reappear — loud),
# it can start excluding what it should not (findings vanish — silent), or it can
# do nothing at all while appearing to run (E15's `\?` bug — also silent).
self_test() {
  local out rc=0
  out="$(printf '%s\n' \
      'src/common/numeric/money.ts' \
      'src/common/numeric/NOT_DECLARED.ts' \
      'src/modules/shared/budget/budget.service.ts' \
    | apply_primitive_filter)"

  case "$out" in
    *'src/common/numeric/money.ts'*)
      echo "-- [$GUARD_NAME] SELF-TEST FAIL: a declared primitive was not excluded"
      rc=1 ;;
  esac
  # THE POINT OF E16. Under the old per-directory rule this file was exempt
  # merely for sitting in the directory; now it must be scanned until someone
  # declares it in a reviewable diff.
  case "$out" in
    *'src/common/numeric/NOT_DECLARED.ts'*) ;;
    *)
      echo "-- [$GUARD_NAME] SELF-TEST FAIL: an UNDECLARED file under src/common/numeric was exempted — the exemption is per-file (E16), not per-directory"
      rc=1 ;;
  esac
  case "$out" in
    *budget.service.ts*) ;;
    *)
      echo "-- [$GUARD_NAME] SELF-TEST FAIL: filter excluded a normal Domain A file"
      rc=1 ;;
  esac
  return $rc
}
self_test || exit 2

FILES="$(domain_files)"

if [ -z "$FILES" ]; then
  echo "-- [$GUARD_NAME] SKIPPED: domain list resolved to zero files"
  exit 0
fi

# Detection.
#
# The `(^|[^A-Za-z0-9_$])` prefix is load-bearing, not cosmetic: without it
# `@IsNumber()` matches `Number(`. Measured on the real tree that was 38 of 138
# raw `Number(` hits — 28% of the signal would have been class-validator
# decorators. A baseline built on that number would be noise.
#
# Comment handling is line-level (a trimmed line starting with `//`, `*`, `/*`
# is skipped). This is a heuristic, and heuristics are what forced
# `migration-schema.awk` into existence — so its limit is recorded here rather
# than discovered later: a `Number(` sitting inside a multi-line block comment
# whose line does not itself start with a comment marker WILL be reported.
# That direction is the safe one (over-report), and the allowlist absorbs it.
# `migration-schema.awk` is not reused because it is a template-literal
# extractor; money-float needs no literal tracking.
scan() {
  printf '%s\n' "$FILES" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    awk -v file="$f" -v guard="$GUARD_NAME" '
      {
        line = $0
        t = line; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
        if (t ~ /^(\/\/|\*|\/\*)/) next

        n = 0
        if (match(t, /(^|[^A-Za-z0-9_$])parseFloat\(/))  { n++; what = "parseFloat" }
        if (match(t, /(^|[^A-Za-z0-9_$])Number\(/))      { n++; what = "Number()" }
        if (match(t, /(^|[^A-Za-z0-9_$])toFixed\(/))     { n++; what = "toFixed" }
        if (match(t, /(^|[^A-Za-z0-9_$])Math\.round\(/)) { n++; what = "Math.round" }
        if (n == 0) next
        if (n > 1) what = "multiple float entry points"

        printf "[%s] %s:%d\n", guard, file, NR
        printf "  %s on a Domain A (money) path — ADR 0007 Karar 3b ratchet\n", what
        printf "  > %s\n", t
      }
    ' "$f"
  done
}

RAW="$(scan)"

# Boundary check before allowlist filtering: a Domain B hit must never be
# suppressible.
LEAK="$(printf '%s\n' "$RAW" | grep -E "^\[$GUARD_NAME\] .*($DOMAIN_B_RE)" || true)"
if [ -n "$LEAK" ]; then
  {
    echo "!! [$GUARD_NAME] Domain B file appeared in findings — boundary violated"
    echo "!! ADR 0007 Karar 1 puts finance-reporting / kpi-engine / dashboard in Domain B."
    echo "!! Either the boundary is wrong or money-float-domain-a.txt is. Not allowlistable."
    printf '%s\n' "$LEAK"
  } >&2
  exit 2
fi

# --- ratchet -----------------------------------------------------------------
# Explicit invocation only. A baseline that rewrites itself cannot be reviewed,
# so nothing here ever writes to $BASELINE.
#
#   money-float.sh --baseline   → emit a fresh baseline on stdout (operator
#                                 redirects it; the write is a reviewable diff)
#   money-float.sh --ratchet    → compare current counts to the baseline
#
counts_by_file() {
  printf '%s\n' "$RAW" | grep -E "^\[$GUARD_NAME\] " \
    | sed -E "s/^\[$GUARD_NAME\] //; s/:[0-9]+$//" \
    | sort | uniq -c | awk '{printf "%s %s\n", $2, $1}' | sort
}

case "${1:-}" in
  --baseline)
    echo "# money-float baseline — ADR 0007 Karar 3b ratchet reference"
    echo "# date:    $(date +%Y-%m-%d)"
    echo "# commit:  $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "# guard:   money-float v1"
    echo "# total:   $(printf '%s\n' "$RAW" | grep -c "^\[$GUARD_NAME\] " || true) findings in $(counts_by_file | wc -l | tr -d ' ') files"
    echo "# format:  <file> <count>   (sorted by file; only non-zero counts)"
    counts_by_file
    exit 0
    ;;
  --ratchet)
    if [ ! -f "$BASELINE" ]; then
      echo "!! [$GUARD_NAME] no baseline at $BASELINE — run --baseline first" >&2
      exit 2
    fi
    CUR="$(counts_by_file)"
    RC=0
    # Increases and new files are failures. Decreases are the ratchet turning
    # and are reported as progress, never auto-applied: updating the baseline
    # stays an explicit, reviewable commit.
    while read -r file count; do
      case "$file" in ''|\#*) continue ;; esac
      now="$(printf '%s\n' "$CUR" | awk -v f="$file" '$1==f {print $2}')"
      if [ ! -e "$file" ]; then
        echo "-- [$GUARD_NAME] GONE: $file (baseline $count) — deleted or renamed; drop the line in the same commit"
        continue
      fi
      now="${now:-0}"
      if [ "$now" -gt "$count" ]; then
        echo "[$GUARD_NAME] $file"
        echo "  RATCHET VIOLATION: $count -> $now findings"
        RC=1
      elif [ "$now" -lt "$count" ]; then
        echo "-- [$GUARD_NAME] improved: $file $count -> $now (update baseline explicitly)"
      fi
    done < "$BASELINE"

    while read -r file count; do
      [ -n "$file" ] || continue
      if ! grep -qE "^${file} " "$BASELINE"; then
        echo "[$GUARD_NAME] $file"
        echo "  NEW Domain A file with $count findings — new code must be born exact (ADR 0007 Karar 8.2)"
        RC=1
      fi
    done <<< "$CUR"

    exit "$RC"
    ;;
esac

# Normal (non-ratchet) run: print findings and set COUNT/SUPPRESSED.
# This runs AFTER the mode dispatch above on purpose — --baseline and --ratchet
# write machine-read output to stdout and must not be polluted by the human
# finding stream.
report_guard "$RAW"

if [ "$GUARD_MODE" = "block" ] && [ "$COUNT" -gt 0 ]; then
  exit 1
fi
exit 0

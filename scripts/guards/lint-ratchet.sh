#!/usr/bin/env bash
#
# Guard: lint-ratchet (backend) — T-113.
#
# WHY THIS GUARD EXISTS
#
#   T-100   `npm run lint` = changed-ts.sh | xargs -r eslint --fix
#           scope EMPTIES after a commit (staged+unstaged+untracked all
#           empty) → `xargs -r` runs nothing → ALWAYS GREEN.
#   this    `npm run lint:check` = eslint "{src,apps,libs,test}/**/*.ts"
#           full-repo, no --fix → ALWAYS RED (measured 2026-08-15: 125
#           errors + 962 warnings = 1087 problems, across 498 scanned files,
#           183 of them with findings — see baseline header for the live
#           number, this comment goes stale).
#
# §2.7 #9: "sinyal sabitse, sinyal değildir." A commit that adds a lint
# violation and a commit that removes ten give `npm run lint:check` the same
# exit code (1) either way — on its own it carries no signal. This guard is
# an ADDITIVE check on top of it, not a replacement: `npm run lint:check`
# keeps failing on today's debt, and it should.
#
# THE 108→1087 DISCREPANCY (report this, do not silently correct it away)
# The task brief that requested this guard said "108 error / 54 dosya".
# Measured reality (2026-08-15, `npx eslint "{src,apps,libs,test}/**/*.ts"
# --format json`): 125 errors + 962 warnings = 1087 problems, 183 files, 210
# distinct (file, rule) tuples. The brief's number was not used for anything
# structural below — the baseline is generated from a live scan, not typed
# in — but it is a measured MISMATCH worth carrying forward (CLAUDE.md: "bir
# DÜZELTMENİN kendisi de bir iddiadır" / a stated acceptance number is not
# a substitute for measuring it yourself).
#
# BASELINE GRANULARITY: (file, rule) TUPLE, NOT A PER-FILE TOTAL
# `mode-split-baseline.txt`'s own comment: "sayı-baseline 'biri düştü, biri
# girdi' gerilemesini GÖRMEZ." A per-file COUNT has exactly that blind spot
# one level down: if a file has 3 `no-unused-vars` + 2 `no-explicit-any`
# (total 5) and someone fixes all 3 `no-unused-vars` but introduces 3 NEW
# `no-explicit-any`, the per-file total is still 5 — unchanged, ratchet
# silent, but a rule class that had never fired in that file now fires 3
# times. That is exactly CLAUDE.md's "bir toplamın azalması, bir SINIFIN
# girmediğinin kanıtı değildir." So the baseline key here is
# `<file> <ruleId> <count>`, and the ratchet compares PER TUPLE. lint-ratchet-
# self-test.sh's case 9 pins this with a same-file, same-total,
# different-distribution fixture — a file-total-only ratchet passes it, this
# one must not.
#
# WHY THIS PORTS collmind.frontend/scripts/guards/lint-ratchet.sh'S SHAPE
# BUT NOT ITS FIXTURE MECHANISM OR ITS TARGET-QUOTING
# Frontend's guard is the direct ancestor: baseline/ratchet/GONE/OUT-OF-SCOPE/
# malformed-count machinery, NEW-finding-is-a-violation ("born lint-clean"),
# --baseline/--ratchet dispatch, TARGETS override for self-test. That is
# reused. Two things are NOT ported verbatim, because CLAUDE.md's port rule
# ("bunu kaynağında doğru kılan şey bu satır mı, yoksa etrafındaki bir şey
# mi?") fails for both, measured:
#
#   1. Frontend's self-test names fixtures `*.ts.fixture` and lints them by
#      explicit path, relying on frontend's eslint config having NO
#      `parserOptions.project` (not type-aware). Backend's `.eslintrc.js` DOES
#      set `parserOptions.project: 'tsconfig.json'` (type-aware parsing).
#      Measured: pointing eslint at a `.ts.fixture` file here throws a fatal
#      parse error ("The extension for the file (`.fixture`) is
#      non-standard... add parserOptions.extraFileExtensions") — the fixture
#      would report 1 problem (a parse failure) no matter what it contains,
#      and the self-test's exact-count assertions would all be measuring the
#      wrong thing. Fixtures here are named plain `.ts.fixture` is NOT used;
#      they are `scripts/guards/fixtures/lint/*.ts` — real `.ts` files. This
#      is safe because backend's target glob is `{src,apps,libs,test}/**/*.ts`
#      (narrow), unlike frontend's `eslint .` (whole repo) — a `.ts` file
#      under `scripts/guards/fixtures/lint/` is outside `{src,apps,libs,test}`
#      by construction, so it is never picked up by the real `npm run
#      lint:check` regardless of extension. (tsconfig.json has no
#      include/exclude, so these files ARE part of the type-aware program by
#      default — which is exactly what avoids the parse error.)
#
#   2. Frontend calls `npx eslint $TARGETS --ext ts,tsx --format json`
#      unquoted by design (so its self-test override, a space-separated file
#      list, splits into separate args). Backend's default target is a SINGLE
#      brace-glob string, `"{src,apps,libs,test}/**/*.ts"`, and
#      `package.json`'s `lint:check` passes it QUOTED as one argument on
#      purpose — measured: unquoting it and letting a shell literally glob-
#      expand `apps/**/*.ts` / `libs/**/*.ts` (directories that do not exist
#      in this repo) can abort the whole invocation under a shell with
#      nomatch-is-an-error semantics. TARGETS is therefore built as a bash
#      ARRAY: the default is a single element (preserves exact single-arg
#      parity with the npm script), the self-test override
#      (`LINT_RATCHET_TARGETS`, space-separated) is word-split into multiple
#      elements — same override mechanism as frontend, safe default.
#
# WHAT DID NOT PORT (enumerated, not assumed complete from memory — diffed
# against `ls collmind.frontend/scripts/guards/`):
#   - lint-ratchet-baseline.txt's CONTENT does not port (different repo,
#     different violations) — only the file NAME/role ports.
#   - No allowlist.txt integration: frontend's lint-ratchet does not use one
#     either (checked: `grep -n allowlist lint-ratchet.sh` → 0 matches there
#     too), so there is nothing to port on that axis.
#   - Frontend's `guard:lint` npm script (self-test && ratchet) is ported to
#     package.json here for direct/manual invocation, but the REAL gate is
#     `run-all.sh` (backend's actual `npm run guards` entry point has no
#     frontend equivalent to diff against — it is backend-specific already).
#
# GUARD_MODE=block   → any current tuple with count > baseline (or new)
#                       causes exit 1 in the bare/report... see below; the
#                       bare/non-ratchet invocation only reports RAW findings
#                       and blocks on ANY finding > 0 (rarely interesting
#                       today, since the codebase is not lint-clean) —
#                       --ratchet is the actual gate `run-all.sh` uses.
# GUARD_MODE=report  → print per-(file,rule) tuple counts, exit 0
# --baseline / --ratchet → see bottom of file
set -uo pipefail

GUARD_NAME="lint-ratchet"
GUARD_MODE="${GUARD_MODE:-block}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASELINE="${LINT_RATCHET_BASELINE:-$ROOT/scripts/guards/lint-ratchet-baseline.txt}"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "!! [$GUARD_NAME] SETUP FAILURE: node not found on PATH" >&2
  exit 2
fi

# TARGETS as an array — see header note #2. Default is ONE element (exact
# parity with package.json's quoted `lint:check` argument); the self-test
# override is space-separated and intentionally word-split into several.
if [ -n "${LINT_RATCHET_TARGETS:-}" ]; then
  # shellcheck disable=SC2206
  TARGETS=($LINT_RATCHET_TARGETS)
else
  TARGETS=('{src,apps,libs,test}/**/*.ts')
fi

RAW_JSON="$(mktemp -t lint-ratchet-raw.XXXXXX.json)"
RAW_STDERR="$(mktemp -t lint-ratchet-raw.XXXXXX.stderr)"
trap 'rm -f "$RAW_JSON" "$RAW_STDERR"' EXIT

npx eslint "${TARGETS[@]}" --format json ${LINT_RATCHET_EXTRA_ARGS:-} \
  >"$RAW_JSON" 2>"$RAW_STDERR"
ESLINT_RC=$?
# ESLint's own exit code: 0 = no problems, 1 = lint problems found (a
# successful run — this guard exists to interpret it), 2 = fatal (bad
# config, crash, "no files matching the pattern"). Only 2 is a setup failure.
if [ "$ESLINT_RC" -ge 2 ]; then
  echo "!! [$GUARD_NAME] SETUP FAILURE: eslint exited $ESLINT_RC (fatal, not a lint finding)" >&2
  cat "$RAW_STDERR" >&2
  exit 2
fi

if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$RAW_JSON" 2>/dev/null; then
  echo "!! [$GUARD_NAME] SETUP FAILURE: eslint --format json did not produce parseable JSON" >&2
  cat "$RAW_STDERR" >&2
  exit 2
fi

# Every (file, rule) tuple with count > 0, PLUS a "__NONE__ 0" sentinel row
# for every scanned file that has zero findings — the sentinel is what lets
# the ratchet below tell "file scanned, this rule just doesn't fire here
# anymore" (improved to zero — not a violation) apart from "file never
# scanned at all" (OUT OF SCOPE — a violation). A `ruleId: null` message
# (ESLint fatal parse error) is NOT silently dropped (§2.5): it is counted
# under the literal token `__NO_RULE_ID__` so a file that starts failing to
# parse shows up as a new/changed tuple like anything else.
all_tuples() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const root = process.argv[1];
    const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const rows = [];
    for (const f of data) {
      const rel = path.relative(root, f.filePath);
      const byRule = new Map();
      for (const m of f.messages) {
        const rid = (m.ruleId === null || m.ruleId === undefined) ? "__NO_RULE_ID__" : m.ruleId;
        byRule.set(rid, (byRule.get(rid) || 0) + 1);
      }
      if (byRule.size === 0) {
        rows.push([rel, "__NONE__", 0]);
      } else {
        for (const [rid, c] of byRule) rows.push([rel, rid, c]);
      }
    }
    rows.sort((a, b) => {
      if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
      if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
      return 0;
    });
    for (const [f, r, c] of rows) console.log(f + " " + r + " " + c);
  ' "$ROOT" "$RAW_JSON"
}

ALL="$(all_tuples)"
# The >0 subset — "findings" everywhere below. Excludes the __NONE__ sentinel.
CUR="$(printf '%s\n' "$ALL" | awk '$2 != "__NONE__"')"

if [ -z "$ALL" ]; then
  echo "!! [$GUARD_NAME] SETUP FAILURE: eslint scanned zero files (targets: '${TARGETS[*]}')" >&2
  exit 2
fi

case "${1:-}" in
  --baseline)
    echo "# lint-ratchet baseline (backend) — T-113 ratchet reference"
    echo "# date:    $(date +%Y-%m-%d)"
    echo "# commit:  $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "# guard:   lint-ratchet v1 (backend)"
    echo "# total:   $(printf '%s\n' "$CUR" | grep -c . || true) (file,rule) tuples, $(printf '%s\n' "$CUR" | awk '{s+=$3} END {print s+0}') problems, $(printf '%s\n' "$CUR" | awk '{print $1}' | sort -u | grep -c . || true) files"
    echo "# format:  <file> <ruleId> <errorCount+warningCount for that rule in that file>"
    echo "# KEY IS (file, rule), NOT file alone — see this script's header for why."
    printf '%s\n' "$CUR"
    exit 0
    ;;
  --ratchet)
    if [ ! -f "$BASELINE" ]; then
      echo "!! [$GUARD_NAME] no baseline at $BASELINE — run --baseline first" >&2
      exit 2
    fi
    RC=0
    while read -r file rule count; do
      case "$file" in ''|\#*) continue ;; esac
      case "$count" in
        ''|*[!0-9]*)
          echo "!! [$GUARD_NAME] SETUP FAILURE: malformed baseline line for $file $rule (count: '$count')" >&2
          exit 2
          ;;
      esac
      if [ ! -e "$file" ]; then
        echo "-- [$GUARD_NAME] GONE: $file $rule (baseline $count) — deleted or renamed; drop the line in the same commit"
        continue
      fi
      # Is the FILE in scope at all (any row, including __NONE__)?
      file_in_scope="$(printf '%s\n' "$ALL" | awk -v f="$file" '$1==f {found=1} END {print found+0}')"
      if [ "$file_in_scope" = "0" ]; then
        echo "[$GUARD_NAME] $file $rule"
        echo "  OUT OF SCOPE: still on disk but no longer covered by the lint scan (baseline $count)"
        echo "  A scope removal is not a repayment. Restore it, or remove the baseline line in the same commit with a reason."
        RC=1
        continue
      fi
      # File is in scope. Does this exact (file, rule) tuple currently have
      # any findings? Exact two-field match against the CURRENT tuple set —
      # not a regex on file/rule (both can contain `.` and other ERE
      # metacharacters, e.g. rule ids like `@typescript-eslint/no-explicit-any`).
      now="$(printf '%s\n' "$ALL" | awk -v f="$file" -v r="$rule" '$1==f && $2==r {print $3; found=1} END {if (!found) print "__ZERO__"}')"
      if [ "$now" = "__ZERO__" ]; then
        now=0
      fi
      if [ "$now" -gt "$count" ]; then
        echo "[$GUARD_NAME] $file $rule"
        echo "  RATCHET VIOLATION: $count -> $now problems"
        RC=1
      elif [ "$now" -lt "$count" ]; then
        echo "-- [$GUARD_NAME] improved: $file $rule $count -> $now (update baseline explicitly)"
      fi
    done < "$BASELINE"

    while read -r file rule count; do
      [ -n "$file" ] || continue
      if ! awk -v f="$file" -v r="$rule" '$1==f && $2==r {found=1} END {exit !found}' "$BASELINE"; then
        already_tracked_file="$(awk -v f="$file" '$1==f {found=1} END {print found+0}' "$BASELINE")"
        echo "[$GUARD_NAME] $file $rule"
        if [ "$already_tracked_file" = "1" ]; then
          echo "  NEW RULE in an already-tracked file: $count problems — a same-file, different-rule regression is still a regression"
        else
          echo "  NEW file with $count problems — new/touched code must be born lint-clean, not added to the debt this ratchet is tracking down"
        fi
        RC=1
      fi
    done <<< "$CUR"

    exit "$RC"
    ;;
esac

# Normal (non-ratchet) run: print per-(file,rule) tuple counts, no baseline
# comparison.
if [ -n "$CUR" ]; then
  printf '%s\n' "$CUR" | while read -r file rule count; do
    [ -n "$file" ] || continue
    echo "[$GUARD_NAME] $file $rule: $count problems"
  done
fi
TOTAL="$(printf '%s\n' "$CUR" | awk '{s+=$3} END {print s+0}')"

if [ "$GUARD_MODE" = "block" ] && [ "$TOTAL" -gt 0 ]; then
  exit 1
fi
exit 0

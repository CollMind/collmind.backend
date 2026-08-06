#!/usr/bin/env bash
# Repo-relative paths of the .ts/.tsx files this working tree has touched —
# staged, unstaged and untracked, de-duplicated, existing files only.
#
# WHY THIS EXISTS (T-092)
# `npm run format` and `npm run lint --fix` used to rewrite the entire tree. In
# one session that cost real work twice: a format run reformatted 11 committed
# files unrelated to the change in progress, and a lint run rewrote nine — one of
# them while the actual work sat in `git stash`, which then refused to pop.
# Both were recoverable by hand. Neither should have needed hands.
#
# The rule this replaces was going to be a line in CLAUDE.md telling people to
# revert what they did not mean to touch. That is discipline. This is mechanism,
# and the recurring finding of that session was discipline losing to mechanism.
#
# SCOPE, DELIBERATELY NARROW: this feeds the FIXERS only. `format`/`lint` rewrite
# files, so they act on what you changed. Checkers — `guards`, `lint:check`,
# `tsc` — still read the whole repository, because narrowing a checker is how a
# guard goes blind (ADR 0007 E15/E16 is the same lesson from the other side).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

{
  git diff --name-only --diff-filter=d -- '*.ts' '*.tsx'
  git diff --name-only --diff-filter=d --cached -- '*.ts' '*.tsx'
  git ls-files --others --exclude-standard -- '*.ts' '*.tsx'
} | sort -u | while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] && printf '%s\n' "$f"
done

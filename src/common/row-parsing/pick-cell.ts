/**
 * T-107 adım 2 — resolves the first present value among a spreadsheet row's
 * header-alias spellings (`code` / `Code` / `CODE`, `credit_limit` /
 * `CreditLimit` / ...).
 *
 * Replaces the `row.a || row.b || row.c` pattern that all three
 * `sheet_to_json`-based importers used for this (`customer/services/
 * file-parser.service.ts`, `on-invoice/services/on-invoice-file-parser.
 * service.ts`, `agreement-transaction/services/off-invoice-file-parser.
 * service.ts`) — for a reason `||` cannot express: `||` treats every
 * JS-falsy value (`false`, `0`, `''`) as "keep looking", so a REAL boolean
 * `false` or a REAL numeric `0` typed under an alias spelling that is not
 * the LAST one evaluated in the chain is silently discarded, indistinguishable
 * from an absent cell.
 *
 * Measured (T-107 adım 2, under `raw: true` — see the importers' own
 * `sheet_to_json` call for that flag): a `creditLimit` column (the FIRST
 * alias in that field's old chain) holding the value `0` resolved to
 * `undefined` through `row.creditLimit || row.credit_limit || row.CreditLimit
 * || row.CREDIT_LIMIT` — not because the cell was blank, but because `0` is
 * falsy and JS moved on to the next (absent) alias, and there `undefined` won
 * by being last. `getOptionalNumber` then received `undefined` and returned
 * `undefined` with NO parseError: a real `0` a user typed vanished from the
 * import with no trace it had ever been there — the exact silent-zero shape
 * §2.5 forbids. The SAME chain read `0` correctly when the file happened to
 * use the LAST alias spelling instead (`CREDIT_LIMIT`), because `0` was then
 * the chain's own last operand — so the bug's presence depended on which of
 * four equally-valid header spellings a user's file happened to use, not on
 * the value itself. This is the same "leaks only as the last operand" shape
 * already documented for the boolean blank-cell sentinel (see
 * `file-parser.service.ts`'s row-normalization comment) — `pickCell` closes
 * both at once because it never asks "is this falsy", only "is this absent".
 *
 * `pickCell` asks one question per alias — is this key's value `null` or
 * `undefined`? — and returns the FIRST one that is neither. A real `false`, a
 * real `0`, and a real `''` (an explicit blank string, as opposed to a
 * genuinely absent cell) all qualify and are returned as-is; the field-level
 * getter each caller passes the result to (`getOptionalNumber`,
 * `getOptionalBoolean`, `getOptionalString`, ...) already treats `null` /
 * `undefined` as absent, so no second normalization step is needed here.
 *
 * `null` matters because `defval: null` (the importers' shared blank-cell
 * fill value as of T-107 adım 2) is the one value `sheet_to_json` can NEVER
 * produce for a cell that was actually written — under `raw: true` a written
 * cell is only ever `string | number | boolean` (dates arrive as numeric
 * serials here; `cellDates` is off in all three importers) — so `null` is an
 * unambiguous "this header column exists but this row's cell does not"
 * signal, never a value a user typed.
 */
export function pickCell(row: Record<string, unknown>, ...keys: string[]): any {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return undefined;
}

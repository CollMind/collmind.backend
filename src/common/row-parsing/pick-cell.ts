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
 * genuinely absent cell) all qualify and are returned as-is.
 *
 * ⚠️ The claim that used to sit here — "the field-level getter each caller
 * passes the result to already treats `null`/`undefined` as absent, so no
 * second normalization step is needed" — was checked against three getters
 * (`getOptionalNumber`, `getOptionalBoolean`, `getOptionalString`) and
 * generalized to "each caller" without enumerating the REST of the call
 * sites (T-107 adım 2 review, B3). Measured, the actual set of things a
 * `pickCell` result flows into, and what each does with `''`:
 *
 *   - `getStringValue` (all three importers): returns `''` AS-IS — no
 *     normalization. `file-parser.service.ts`'s `code` field fed this
 *     straight from `pickCell(...) ?? \`AUTO_\${n}\`` — `??` does not
 *     trigger on `''`, so a CSV's empty `code` cell (`csv-parser` fills
 *     missing text with `''`, never `null`) produced `code: ''` instead of
 *     the `AUTO_n` fallback an XLSX blank cell still got (`file-parser.
 *     service.ts:276-279`, fixed alongside this comment).
 *   - `getNumberValue` (`on-invoice-file-parser.service.ts:300`,
 *     `off-invoice-file-parser.service.ts:280`): does NOT treat `''` as
 *     absent — `parseNumericText('')` fails the grammar and THROWS.
 *   - `getDateValue` (both invoice importers): explicitly throws on
 *     `value === ''`.
 *   - `getFiscalPeriod` (on-invoice, required variant): same — throws.
 *   - the blank-row filters in both invoice importers (`pickCell(...) !==
 *     undefined`): `''` is neither `null` nor `undefined`, so `''` counted
 *     as PRESENT — a `,,,` CSV row (every aliased column resolves to `''`)
 *     survived the filter and then hit one of the throwing getters above,
 *     taking the WHOLE FILE down (§2.5 — this is exactly a row-level defect
 *     escalating to file-level, undetected because the filter's job was
 *     never verified against `csv-parser`'s actual blank-cell value).
 *
 * None of this is a defect in `pickCell` itself — resolving "what value" and
 * deciding "is this row blank" are different questions, and `pickCell`
 * answers only the first. `hasCellValue` below answers the second; ask it,
 * not `pickCell(...) !== undefined`, when the question is presence rather
 * than value.
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

/**
 * "Does this row have anything a user typed under any of these aliases" —
 * the question a blank-row filter actually asks, and a DIFFERENT question
 * from `pickCell`'s "what value should this field resolve to" (T-107 adım 2
 * review, B1/B3). `pickCell(...) !== undefined` answers the wrong question
 * for this purpose: under `csv-parser` (the CSV branch of all three
 * importers), a column with nothing between two commas resolves to `''`,
 * never `null`/`undefined` — `sheet_to_json`'s `defval: null` behavior does
 * not apply to the CSV path at all. `pickCell` correctly returns that `''`
 * (a real, if blank, string is a value, not an absence — see `pickCell`'s
 * own doc), but a filter deciding "is this whole ROW blank" needs a
 * stricter bar: `null`, `undefined`, and an empty-after-trim string are all
 * "nothing was typed here"; everything else — INCLUDING a real `0` or
 * `false` — is "something was typed here".
 *
 * Measured regression this closes (T-107 adım 2 review, B1): a `,,,` CSV
 * row (header `agreement_id,invoice_no,amount,invoice_date`) has every
 * aliased column at `''`. Under the old `pickCell(...) !== undefined`
 * filter this counted as a real row (`'' !== undefined`), survived into
 * `getDateValue`, which explicitly throws on `value === ''` —
 * `BadRequestException('Invoice date değeri zorunludur')` — rejecting the
 * ENTIRE FILE, including every good row after it. Excel's "Save as CSV"
 * produces exactly this shape for every row within the used range that has
 * no content in a given column, so this is not a rare hand-crafted input.
 */
export function hasCellValue(
  row: Record<string, unknown>,
  ...keys: string[]
): boolean {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return true;
  }
  return false;
}

/**
 * T-107 adım 2 review (S2) — shared by all three `sheet_to_json`-based
 * importers (`customer/services/file-parser.service.ts`, `on-invoice/
 * services/on-invoice-file-parser.service.ts`, `agreement-transaction/
 * services/off-invoice-file-parser.service.ts`). Previously only the
 * customer importer carried a private copy of this method; the two invoice
 * importers stored the row's `null` sentinel unchanged into
 * `originalRowData`, so a blank cell surfaced to the API caller (in the
 * per-row error payload) as the literal `null` rather than an omitted key —
 * noise in a response the caller has to read to find their own typo.
 *
 * `null` is XLSX's blank-cell sentinel (`sheet_to_json({ defval: null, raw:
 * true })`, `cellDates: false` in all three importers) — under `raw: true`
 * a cell SheetJS actually read is only ever `string | number | boolean`, so
 * `null` can never collide with a value a user typed (see `pick-cell.ts`'s
 * own doc for the `false`-sentinel regression this replaced). `csv-parser`
 * (the CSV branch) never produces `null` — its blank-cell value is `''`,
 * left untouched here; blank-ROW filtering for `''` is `hasCellValue`'s job
 * (`pick-cell.ts`), not this function's — this function only removes a
 * sentinel that a downstream getter never asked to see, it does not decide
 * presence.
 *
 * Return type is deliberately `any`, not `Record<string, any>`: spreading a
 * `Record<string, any>`-typed value into an object literal together with a
 * named property (e.g. `_originalRowNumber`) makes TS drop the index
 * signature from the resulting literal type — measured, `tsc --strict` then
 * refuses every `row.SOME_ALIAS` access downstream with "Property does not
 * exist on type '{ _originalRowNumber: number }'". The callers' own
 * `data: any[]` pipelines are already untyped by design; `any` here keeps
 * that consistent instead of fighting a spread-narrowing quirk with no
 * behavioural benefit.
 */
export function normalizeBlankCells(row: Record<string, any>): any {
  const normalized: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    normalized[key] = row[key] === null ? undefined : row[key];
  }
  return normalized;
}

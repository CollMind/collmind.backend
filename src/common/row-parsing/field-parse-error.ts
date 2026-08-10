/**
 * T-126: extracted from `customer/services/file-parser.service.ts` (T-121
 * review (a)) so `off-invoice-file-parser.service.ts` and
 * `on-invoice-file-parser.service.ts` can share the SAME shape instead of
 * writing a second/third copy (§7 — "aynı yeteneğin mevcut bir
 * implementasyonu var mı?" — yes, here, and it was about to be rewritten a
 * second and third time).
 *
 * A single field on a single row that could not be turned into a value (an
 * unparseable date or number cell) is a ROW-LEVEL error, not a file-level
 * one (§2.5 — present-but-unreadable must not be silently dropped, and must
 * not take the whole file down with it either). This is the shape that
 * carries ONE such failure from a parser's field getter up to the
 * importer's existing per-row error channel — for `customer` that is
 * `CustomerService.importFromFile`'s `{ row, code, error_type,
 * error_message, original_row_data }`; for `off-invoice`/`on-invoice` it is
 * `OffInvoiceValidationService`/`OnInvoiceValidationService`'s
 * `ValidationError { rowNumber, field, severity, message,
 * originalRowData }`. Each importer's own validation layer decides how to
 * fold a `FieldParseError` into ITS channel's shape — this module only
 * carries the failure across that seam, deliberately unaware of either
 * destination (see `numeric-text.ts` / `date-text.ts` for the same split
 * applied one layer down: parsing vs. what an invalid value MEANS to the
 * caller).
 */
export interface FieldParseError {
  field: string;
  error_type: string;
  error_message: string;
}

/**
 * db-round-trip-counter.ts
 *
 * T-046b (docs/analysis/0007-recalc-scale-telemetry.md §4-T4) — permanent
 * version of the ad-hoc harness used for the T-046/T-046a measurements
 * (0007 §1.1: "`pg.Client.prototype.query` prototype düzeyinde sarmalanarak
 * sayıldı"). Wraps `pg.Client.prototype.query` so every SQL round-trip
 * TypeORM issues (including advisory-lock and transaction commands) is
 * counted, exactly like the deleted `test/zz-perf-scale.e2e-spec.ts`
 * harness did.
 *
 * Deliberately NOT wrapping `pg.Pool` — TypeORM's postgres driver executes
 * every query through a `pg.Client` instance checked out of the pool, so
 * wrapping `Client.prototype.query` catches all of them regardless of pool
 * plumbing, with no double-counting.
 */

// `@types/pg` is not a dependency of this repo (nothing else imports `pg`
// directly — TypeORM's postgres driver requires it internally as an
// untyped CommonJS module). Rather than adding a new dependency for a
// single test helper, require it the same untyped way TypeORM does.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pg = require('pg');
const PgClient: { prototype: { query: unknown } } = pg.Client;

type QueryFn = (...args: unknown[]) => unknown;

let originalQuery: QueryFn | undefined;
let count = 0;

/** Idempotent — safe to call from multiple spec files' `beforeAll`. */
export function installDbRoundTripCounter(): void {
  if (originalQuery) return;
  originalQuery = PgClient.prototype.query as QueryFn;
  (PgClient.prototype as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    count++;
    // eslint-disable-next-line prefer-rest-params
    return (originalQuery as QueryFn).apply(this, args);
  };
}

export function uninstallDbRoundTripCounter(): void {
  if (!originalQuery) return;
  (PgClient.prototype as { query: QueryFn }).query = originalQuery;
  originalQuery = undefined;
}

export function resetDbRoundTripCount(): void {
  count = 0;
}

export function getDbRoundTripCount(): number {
  return count;
}

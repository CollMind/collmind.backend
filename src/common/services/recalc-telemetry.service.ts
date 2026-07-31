import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Observable, Subscription } from 'rxjs';

export interface RecalcTelemetrySnapshot {
  durationMs: number;
  skuCount: number;
}

interface RecalcTelemetryStore {
  snapshot?: RecalcTelemetrySnapshot;
}

/**
 * T-046b (docs/analysis/0007-recalc-scale-telemetry.md §4-T2).
 *
 * `PlanService#recalculatePlanWithKpiEngine` (deep in the call stack) has
 * the recalc timing/size, but no access to the HTTP response object.
 * `RecalcMetricsInterceptor` (at the controller boundary) has the response,
 * but not the timing. This carries the value across that gap, scoped
 * per-request via `AsyncLocalStorage` — NOT a metrics store: nothing here
 * outlives the request. `record()` overwrites the same slot (there is
 * normally exactly one recalc per request); a request whose handler never
 * triggers a recalc simply never calls `record()`, so `current()` stays
 * `undefined` and the interceptor sets no headers. Singleton service is
 * safe: all state lives in the ALS store, never on `this` — no cross-tenant
 * or cross-request leakage risk (the same class of bug §2.4 of the design
 * doc flagged in `calculationCache`, deliberately avoided here).
 */
@Injectable()
export class RecalcTelemetryContext {
  private readonly als = new AsyncLocalStorage<RecalcTelemetryStore>();

  /**
   * Runs `fn` (in practice, `next.handle()` from an interceptor) inside a
   * fresh ALS scope, so any `record()` call anywhere downstream in THIS
   * request's call stack lands in this request's store, never a
   * concurrently in-flight request's.
   */
  runObservable<T>(fn: () => Observable<T>): Observable<T> {
    return new Observable<T>((subscriber) => {
      let subscription: Subscription | undefined;
      this.als.run({}, () => {
        subscription = fn().subscribe(subscriber);
      });
      return () => subscription?.unsubscribe();
    });
  }

  record(snapshot: RecalcTelemetrySnapshot): void {
    const store = this.als.getStore();
    if (store) {
      store.snapshot = snapshot;
    }
  }

  current(): RecalcTelemetrySnapshot | undefined {
    return this.als.getStore()?.snapshot;
  }
}

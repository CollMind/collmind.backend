import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RecalcTelemetryContext } from '../services/recalc-telemetry.service';

/**
 * T-046b (docs/analysis/0007-recalc-scale-telemetry.md §4-T2).
 *
 * Attaches `X-Recalc-Ms` / `X-Recalc-Sku-Count` response headers on
 * endpoints that (may) call `PlanService#recalculatePlanWithKpiEngine`.
 * ADR 0003's BRD `<500ms` metric is "input change -> UI update", which only
 * the frontend can measure end-to-end (T-046d); this header gives it the
 * "how much of that was backend recalc" breakdown, not a replacement for
 * that measurement.
 *
 * No-op (no headers set) when the request never actually triggered a
 * recalc — e.g. a validation error short-circuits before the service call,
 * or (for endpoints shared with non-recalc paths in the future) the
 * handler simply didn't recalc. `RecalcTelemetryContext.current()` returns
 * `undefined` in that case; deliberately not an error.
 */
@Injectable()
export class RecalcMetricsInterceptor implements NestInterceptor {
  constructor(private readonly telemetry: RecalcTelemetryContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse();

    return this.telemetry.runObservable(() =>
      next.handle().pipe(
        tap(() => {
          const snapshot = this.telemetry.current();
          if (snapshot && response && !response.headersSent) {
            response.setHeader('X-Recalc-Ms', String(snapshot.durationMs));
            response.setHeader('X-Recalc-Sku-Count', String(snapshot.skuCount));
          }
        }),
      ),
    );
  }
}

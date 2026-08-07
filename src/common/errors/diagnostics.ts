/**
 * T-098: what a logger must be handed so a redacted error stays diagnosable.
 *
 * WHY THIS EXISTS — a measurement, not a preference.
 *
 * T-098 moved the offending value out of `InvalidDecimalError.message` (the
 * message is persisted and returned; the value must not travel that way) and into
 * `error.context`. A comment then claimed the value was "still recoverable for
 * diagnosis through `context`, which the logger prints".
 *
 * That claim was false, and it was measured false in review:
 *
 *     logger.warn('budget failed', err)
 *     → WARN [Probe] budget failed
 *       WARN [Probe] InvalidDecimalError: Unreadable decimal column value: ...
 *
 * Nest's ConsoleLogger renders an Error argument with `Error.toString()` — the
 * name and message, and nothing else. No `context`, and no stack either. So the
 * value that used to leak into storage was not relocated, it was DROPPED: the
 * leak closed and the diagnosis closed with it.
 *
 * Measured on the same probe: a STRING second argument IS printed in full. That
 * is the seam this helper uses.
 *
 * ⚠️ The output of this function goes to LOGS ONLY. It deliberately contains the
 * raw value, which is exactly what must never reach a persisted field or an HTTP
 * response. Never put it in an exception message, a DTO, or a stored record.
 */
export function diagnosticsOf(err: unknown): string {
  const parts: string[] = [];

  // Any error carrying a `context` bag, not just InvalidDecimalError — the point
  // is the convention (redacted message + structured context), and a helper that
  // only understood one class would have to be edited for the second one.
  const context = (err as { context?: unknown })?.context;
  if (context !== undefined) {
    parts.push(`context=${safeStringify(context)}`);
  }

  if (err instanceof Error) {
    // The stack was never printed either. Adding it here rather than in a
    // separate change: both losses have the same cause and the same fix.
    parts.push(err.stack ?? `${err.name}: ${err.message}`);
  } else if (context === undefined) {
    parts.push(String(err));
  }

  return parts.join('\n');
}

/**
 * A diagnostic path must not be able to throw — an error while reporting an error
 * replaces the failure being investigated with a failure in the investigation.
 * Circular structures are the realistic case (TypeORM entities are full of them).
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

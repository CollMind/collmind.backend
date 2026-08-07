/**
 * T-098: which error messages may be shown to a user — declared, never inferred.
 *
 * WHY A MARKER AND NOT `instanceof HttpException`
 *
 * That was tried and measured wrong. The premise — "a Nest HTTP exception exists
 * to be shown to a caller, so its message was authored for display" — does not
 * survive contact with the reachable throwers on the on-invoice path:
 *
 *     customer.service.ts:119   `Customer with ID ${id} not found`   ← internal UUID
 *     sku.service.ts:81         `SKU with ID ${id} not found`        ← internal UUID
 *     budget.repository.ts:264  "…this lookup must specify an explicit spendType…"
 *                                                                   ← developer text
 *
 * All three are `NotFoundException`/`BadRequestException`, and none was written
 * for an uploader. The class says how the error will be transported, not who its
 * message was written for.
 *
 * It also fails in the other direction: an HttpException built from an object
 * body without a string `message` reports `.message` as the humanised class name.
 *
 *     new BadRequestException({ code: 'SPEND_TYPE_REQUIRED' }).message
 *       → "Bad Request Exception"
 *
 * which carries LESS than the redacted form (`İşlenemedi (BadRequestException)`).
 *
 * THE DIRECTION OF THE DEFAULT IS THE WHOLE POINT
 *
 * Redact by default, exempt by declaration. The inverse — pass by default, redact
 * the known-dangerous ones — is the shape this codebase has been bitten by nine
 * times: new code does not know about an old protection, so it silently lands on
 * the unsafe side. Here, a new error that forgets to declare itself is merely
 * terse. A new error that forgets to be redacted would be a leak.
 *
 * Nothing carries this marker today, so current behaviour is plain redaction —
 * and that is the correct starting point, not an oversight. The marker is added
 * when a message is genuinely written for the person reading it.
 */

export interface UserFacingError extends Error {
  readonly userFacing: true;
}

/**
 * Declare that this error's message was written to be shown to the end user.
 *
 * Use at the THROW site, where the author of the message is standing — that is the
 * only place where "who is this for?" can be answered. Marking at a catch site
 * would be guessing on the author's behalf.
 */
export function asUserFacing<E extends Error>(error: E): E & UserFacingError {
  return Object.assign(error, { userFacing: true as const });
}

export function isUserFacing(error: unknown): error is UserFacingError {
  return (
    error instanceof Error &&
    (error as { userFacing?: unknown }).userFacing === true
  );
}

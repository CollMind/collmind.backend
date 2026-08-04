/**
 * Numeric contract — single public surface (ADR 0007 F1).
 *
 * Consumers import from `src/common/numeric`, never from the individual files.
 * That keeps the branded-construction rule enforceable: the ESLint cast ban
 * excludes this directory only, so a factory that leaks out of here would move
 * the exemption with it.
 */
export * from './brands';
export * from './limits';
export * from './rounding';
export * from './money';
export * from './rate';
export * from './allocation';

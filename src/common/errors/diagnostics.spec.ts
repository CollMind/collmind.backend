import { Logger } from '@nestjs/common';
import { diagnosticsOf } from './diagnostics';
import { InvalidDecimalError } from '../../database/transformers/decimal.transformer';

describe('diagnosticsOf (T-098)', () => {
  const RAW = '1234.56-CORRUPT';

  // This is the test the whole helper exists for. The bug it guards is not "the
  // helper returns the wrong string" — it is "nobody hands the logger anything
  // that contains the value", which a unit test of the helper alone cannot see.
  // So this drives the REAL Nest Logger and reads what it actually wrote.
  describe('against the real Nest logger, because that is where the value was lost', () => {
    const capture = (log: (l: Logger) => void): string => {
      const written: string[] = [];
      const spy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
          written.push(String(chunk));
          return true;
        });
      try {
        log(new Logger('DiagnosticsSpec'));
      } finally {
        spy.mockRestore();
      }
      return written.join('');
    };

    // The measurement that made this necessary. If this ever goes green with a
    // bare error, Nest has changed and the helper may no longer be needed.
    it('CONFIRMS THE HAZARD: passing the bare error loses the value', () => {
      const out = capture((l) =>
        l.warn('failed', new InvalidDecimalError(RAW)),
      );

      expect(out).toContain('Unreadable decimal column value');
      expect(out).not.toContain(RAW);
    });

    // Two of the three call sites use warn, one uses error — and Nest parses them
    // through different paths (`printMessages` vs `printStackTrace`). Asserting
    // only warn would leave the error() site covered by nothing.
    it('CONFIRMS THE HAZARD on error() too, which one call site uses', () => {
      const written: string[] = [];
      const spy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown) => {
          written.push(String(chunk));
          return true;
        });
      try {
        new Logger('DiagnosticsSpec').error(
          'failed',
          new InvalidDecimalError(RAW),
        );
      } finally {
        spy.mockRestore();
      }

      expect(written.join('')).not.toContain(RAW);
    });

    it('passing diagnosticsOf(err) puts the value in the log', () => {
      const out = capture((l) =>
        l.warn('failed', diagnosticsOf(new InvalidDecimalError(RAW))),
      );

      expect(out).toContain(RAW);
    });
  });

  it('includes the stack, which the bare error also dropped', () => {
    expect(diagnosticsOf(new InvalidDecimalError(RAW))).toContain(
      'diagnostics.spec.ts',
    );
  });

  it('carries any error with a context bag, not only InvalidDecimalError', () => {
    const err = Object.assign(new Error('boom'), { context: { rowId: 'r-1' } });

    expect(diagnosticsOf(err)).toContain('rowId');
  });

  it('handles a plain non-error value without inventing a context', () => {
    expect(diagnosticsOf('just a string')).toBe('just a string');
  });

  // A diagnostic path that throws replaces the failure under investigation with a
  // failure in the investigation. TypeORM entities are circular, so this is the
  // realistic input, not a contrived one.
  it('does not throw on a circular context', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const err = Object.assign(new Error('boom'), { context: circular });

    expect(() => diagnosticsOf(err)).not.toThrow();
  });
});

import { NotFoundException } from '@nestjs/common';
import { asUserFacing, isUserFacing } from './user-facing';
import { InvalidDecimalError } from '../../database/transformers/decimal.transformer';

describe('user-facing marker (T-098)', () => {
  it('recognises an error that was declared user-facing', () => {
    expect(isUserFacing(asUserFacing(new Error('shown to the user')))).toBe(
      true,
    );
  });

  // The measurement that replaced `instanceof HttpException`: on the on-invoice
  // path these classes carry internal UUIDs and developer text, so the class is
  // not a declaration of intent.
  it('does NOT treat an HttpException as user-facing by itself', () => {
    expect(
      isUserFacing(new NotFoundException('Customer with ID <uuid> not found')),
    ).toBe(false);
  });

  it('does NOT treat an ordinary error as user-facing', () => {
    expect(isUserFacing(new InvalidDecimalError('NaN'))).toBe(false);
  });

  // The marker must not be forgeable by shape alone. A parsed JSON body or a
  // rejected non-Error could carry `userFacing: true` without anyone having
  // authored a message for a user.
  it('requires an actual Error, not merely the property', () => {
    expect(isUserFacing({ userFacing: true, message: 'not an error' })).toBe(
      false,
    );
  });

  it('survives the round trip without replacing the error', () => {
    const original = new NotFoundException('Envelope bulunamadı: MT / HAIR');
    const marked = asUserFacing(original);

    // Same object: marking must not lose the stack or the class, both of which
    // the log path still needs.
    expect(marked).toBe(original);
    expect(marked).toBeInstanceOf(NotFoundException);
    expect(marked.message).toBe('Envelope bulunamadı: MT / HAIR');
  });
});

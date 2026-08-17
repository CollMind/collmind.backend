import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ReversalGuard } from './reversal.guard';
import { UserRole } from '../../../../database/entities/user.entity';

function makeCtx(role: UserRole | null): ExecutionContext {
  const user = role ? { id: 'user-1', email: 'test@test.com', role } : null;
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('ReversalGuard', () => {
  let guard: ReversalGuard;

  beforeEach(() => {
    guard = new ReversalGuard();
  });

  it('allows ADMIN', () => {
    expect(guard.canActivate(makeCtx(UserRole.ADMIN))).toBe(true);
  });

  it('allows CATEGORY_MANAGER', () => {
    expect(guard.canActivate(makeCtx(UserRole.CATEGORY_MANAGER))).toBe(true);
  });

  it('denies PLANNER', () => {
    expect(() => guard.canActivate(makeCtx(UserRole.PLANNER))).toThrow(
      ForbiddenException,
    );
  });

  it('denies deprecated role label APPROVER (B dalgası/R2a/S6 — replaces stale FINANCE case)', () => {
    expect(() =>
      guard.canActivate(makeCtx('APPROVER' as unknown as UserRole)),
    ).toThrow(ForbiddenException);
  });

  it('denies FINANCE_MANAGER', () => {
    expect(() => guard.canActivate(makeCtx(UserRole.FINANCE))).toThrow(
      ForbiddenException,
    );
  });

  it('denies READONLY', () => {
    expect(() => guard.canActivate(makeCtx(UserRole.READONLY))).toThrow(
      ForbiddenException,
    );
  });

  it('denies unauthenticated (no user)', () => {
    expect(() => guard.canActivate(makeCtx(null))).toThrow(ForbiddenException);
  });

  it('rejection carries canonical code FORBIDDEN_MANAGER_OR_ADMIN_ONLY', () => {
    try {
      guard.canActivate(makeCtx(UserRole.PLANNER));
      fail('Expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as any;
      expect(response.code).toBe('FORBIDDEN_MANAGER_OR_ADMIN_ONLY');
    }
  });
});

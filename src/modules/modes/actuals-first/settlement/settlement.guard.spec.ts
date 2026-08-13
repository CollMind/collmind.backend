import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SettlementGuard } from './settlement.guard';
import { UserRole } from '../../../../database/entities/user.entity';

function makeCtx(role: UserRole | null): ExecutionContext {
  const user = role ? { id: 'user-1', email: 'test@test.com', role } : null;
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('SettlementGuard', () => {
  let guard: SettlementGuard;

  beforeEach(() => {
    guard = new SettlementGuard();
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

  // ⚠️ B dalgası / R2a (code-reviewer S6, 2026-08-13): eski "denies FINANCE (deprecated)"
  // testi KALDIRILDI — 'FINANCE' artık UserRole.FINANCE_MANAGER'ın TEL değeri (⛔ P0
  // düzeltmesi), yani bu test aşağıdaki FINANCE_MANAGER testiyle birebir aynı girdiyi
  // sınıyordu (§2.7 #6 — ayırt etme gücü sıfır). Gerçekten silinmiş bir etiket için
  // aşağıdaki MANAGER testine bkz.
  it('denies FINANCE_MANAGER', () => {
    expect(() => guard.canActivate(makeCtx(UserRole.FINANCE_MANAGER))).toThrow(
      ForbiddenException,
    );
  });

  it('denies READONLY', () => {
    expect(() => guard.canActivate(makeCtx(UserRole.READONLY))).toThrow(
      ForbiddenException,
    );
  });

  it('denies deprecated role label MANAGER (removed from enum by B dalgası/R2a)', () => {
    expect(() =>
      guard.canActivate(makeCtx('MANAGER' as unknown as UserRole)),
    ).toThrow(ForbiddenException);
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

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '../../../../database/entities/user.entity';

/**
 * SettlementGuard
 *
 * Yalnızca ADMIN veya CATEGORY_MANAGER rolüne sahip kullanıcıların
 * settlement close endpoint'ine erişmesine izin verir.
 *
 * Redd: HTTP 403, kanonik kod FORBIDDEN_MANAGER_OR_ADMIN_ONLY
 *
 * Pattern: reversal.guard.ts ile simetrik.
 */
const SETTLEMENT_ALLOWED_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.CATEGORY_MANAGER,
];

@Injectable()
export class SettlementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { role: UserRole } }>();

    if (!user) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_MANAGER_OR_ADMIN_ONLY',
        message: 'Only ADMIN or CATEGORY_MANAGER can close settlements',
      });
    }

    const hasRole = SETTLEMENT_ALLOWED_ROLES.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_MANAGER_OR_ADMIN_ONLY',
        message: 'Only ADMIN or CATEGORY_MANAGER can close settlements',
      });
    }

    return true;
  }
}

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '../../../../database/entities/user.entity';

/**
 * ReversalGuard
 *
 * Yalnızca ADMIN veya CATEGORY_MANAGER rolüne sahip kullanıcıların
 * reversal endpoint'lerine erişmesine izin verir.
 *
 * Redd: HTTP 403, kanonik kod FORBIDDEN_MANAGER_OR_ADMIN_ONLY
 *
 * Semantic referans: TTM reversal-guard.ts → assertReversalRole()
 */
const REVERSAL_ALLOWED_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.CATEGORY_MANAGER,
];

@Injectable()
export class ReversalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { role: UserRole } }>();

    if (!user) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_MANAGER_OR_ADMIN_ONLY',
        message: 'Only ADMIN or CATEGORY_MANAGER can perform reversals',
      });
    }

    const hasRole = REVERSAL_ALLOWED_ROLES.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_MANAGER_OR_ADMIN_ONLY',
        message: 'Only ADMIN or CATEGORY_MANAGER can perform reversals',
      });
    }

    return true;
  }
}

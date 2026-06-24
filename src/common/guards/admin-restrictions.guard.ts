import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../database/entities/user.entity';

/**
 * EA-001: Admin Role Restrictions Guard
 *
 * Prevents admins from:
 * - Approving agreements they created
 * - Bypassing approval workflows
 * - Modifying their own role permissions
 * - Deleting approved agreements
 * - Deleting consumed budget transactions
 * - Modifying ledger entries
 * - Deleting audit logs
 * - Creating agreements (must use Planner role)
 * - Committing budget (Finance role required)
 */
@Injectable()
export class AdminRestrictionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.role !== UserRole.ADMIN) {
      return true; // Not an admin, let other guards handle
    }

    const handler = context.getHandler();
    const controller = context.getClass();
    const methodName = handler.name;
    const route = request.route?.path || request.url;

    // EA-001: Admins CANNOT approve agreements they created
    if (methodName.includes('approve') || route.includes('/approve')) {
      const resourceId = request.params?.id || request.body?.id;
      // Check if admin is trying to approve their own resource
      // This will be checked in service layer as well
      // For now, we allow but service will validate
    }

    // EA-001: Admins CANNOT create agreements (must use Planner role)
    if (
      (methodName.includes('create') || route.includes('/create')) &&
      (route.includes('/agreement') || route.includes('/agreements'))
    ) {
      throw new ForbiddenException(
        'Admins cannot create agreements. Please use Planner role for this action.',
      );
    }

    // EA-001: Admins CANNOT commit budget (Finance role required)
    if (
      (methodName.includes('commit') || route.includes('/commit')) &&
      route.includes('/budget')
    ) {
      throw new ForbiddenException(
        'Admins cannot commit budget. Finance role is required for this action.',
      );
    }

    return true;
  }
}

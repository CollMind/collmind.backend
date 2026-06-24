import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { TenantRepository } from '../../modules/tenant/tenant.repository';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private tenantRepository: TenantRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId || request.headers['x-tenant-id'];

    if (!tenantId) {
      throw new NotFoundException('Tenant not found');
    }

    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId, status: 'ACTIVE' },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found or inactive');
    }

    request.tenantId = tenantId;
    request.tenant = tenant;

    return true;
  }
}

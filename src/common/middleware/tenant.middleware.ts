import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantRepository } from '../../modules/tenant/tenant.repository';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private tenantRepository: TenantRepository) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Try to get tenant from subdomain or header
    const host = req.get('host') || '';
    const subdomain = host.split('.')[0];
    const tenantId = req.headers['x-tenant-id'] as string;

    let tenant;

    if (tenantId) {
      tenant = await this.tenantRepository.findOne({
        where: { id: tenantId, status: 'ACTIVE' },
      });
    } else if (subdomain && subdomain !== 'localhost' && subdomain !== 'www') {
      tenant = await this.tenantRepository.findOne({
        where: { domain: `${subdomain}.${host.split('.').slice(1).join('.')}` },
      });
    }

    if (tenant) {
      (req as any).tenantId = tenant.id;
      (req as any).tenant = tenant;
    }

    next();
  }
}

import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TenantRepository } from './tenant.repository';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';

@Injectable()
export class TenantService {
  constructor(private readonly tenantRepository: TenantRepository) {}

  async create(createTenantDto: CreateTenantDto): Promise<Tenant> {
    // Check if tenant with same name exists
    const existingName = await this.tenantRepository.findByName(
      createTenantDto.name,
    );
    if (existingName) {
      throw new ConflictException('Tenant with this name already exists');
    }

    // Check if domain is already taken
    if (createTenantDto.domain) {
      const existingDomain = await this.tenantRepository.findByDomain(
        createTenantDto.domain,
      );
      if (existingDomain) {
        throw new ConflictException('This domain is already taken');
      }
    }

    // Convert date strings to Date objects
    const tenantData: any = { ...createTenantDto };
    if (createTenantDto.subscriptionStartDate) {
      tenantData.subscriptionStartDate = new Date(
        createTenantDto.subscriptionStartDate,
      );
    }
    if (createTenantDto.subscriptionEndDate) {
      tenantData.subscriptionEndDate = new Date(
        createTenantDto.subscriptionEndDate,
      );
    }

    const tenant = this.tenantRepository.create(tenantData);
    return this.tenantRepository.save(tenant);
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * [[T-258]] ⛔ P0 — `relations: ['users']` KALDIRILDI (2026-08-21).
   *
   * Ölçüldü: bu metodun ürünündeki tek çağıranları `TenantController` (GET
   * `/:id`) ve bu servisin kendi `update`/`remove`/`activate`/`suspend`
   * metotlarıydı (`this.findOne(id)`, dört yer) — ve hiçbiri döndürülen
   * `tenant.users` alanını OKUMUYORDU (`grep -rn 'tenant\.users' src/` → 0
   * kullanım dışında `tenant.repository.ts`'in ayrı bir raw query'si).
   * Yani ilişki YÜKLENİYOR ama hiçbir yerde KULLANILMIYORDU — controller
   * entity'yi ham döndürdüğü için (`ClassSerializerInterceptor` yok,
   * `TenantResponseDto` hiç uygulanmamış) her `User` kolonu, `passwordHash`
   * ve iki token dahil, HTTP yanıtına sızıyordu. Kanıt (READONLY token,
   * en düşük yetki): `GET /tenants/:id` → 200, `users`: 9 kayıt × 31 alan,
   * `passwordHash`/`refreshToken`/`passwordResetToken` hepsi doluydu.
   *
   * Tek tüketici olduğu için kök düzeltme: ilişkiyi HİÇ YÜKLEME. `users`
   * alanını DTO ile filtrelemek (yükleyip sonra atmak) burada gereksiz bir
   * ikinci katman olurdu — İlke 1: uç bu veriyi zaten hiç İSTEMEMELİ.
   *
   * ⛔ ÜÇÜNCÜ KUSUR — BU DÜZELTMENİN KAPSAMI DIŞINDA: bu sorgu `id` dışında
   * hiçbir tenant-scope predicate'i taşımıyor — bir `ADMIN` başka bir
   * tenant'ın kaydını `id` ile isteyebilir. Bugün gösterilemiyor (dev DB'de
   * tek tenant var), ama `@Roles(ADMIN)` bunu KAPATMAZ. Adresi `ADIM 5`
   * (RLS) — bkz. `docs/` FAZ1_PLAN §7. Kasten dokunulmadı.
   */
  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }

    return tenant;
  }

  async update(id: string, updateTenantDto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findOne(id);

    // Check name uniqueness if changing
    if (updateTenantDto.name && updateTenantDto.name !== tenant.name) {
      const existingName = await this.tenantRepository.findByName(
        updateTenantDto.name,
      );
      if (existingName) {
        throw new ConflictException('Tenant with this name already exists');
      }
    }

    // Check domain uniqueness if changing
    if (updateTenantDto.domain && updateTenantDto.domain !== tenant.domain) {
      const existingDomain = await this.tenantRepository.findByDomain(
        updateTenantDto.domain,
      );
      if (existingDomain) {
        throw new ConflictException('This domain is already taken');
      }
    }

    Object.assign(tenant, updateTenantDto);
    return this.tenantRepository.save(tenant);
  }

  async remove(id: string): Promise<void> {
    const tenant = await this.findOne(id);
    await this.tenantRepository.softRemove(tenant);
  }

  async activate(id: string): Promise<Tenant> {
    const tenant = await this.findOne(id);
    tenant.status = TenantStatus.ACTIVE;
    return this.tenantRepository.save(tenant);
  }

  async suspend(id: string): Promise<Tenant> {
    const tenant = await this.findOne(id);
    tenant.status = TenantStatus.SUSPENDED;
    return this.tenantRepository.save(tenant);
  }

  async getStats(id: string): Promise<any> {
    return this.tenantRepository.getTenantStats(id);
  }
}

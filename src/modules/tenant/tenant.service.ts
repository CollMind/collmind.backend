import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TenantRepository } from './tenant.repository';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant, TenantStatus } from '../../database/entities/tenant.entity';

// ⛔ `T-307-m2` / `Z46 §1` (2026-08-27) — `create()`/`findAll()`/`remove()`
// buradan KALDIRILDI (bkz. `tenant.controller.ts` başlık yorumu — aynı
// gerekçe, tek yazım burada tekrar edilmiyor). Tenant yaşam-döngüsünün
// bugünkü meşru yolu SCRIPT + SEED (`src/database/seeds/tenant.seed.ts`),
// sahibi OPERATÖR.
//
// `Z45 §2`'nin daha önce buraya yazdığı `findAll` kısıtlama yorumu
// (çağıranın kendi tenant'ını 1 elemanlı dizi olarak döndürme) bu hükümle
// KÖKTEN ortadan kalktı — uç artık hiç YOK, kısıtlanacak bir şey kalmadı.
@Injectable()
export class TenantService {
  constructor(private readonly tenantRepository: TenantRepository) {}

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
   * ⛔ ÜÇÜNCÜ KUSUR — `T-307` / `Z45 §2` İLE KAPANDI: bu sorgu artık `id`
   * dışında bir predicate TAŞIMIYOR OLSA BİLE (`tenants` tablosu
   * `tenant_id` sütunu YOK, RLS ile çözülemez) çağıranın kimliği
   * `assertSelfTenant` ile KONTROL EDİLİYOR — bir `ADMIN` `id === kendi
   * tenant'ı` DEĞİLSE 403 alır, satır hiç DÖNMEZ. Önceki hâlde bu kontrol
   * yoktu (dev DB'de tek tenant olduğu için gösterilemiyordu); pin:
   * `test/tenant-cross-tenant-isolation.e2e-spec.ts` (iki-tenant fixture).
   */
  private assertSelfTenant(id: string, callerTenantId: string): void {
    if (id !== callerTenantId) {
      throw new ForbiddenException(
        'Bu kiracıya erişim yetkiniz yok — yalnız kendi kiracınızı görebilir/değiştirebilirsiniz.',
      );
    }
  }

  async findOne(id: string, callerTenantId: string): Promise<Tenant> {
    this.assertSelfTenant(id, callerTenantId);

    const tenant = await this.tenantRepository.findOne({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }

    return tenant;
  }

  async update(
    id: string,
    updateTenantDto: UpdateTenantDto,
    callerTenantId: string,
  ): Promise<Tenant> {
    const tenant = await this.findOne(id, callerTenantId);

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

  async activate(id: string, callerTenantId: string): Promise<Tenant> {
    const tenant = await this.findOne(id, callerTenantId);
    tenant.status = TenantStatus.ACTIVE;
    return this.tenantRepository.save(tenant);
  }

  async suspend(id: string, callerTenantId: string): Promise<Tenant> {
    const tenant = await this.findOne(id, callerTenantId);
    tenant.status = TenantStatus.SUSPENDED;
    return this.tenantRepository.save(tenant);
  }

  async getStats(id: string, callerTenantId: string): Promise<any> {
    this.assertSelfTenant(id, callerTenantId);
    return this.tenantRepository.getTenantStats(id);
  }
}

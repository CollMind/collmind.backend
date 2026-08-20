import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { UserRepository } from './user.repository';
import { CreateUserDto, UserScopePairDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  User,
  UserStatus,
  UserRole,
} from '../../database/entities/user.entity';
import { Plan, PlanStatus } from '../../database/entities/plan.entity';
import {
  Agreement,
  AgreementStatus,
} from '../../database/entities/agreement.entity';
import {
  BudgetEnvelope,
  BudgetEnvelopeStatus,
} from '../../database/entities/budget-envelope.entity';
import {
  UserScope,
  WILDCARD_SCOPE_ROLES,
  SCOPE_REQUIRED_ROLES,
  ScopeAuditActionType,
  SCOPE_AUDIT_ENTITY_TYPE,
  sortScopeAuditPairsCanonically,
} from '../../database/entities/user-scope.entity';
import { Cpl } from '../../database/entities/cpl.entity';
import { Category } from '../../database/entities/category.entity';
import { AdminAuditService } from '../../common/services/admin-audit.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @InjectRepository(Agreement)
    private readonly agreementRepository: Repository<Agreement>,
    @InjectRepository(BudgetEnvelope)
    private readonly budgetEnvelopeRepository: Repository<BudgetEnvelope>,
    @InjectRepository(Cpl)
    private readonly cplRepository: Repository<Cpl>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    // T-241: user + user_scopes tek transaction'a yazılır (aşağıdaki create()).
    private readonly dataSource: DataSource,
    // T-244: kapsam verme SCOPE_UPDATE olarak aynı transaction'da loglanır.
    private readonly adminAuditService: AdminAuditService,
  ) {}

  /**
   * T-241 — `POST /users` rol + kapsam BİRLİKTE alır; kapsamsız kullanıcı
   * YARATILMAZ (`.claude/backlog/tasks/T-241.md` karar (b)).
   *
   * Atomiklik: kullanıcı satırı, kapsam satır(lar)ı VE denetim kaydı (T-244)
   * TEK transaction'da yazılır — kısmi başarı (kullanıcı var, kapsam yok,
   * denetim kaydı yok) oluşamaz. Bu, R-2 fail-closed'ın (AccessScopeService)
   * tam olarak kaçınmaya çalıştığı "kullanıcı var ama scope satırı yok"
   * deliğini yaratma anında kapatır.
   *
   * K-2.6.10 sınırı: bu metod bir kapsam YAZAR, bir yetki HESAPLAMAZ.
   * AccessScopeService#buildScope'un semantiğini (R-1 pair, R-2 fail-closed,
   * NULL="hepsi") yeniden uygulamaz — yalnız hangi (cplId, categoryId)
   * çiftlerinin satır olarak var olacağına karar verir; o satırları nasıl
   * yorumlayacağı (UNRESTRICTED/SCOPED, CM normalizasyonu) okuma zamanında
   * yine AccessScopeService'tedir.
   *
   * T-244 (`A1` + `A7`, birlikte):
   *   `A1` — `createdBy` daha önce `savedUser.id` yazıyordu, yani kapsam
   *   satırının "bu erişimi kim verdi" alanı yeni kullanıcının KENDİSİNİ
   *   gösteriyordu. Şimdi `actorId` — çağıran ADMIN'in kimliği — yazılıyor.
   *   `A7` — kapsam verme daha önce hiçbir yere loglanmıyordu
   *   (`grep -rni 'audit' src/modules/user/` → 0). Şimdi `AdminAuditService`
   *   üzerinden `SCOPE_UPDATE` olarak, `docs/process/DENETIM_SOZLUGU.md`
   *   `Madde 1`'in biçimiyle yazılıyor — yaratma anı eski küme `∅`
   *   (`ScopeAuditActionType`, `Z16`: üçüncü olay türü açılmadı).
   *   ⚠️ Kapsam DAR: yalnız kapsam VERME loglanır, kullanıcı YARATMA olayının
   *   kendisi değil (`Z16`, sözlük `Madde 2` — ⛔ hâlâ açık).
   */
  async create(
    tenantId: string,
    createUserDto: CreateUserDto,
    actorId: string,
    actorEmail: string,
    ipAddress?: string,
  ): Promise<User> {
    const existing = await this.userRepository.findByEmail(
      tenantId,
      createUserDto.email,
    );
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const scopeRows = await this.resolveScopeRowsToWrite(
      tenantId,
      createUserDto,
    );

    const passwordHash = await bcrypt.hash(createUserDto.password, 10);
    // `scope` bir DTO alanı ama User entity'sinde kolon değil — ...spread ile
    // User.create()'e sızmasın. (no-unused-vars: rest destructuring'de
    // atılan alanı adlandırmadan bırakmanın TS/ESLint yolu yok, bu yüzden
    // `Omit` tipli bir kopya + `delete` kullanıldı.)
    const userFields: Omit<CreateUserDto, 'scope'> = { ...createUserDto };
    delete (userFields as Partial<CreateUserDto>).scope;

    const { savedUser, auditLog } = await this.dataSource.transaction(
      async (manager) => {
        const userRepo = manager.getRepository(User);
        const userScopeRepo = manager.getRepository(UserScope);

        const user = userRepo.create({
          ...userFields,
          tenantId,
          passwordHash,
        });
        const savedUser = await userRepo.save(user);

        const scopeEntities = scopeRows.map((row) =>
          userScopeRepo.create({
            tenantId,
            userId: savedUser.id,
            cplId: row.cplId ?? undefined,
            categoryId: row.categoryId ?? undefined,
            isActive: true,
            // A1 FIX: gerçek aktör (kapsamı VEREN admin), yeni kullanıcının
            // kendisi DEĞİL.
            createdBy: actorId,
          }),
        );
        await userScopeRepo.save(scopeEntities);

        // A7 FIX — DENETIM_SOZLUGU.md Madde 1: yaratma anında verilen ilk
        // kapsam da SCOPE_UPDATE'tir, eski küme HER ZAMAN ∅ (Z16 — üçüncü
        // olay türü yok). T-014 kalıbı: options.manager ile aynı
        // transaction'ın içinde yazılır — rollback olursa denetim kaydı da
        // hiç yazılmamış olur.
        const auditLog = await this.adminAuditService.logAdminAction(
          tenantId,
          actorId,
          actorEmail,
          ScopeAuditActionType.SCOPE_UPDATE,
          SCOPE_AUDIT_ENTITY_TYPE,
          savedUser.id,
          ipAddress,
          'SUCCESS',
          { scope: [] },
          {
            // m3: kanonik sıralı — T-242a'nın before/after karşılaştırması
            // sıra farkını "değişti" sanmasın (bkz. sortScopeAuditPairsCanonically
            // JSDoc'u, user-scope.entity.ts).
            scope: sortScopeAuditPairsCanonically(
              scopeEntities.map((row) => ({
                cplId: row.cplId ?? null,
                categoryId: row.categoryId ?? null,
              })),
            ),
          },
          undefined, // gerekçe: Madde 1'de UPDATE'te opsiyonel (REVOKE_ALL'da zorunlu)
          { manager },
        );

        return { savedUser, auditLog };
      },
    );

    // T-014 kalıbı: high-risk alarm yalnız commit'ten SONRA tetiklenir —
    // rollback olan bir işlem için alarm gitmemesi gerekir. Bugün
    // SCOPE_UPDATE `AdminAuditService.isHighRiskAction`'ın listesinde YOK
    // — hem `actionType` ('SCOPE_UPDATE' !== 'UPDATE'/'DELETE') hem
    // `entityType` ('user', Z17/m1) ölçüldü, listedeki `{UPDATE,user}`/
    // `{DELETE,user}` satırlarıyla ÇAKIŞMIYOR (admin-audit.service.ts:
    // 171-196, tam eşleşme — `.some(r => r.action === actionType &&
    // r.entity === entityType)`). Yani bu çağrı bugün no-op; altı diğer
    // transaction-aware çağrı yeri (agreement.service.ts × 4, reversal × 1,
    // settlement-close × 1 — `sales-actuals.service.ts` BUNLARDAN BİRİ
    // DEĞİL: orada `logAdminAction` `{manager}` ile 2 kez çağrılıyor ama
    // `flushPendingAlert` HİÇ çağrılmıyor, ölçüldü; ayrı bir kusur, bkz.
    // ilgili task) aynı deseni koşulsuz izliyor — liste ileride
    // SCOPE_UPDATE'i kapsarsa davranış buradan gelir.
    //
    // J2 (T-244 code-review, `Z17`): ayrı try/catch — repodaki 6/6 emsel
    // (agreement/reversal/settlement-close) bunu sarıyor, en yakın emsal
    // `reversal.service.ts:199-203`'ün gerekçesiyle BİREBİR aynı: alarm
    // gönderimi (kendi DB yazması içerir) başarısız olursa kullanıcı+kapsam
    // zaten commit'li bir işlemi 500'e ÇEVİRMEMELİ — admin "başarısız oldu"
    // sanıp tekrar dener ve email ÇAKIŞMASI yüzünden 409 alır (ConflictException,
    // bu metodun en üstündeki `findByEmail` kontrolü). Alarm kaybı, başarılı
    // bir işlemi başarısız göstermekten kat kat iyidir; hata burada yutulur
    // ve yalnızca ERROR seviyesinde loglanır.
    try {
      await this.adminAuditService.flushPendingAlert(auditLog);
    } catch (alertErr) {
      this.logger.error(
        `HIGH-RISK ALERT FAILED — user ${savedUser.id} scope granted successfully; alert not delivered: ${
          alertErr instanceof Error ? alertErr.message : 'Unknown error'
        }`,
      );
    }

    return savedUser;
  }

  /**
   * T-241 — hangi kapsam satırlarının yazılacağına karar verir. Bir yetki
   * HESAPLAMAZ (K-2.6.10): yalnız `WILDCARD_SCOPE_ROLES` ↔ `SCOPE_REQUIRED_ROLES`
   * ayrımına göre satır listesi üretir/doğrular.
   *
   * `WILDCARD_SCOPE_ROLES` (ADMIN/FINANCE/READONLY): çağıran ne gönderirse
   * göndersin, tek joker satır {cplId:null, categoryId:null} yazılır — bu
   * seed'in (user-scope.seed.ts) davranışıyla birebir aynı.
   *
   * `SCOPE_REQUIRED_ROLES` (PLANNER/CATEGORY_MANAGER): `dto.scope` boşsa
   * (DTO düzeyinde `ValidateIf`+`ArrayMinSize(1)` zaten 400 üretir — burası
   * ikinci bir savunma hattı, DTO doğrulaması atlanarak çağrılan bir
   * senaryoya karşı) `BadRequestException`. Referans verilen her `cplId`/
   * `categoryId` bu TENANT'a ait olmalı — aksi hâlde cross-tenant scope
   * sızıntısı sessizce oluşur (FK bunu yakalamaz: FK yalnız satırın BİR
   * yerde var olduğunu doğrular, bu tenant'ta olduğunu değil).
   *
   * Diğer roller (bugün yok, ADIM 3'ten sonra olabilir): ne wildcard ne
   * scope-required listesindeyse açık hata — sessiz varsayılan YOK (§2.5).
   */
  private async resolveScopeRowsToWrite(
    tenantId: string,
    dto: CreateUserDto,
  ): Promise<UserScopePairDto[]> {
    if (WILDCARD_SCOPE_ROLES.has(dto.role)) {
      // ⛔ A3 (ikinci tur code-review) — `B1`'in TERS YÜZÜ.
      //
      // `B1` SCOPE_REQUIRED rollerde joker göndermeyi yasakladı. Bu dal ise
      // UNRESTRICTED rollerde gönderilen `scope`'u SESSİZCE ATIYORDU: çağıran
      // `{role:'FINANCE', scope:[{cplId:X}]}` gönderip **201** alıyor,
      // KISITLI bir kullanıcı yarattığını sanıyor — gerçekte JOKER yaratmış
      // oluyordu. Ve DTO da yakalamıyor: `@ValidateIf` yalnız
      // SCOPE_REQUIRED_ROLES için koşuyor, `forbidNonWhitelisted` ise
      // `scope`'u beyaz listede gördüğü için geçiriyor.
      //
      // §2.5: sessiz atlama YOK. Aynı asimetrinin iki yüzü, aynı ilke —
      // "bir sözleşme yalanı" (code-reviewer).
      if (dto.scope !== undefined) {
        throw new BadRequestException(
          `role=${dto.role} için 'scope' alanı VERİLEMEZ — bu rol JOKER ` +
            'kapsam alır (tüm CPL + tüm kategori) ve gönderilen kapsam ' +
            'uygulanmaz. Sessizce yok saymak yerine açık hata: kısıtlı bir ' +
            'kapsam isteniyorsa PLANNER ya da CATEGORY_MANAGER rolü kullanın.',
        );
      }
      return [{ cplId: null, categoryId: null }];
    }

    if (SCOPE_REQUIRED_ROLES.has(dto.role)) {
      if (!dto.scope || dto.scope.length === 0) {
        throw new BadRequestException(
          `role=${dto.role} için 'scope' alanı zorunludur (en az 1 (cplId, categoryId) ` +
            'çifti) — kapsamsız kullanıcı yaratılamaz (T-241).',
        );
      }

      // ⛔ B1 (code-review blocker, 2026-08-19) — JOKER YASAĞI
      //
      // Her iki boyutu da boş olan bir çift (`{}` ya da AÇIKÇA
      // `{cplId:null, categoryId:null}`) `{null,null}` satırına dönüşür, ve
      // AccessScopeService onu `hasUnrestrictedRow` ile UNRESTRICTED'a
      // çevirir (access-scope.service.ts:205-210, ölçüldü) — yani kapsamı
      // ZORUNLU olan bir rol SESSİZCE her şeyi görür. Yönü FAIL-OPEN, ve
      // T-241'in tüm gerekçesinin tersi.
      //
      // ⚠️ Ve CATEGORY_MANAGER için bu BAYRAKTAN BAĞIMSIZ: bayrak yalnız
      // PLANNER'ı kapsıyor (access-scope.service.ts:175-177), CM enforcement
      // T-028b'den beri açık.
      //
      // Ürün sahibi kararı (2026-08-19): bu roller joker ALAMAZ. Joker
      // isteniyorsa rol değiştirilir. İhmal (`[{}]`) hiçbir zaman "hepsi"
      // anlamına gelemez — DTO doğrulaması onu geçiriyor (ölçüldü:
      // class-validator `@ValidateIf` + `@IsOptional` ikilisi hem null hem
      // undefined için tüm kuralları atlıyor), bu yüzden kapı BURADA.
      const emptyPairIndex = dto.scope.findIndex(
        (pair) =>
          (pair.cplId ?? null) === null && (pair.categoryId ?? null) === null,
      );
      if (emptyPairIndex !== -1) {
        throw new BadRequestException(
          `role=${dto.role} için 'scope' çiftlerinin en az bir boyutu dolu ` +
            `olmalıdır — ${emptyPairIndex}. çiftin hem 'cplId' hem ` +
            `'categoryId' değeri boş. Boş bir çift JOKER kapsam (tüm CPL + ` +
            'tüm kategori) anlamına gelir ve bu rol için verilemez (T-241, ' +
            'ürün sahibi kararı 2026-08-19). Joker kapsam gereken bir ' +
            'kullanıcı ADMIN/FINANCE/READONLY rollerinden biriyle yaratılır.',
        );
      }

      // ⛔ R1 + A5 (ikinci tur code-review blocker, 2026-08-20) — CM'de DOLU
      // `cplId` REDDEDİLİR.
      //
      // B1 kapısı yalnız İKİ boyutu da boş çifti yakalıyordu. CATEGORY_MANAGER
      // için `{cplId: <geçerli>, categoryId: null}` o kapıdan GEÇİYOR ve AYNI
      // sonucu üretiyor — çünkü okuma yolu CM'de `cplId`'yi ATIYOR:
      //
      //   access-scope.service.ts:213  CM dalı → {cplId: null, categoryId: r.categoryId ?? null}
      //                                        → pairs = [{null, null}]
      //   access-scope.service.ts:250  cplOk = (pair.cplId === null) → true
      //   access-scope.service.ts:251  categoryOk = (null) → true    ⇒ HER ŞEY
      //
      // Yani joker YAZIMI farklı bir yoldan geri geliyordu, ve CM enforcement
      // BAYRAKTAN BAĞIMSIZ olduğu için CANLIYDI.
      //
      // Ürün sahibi kararı (2026-08-20): REDDEDİLİR, normalize EDİLMEZ.
      // Gerekçe: normalize etmek kullanıcının girdiği bir değeri SESSİZCE yok
      // saymaktır (§2.5), ve T-214'te aynı karar verildi ("STANDARD + eşik
      // gönderilirse reddedilsin"). Daha derini: CM için `cplId` ANLAMSIZ
      // değil — okuma yolu onu atıyor, yani ANLAMI BELİRSİZ. 400 o belirsizliği
      // kullanıcıya taşır, bir varsayımla kapatmaz.
      if (dto.role === UserRole.CATEGORY_MANAGER) {
        const cplPairIndex = dto.scope.findIndex(
          (pair) => (pair.cplId ?? null) !== null,
        );
        if (cplPairIndex !== -1) {
          throw new BadRequestException(
            `role=${UserRole.CATEGORY_MANAGER} için 'scope' çiftleri 'cplId' ` +
              `TAŞIYAMAZ — ${cplPairIndex}. çift dolu bir 'cplId' içeriyor. ` +
              'Kategori müdürünün kapsamı yalnız KATEGORİ boyutundadır ' +
              '(kanaldan bağımsız kategori sahibi); verilen cplId karar ' +
              'anında yok sayılır ve yanıltıcı olur. Yalnız categoryId verin.',
          );
        }
      }

      const cplIds = [
        ...new Set(
          dto.scope
            .map((pair) => pair.cplId)
            .filter((id): id is string => id !== null && id !== undefined),
        ),
      ];
      const categoryIds = [
        ...new Set(
          dto.scope
            .map((pair) => pair.categoryId)
            .filter((id): id is string => id !== null && id !== undefined),
        ),
      ];

      await this.assertCplIdsBelongToTenant(tenantId, cplIds);
      await this.assertCategoryIdsBelongToTenant(tenantId, categoryIds);

      return dto.scope.map((pair) => ({
        cplId: pair.cplId ?? null,
        categoryId: pair.categoryId ?? null,
      }));
    }

    // §2.5 sessiz sıfır yasağı: role, WILDCARD_SCOPE_ROLES ile
    // SCOPE_REQUIRED_ROLES'ün tümleyeni olmalıydı (user-scope.entity.ts'in
    // yorumu). İkisinde de yoksa bu bir kod tutarsızlığıdır — sessizce bir
    // tarafa düşürülmez, açık hata.
    throw new Error(
      `UserService.create: role=${dto.role} ne WILDCARD_SCOPE_ROLES'ta ne ` +
        "SCOPE_REQUIRED_ROLES'ta — user-scope.entity.ts'teki iki sabit " +
        'güncel UserRole kümesini kapsamıyor olabilir.',
    );
  }

  /**
   * Multi-tenant izolasyon: FK, bir cplId'nin BİR YERDE var olduğunu
   * doğrular, bu TENANT'a ait olduğunu değil. Bu kontrol olmadan bir admin
   * (kasıtsız/kasıtlı) başka bir tenant'ın CPL'ini scope'a yazabilir —
   * sessiz cross-tenant sızıntı.
   */
  private async assertCplIdsBelongToTenant(
    tenantId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const found = await this.cplRepository.find({
      where: { tenantId, id: In(ids) },
      select: { id: true },
    });
    const foundIds = new Set(found.map((row) => row.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `scope içindeki cplId değer(ler)i bu tenant'ta bulunamadı: ${missing.join(', ')}`,
      );
    }
  }

  /** Bkz. assertCplIdsBelongToTenant — aynı gerekçe, categoryId için. */
  private async assertCategoryIdsBelongToTenant(
    tenantId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const found = await this.categoryRepository.find({
      where: { tenantId, id: In(ids) },
      select: { id: true },
    });
    const foundIds = new Set(found.map((row) => row.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `scope içindeki categoryId değer(ler)i bu tenant'ta bulunamadı: ${missing.join(', ')}`,
      );
    }
  }

  async login(tenantId: string, loginDto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.userRepository.findByEmail(
      tenantId,
      loginDto.email,
    );

    if (!user || !(await user.validatePassword(loginDto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.LOCKED) {
      throw new UnauthorizedException('Account is locked');
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Generate tokens
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

    // Update user
    user.lastLoginAt = new Date();
    user.loginCount++;
    user.failedLoginAttempts = 0;
    user.refreshToken = refreshToken;
    await this.userRepository.save(user);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  async findAll(tenantId: string): Promise<User[]> {
    return this.userRepository.findAllByTenant(tenantId);
  }

  async findOne(tenantId: string, id: string): Promise<User> {
    const user = await this.userRepository.findById(tenantId, id);

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(tenantId: string, email: string): Promise<User> {
    const user = await this.userRepository.findByEmail(tenantId, email);

    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }

    return user;
  }

  async findByEmailWithoutTenant(email: string): Promise<User | null> {
    return this.userRepository.findByEmailWithoutTenant(email);
  }

  async update(
    tenantId: string,
    id: string,
    updateUserDto: UpdateUserDto,
    currentUserId?: string,
    currentUserRole?: UserRole,
  ): Promise<User> {
    const user = await this.findOne(tenantId, id);

    // Security: Prevent role escalation - only admins can change roles, and only for other users
    if (updateUserDto.role && updateUserDto.role !== user.role) {
      // Non-admin users cannot change any role (including their own)
      if (currentUserRole !== UserRole.ADMIN) {
        throw new ForbiddenException(
          'Only administrators can change user roles',
        );
      }
      // Admins cannot modify their own role
      if (currentUserId === id) {
        throw new ForbiddenException(
          'Admins cannot modify their own role permissions',
        );
      }
      // Log high-risk action
      console.warn('EA-001: Admin attempting role change', {
        adminId: currentUserId,
        targetUserId: id,
        oldRole: user.role,
        newRole: updateUserDto.role,
      });
    }

    // Check email uniqueness if changing
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existing = await this.userRepository.findByEmail(
        tenantId,
        updateUserDto.email,
      );
      if (existing) {
        throw new ConflictException('User with this email already exists');
      }
    }

    // ⛔ R2 (ikinci tur code-review blocker, 2026-08-20) — ROL DEĞİŞİMİ
    // KAPSAM TUTARSIZLIĞI ÜRETİYORSA 409.
    //
    // B1'in YARATMA kapısında yasakladığı DB durumu, bu rota üzerinden TEK
    // ÇAĞRIYLA kuruluyordu: joker satırlı bir kullanıcı (ADMIN/FINANCE/
    // READONLY) SCOPE_REQUIRED bir role çevrildiğinde satır OLDUĞU GİBİ
    // kalıyor ve `hasUnrestrictedRow` onu UNRESTRICTED'a çeviriyor
    // (access-scope.service.ts:205-210). CATEGORY_MANAGER için bayraktan
    // BAĞIMSIZ, yani CANLI.
    //
    // Ürün sahibi kararı (2026-08-20): burada 409 — "önce kapsam ver".
    // Fail-closed ve AÇIK. Kapsamın rol değişiminde YENİDEN KURULMASI ayrı
    // bir iştir ([[T-242]], artık P1) — bu kapı deliği kapatır, o yolu açar.
    // ⚠️ Ve 409 KALICI olabilir: kapsam güncelleme zaten ayrı bir işlem.
    if (updateUserDto.role && updateUserDto.role !== user.role) {
      await this.assertRoleChangeScopeConsistent(
        tenantId,
        id,
        updateUserDto.role,
      );
    }

    Object.assign(user, updateUserDto);
    return this.userRepository.save(user);
  }

  /**
   * Rol değişimi kapsam satırlarıyla tutarsız bir durum üretiyorsa 409.
   *
   * Bugün tek yön kapatılıyor — FAIL-OPEN olan yön:
   *   joker satırlı kullanıcı → SCOPE_REQUIRED rol   ⇒ 409
   *
   * Ters yön (dar kapsamlı kullanıcı → WILDCARD rol) bugün ZARARSIZ, çünkü
   * UNRESTRICTED_ROLES kod dalı o rolleri satırları okumadan geçiriyor
   * (access-scope.service.ts:168-171). ⚠️ Ama [[T-235]] ADIM 3 o dalı
   * kaldıracak — o gün bu yön de bir kapı ister ve [[T-242]]'nin konusudur.
   */
  private async assertRoleChangeScopeConsistent(
    tenantId: string,
    userId: string,
    newRole: UserRole,
  ): Promise<void> {
    if (!SCOPE_REQUIRED_ROLES.has(newRole)) {
      return;
    }

    const rows = await this.dataSource.getRepository(UserScope).find({
      where: { tenantId, userId, isActive: true },
    });

    const wildcardRow = rows.find(
      (r: UserScope) =>
        (r.cplId ?? null) === null && (r.categoryId ?? null) === null,
    );
    if (wildcardRow) {
      throw new ConflictException(
        `Rol '${newRole}' olarak değiştirilemez: kullanıcının JOKER kapsam ` +
          'satırı var (tüm CPL + tüm kategori) ve bu rol için joker kapsam ' +
          'verilemez (T-241). Rol değişiminden ÖNCE kapsam satırları bu role ' +
          'uygun hâle getirilmelidir — bugün bunun bir ucu YOK ([[T-242]]). ' +
          'Sessizce geçilseydi kullanıcı yeni rolüyle HER ŞEYİ görürdü.',
      );
    }

    if (rows.length === 0) {
      throw new ConflictException(
        `Rol '${newRole}' olarak değiştirilemez: kullanıcının hiç kapsam ` +
          'satırı yok, ve bu rol kapsam ZORUNLU (T-241). Kapsam satırı ' +
          'olmayan bir kullanıcı bu rolde HİÇBİR ŞEY göremez (R-2 ' +
          'fail-closed) — sessiz bir erişim kaybı yerine açık hata.',
      );
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const user = await this.findOne(tenantId, id);
    await this.userRepository.softRemove(user);
  }

  async changePassword(
    tenantId: string,
    id: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.findOne(tenantId, id);

    const isValid = await user.validatePassword(
      changePasswordDto.currentPassword,
    );
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await bcrypt.hash(changePasswordDto.newPassword, 10);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await this.userRepository.save(user);
  }

  async activate(tenantId: string, id: string): Promise<User> {
    const user = await this.findOne(tenantId, id);
    user.status = UserStatus.ACTIVE;
    return this.userRepository.save(user);
  }

  async deactivate(tenantId: string, id: string): Promise<User> {
    const user = await this.findOne(tenantId, id);
    user.status = UserStatus.INACTIVE;
    return this.userRepository.save(user);
  }

  async getProfile(tenantId: string, id: string): Promise<User> {
    return this.findOne(tenantId, id);
  }

  async refreshToken(refreshToken: string): Promise<LoginResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.userRepository.findOne({
        where: { id: payload.sub, refreshToken },
      });

      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      };

      const accessToken = this.jwtService.sign(newPayload);
      const newRefreshToken = this.jwtService.sign(newPayload, {
        expiresIn: '7d',
      });

      user.refreshToken = newRefreshToken;
      await this.userRepository.save(user);

      return {
        accessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          tenantId: user.tenantId,
        },
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(tenantId: string, id: string): Promise<void> {
    const user = await this.findOne(tenantId, id);
    user.refreshToken = undefined;
    await this.userRepository.save(user);
  }

  async getDashboardSummary(tenantId: string) {
    // Get all plans and agreements (excluding soft-deleted)
    const [plans, agreements, envelopes] = await Promise.all([
      this.planRepository.find({
        where: { tenantId },
        select: ['id', 'status'],
      }),
      this.agreementRepository.find({
        where: { tenantId },
        select: ['id', 'status'],
      }),
      this.budgetEnvelopeRepository.find({
        where: { tenantId },
        select: ['id', 'status', 'allocatedAmount', 'consumedAmount', 'period'],
      }),
    ]);

    // Calculate active operations (APPROVED plans + ACTIVE/APPROVED agreements)
    const activePlans = plans.filter((p) => p.status === PlanStatus.APPROVED);
    const activeAgreements = agreements.filter(
      (a) =>
        a.status === AgreementStatus.ACTIVE ||
        a.status === AgreementStatus.APPROVED,
    );
    const activeOperations = activePlans.length + activeAgreements.length;

    // Calculate drafts (DRAFT plans + DRAFT agreements)
    const draftPlans = plans.filter((p) => p.status === PlanStatus.DRAFT);
    const draftAgreements = agreements.filter(
      (a) => a.status === AgreementStatus.DRAFT,
    );
    const drafts = draftPlans.length + draftAgreements.length;

    // Calculate managed budget (total allocated amount from all active envelopes)
    const activeEnvelopes = envelopes.filter(
      (e) => e.status === BudgetEnvelopeStatus.ACTIVE,
    );
    const managedBudget = activeEnvelopes.reduce(
      (sum, e) => sum + Number(e.allocatedAmount || 0),
      0,
    );

    // Calculate Q1 budget status (usage percentage)
    // Get current quarter
    const now = new Date();
    const currentYear = now.getFullYear();
    const q1Envelopes = activeEnvelopes.filter(
      (e) => e.period === 'Q1' || e.period?.startsWith(`${currentYear}-Q1`),
    );

    let budgetUsage = 0;
    if (q1Envelopes.length > 0) {
      const totalAllocated = q1Envelopes.reduce(
        (sum, e) => sum + Number(e.allocatedAmount || 0),
        0,
      );
      const totalConsumed = q1Envelopes.reduce(
        (sum, e) => sum + Number(e.consumedAmount || 0),
        0,
      );
      if (totalAllocated > 0) {
        budgetUsage = (totalConsumed / totalAllocated) * 100;
      }
    }

    return {
      activeOperations,
      drafts,
      managedBudget,
      budgetUsage: Math.round(budgetUsage * 10) / 10, // Round to 1 decimal place
    };
  }
}

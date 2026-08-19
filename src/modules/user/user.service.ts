import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
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
} from '../../database/entities/user-scope.entity';
import { Cpl } from '../../database/entities/cpl.entity';
import { Category } from '../../database/entities/category.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
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
  ) {}

  /**
   * T-241 — `POST /users` rol + kapsam BİRLİKTE alır; kapsamsız kullanıcı
   * YARATILMAZ (`.claude/backlog/tasks/T-241.md` karar (b)).
   *
   * Atomiklik: kullanıcı satırı ve kapsam satır(lar)ı TEK transaction'da
   * yazılır — kısmi başarı (kullanıcı var, kapsam yok) oluşamaz. Bu, R-2
   * fail-closed'ın (AccessScopeService) tam olarak kaçınmaya çalıştığı
   * "kullanıcı var ama scope satırı yok" deliğini yaratma anında kapatır.
   *
   * K-2.6.10 sınırı: bu metod bir kapsam YAZAR, bir yetki HESAPLAMAZ.
   * AccessScopeService#buildScope'un semantiğini (R-1 pair, R-2 fail-closed,
   * NULL="hepsi") yeniden uygulamaz — yalnız hangi (cplId, categoryId)
   * çiftlerinin satır olarak var olacağına karar verir; o satırları nasıl
   * yorumlayacağı (UNRESTRICTED/SCOPED, CM normalizasyonu) okuma zamanında
   * yine AccessScopeService'tedir.
   */
  async create(tenantId: string, createUserDto: CreateUserDto): Promise<User> {
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

    return this.dataSource.transaction(async (manager) => {
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
          createdBy: savedUser.id,
        }),
      );
      await userScopeRepo.save(scopeEntities);

      return savedUser;
    });
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

    Object.assign(user, updateUserDto);
    return this.userRepository.save(user);
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

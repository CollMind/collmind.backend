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
import {
  ScopeUpdateIntent,
  UpdateUserScopeDto,
} from './dto/update-user-scope.dto';
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
  ScopeAuditPair,
} from '../../database/entities/user-scope.entity';
import { Cpl } from '../../database/entities/cpl.entity';
import { Category } from '../../database/entities/category.entity';
import { AdminAuditService } from '../../common/services/admin-audit.service';
import { AccessScopeService } from '../shared/access-scope/access-scope.service';
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
    // m1 (T-242a code-review): updateScope commit'ten SONRA çağırır —
    // REVOKE_ALL'ın 5sn TTL boyunca fail-open kalmasını önler.
    private readonly accessScopeService: AccessScopeService,
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

      this.assertScopePairsValidForRole(dto.role, dto.scope);

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
   * T-241 (B1) + T-241 (R1/A5) — SCOPE_REQUIRED_ROLES (PLANNER,
   * CATEGORY_MANAGER) için geçerli iki şekil kuralı, hem YARATMA
   * (`resolveScopeRowsToWrite`) hem GÜNCELLEME (`updateScope`, [[T-242a]])
   * yolunda AYNI. Tek yerde tutuluyor — iki yerde ayrı ayrı yazılsaydı
   * `İlke 4`'ün ("aynı yetenek birden çok kez yazılmasın") ihlaliydi, ve
   * biri düzeltilip diğeri unutulabilirdi (bkz. CLAUDE.md §7.1: "kardeş
   * yol etkilenmiyor iddiası ölçülmeden yazılamaz").
   *
   * B1: her iki boyutu da boş bir çift (`{}` ya da açıkça
   * `{cplId:null, categoryId:null}`) JOKER kapsam anlamına gelir ve bu
   * roller için YASAKTIR — normalize edilmez, reddedilir (§2.5).
   * R1/A5: CATEGORY_MANAGER için dolu bir `cplId` de aynı sonuca (okuma
   * yolu CM'de cplId'yi atar → fiilen joker) düşer, o yüzden ayrıca
   * yasaktır.
   */
  private assertScopePairsValidForRole(
    role: UserRole,
    pairs: UserScopePairDto[],
  ): void {
    const emptyPairIndex = pairs.findIndex(
      (pair) =>
        (pair.cplId ?? null) === null && (pair.categoryId ?? null) === null,
    );
    if (emptyPairIndex !== -1) {
      throw new BadRequestException(
        `role=${role} için 'scope' çiftlerinin en az bir boyutu dolu ` +
          `olmalıdır — ${emptyPairIndex}. çiftin hem 'cplId' hem ` +
          `'categoryId' değeri boş. Boş bir çift JOKER kapsam (tüm CPL + ` +
          'tüm kategori) anlamına gelir ve bu rol için verilemez (T-241, ' +
          'ürün sahibi kararı 2026-08-19). Joker kapsam gereken bir ' +
          'kullanıcı ADMIN/FINANCE/READONLY rollerinden biriyle yaratılır.',
      );
    }

    if (role === UserRole.CATEGORY_MANAGER) {
      const cplPairIndex = pairs.findIndex(
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

    // §2.5: yinelenen bir çift (aynı cplId+categoryId birden fazla kez)
    // sessizce tek satıra çökmemelidir (updateScope'un hedef-küme diff'i
    // Map ile kurulur ve doğal olarak dedupe eder — bu kontrol olmadan
    // çağıranın "iki satır istedim" niyeti sessizce "bir satır" olurdu).
    //
    // ⚠️ DÜZELTİLDİ (code-review, 2026-08-20) — bu yorum ÖNCE "create()
    // yolunda bu durum DB'nin unique index'ine çarpıp GÜRÜLTÜLÜ başarısız
    // olur" diyordu. Yanlıştı: `UQ_user_scopes_user_cpl_category` yazıldığı
    // anda DÜZ bir UNIQUE'ti (migration 1779) ve PostgreSQL'de NULL'lar
    // birbirinden AYRI sayılır — yani `{cplId:X, categoryId:null}` gibi bir
    // çift (R1/A5 gereği PLANNER/CATEGORY_MANAGER çiftlerinin EZİCİ
    // ÇOĞUNLUĞU bu şekilde, tam biri boş) İKİ kez gönderilse index HİÇ
    // ateşlemezdi — create() SESSİZCE iki yinelenen satır yazardı, 500
    // vermezdi (ölçüldü: mutasyonsuz, HEAD'de `POST /users` aynı çifti iki
    // kez taşıyan bir `scope` dizisiyle 201 dönüyor, `user_scopes`'ta iki
    // satır). Migration `1810000000000` (`NULLS NOT DISTINCT`, [[T-245]])
    // bunu değiştirdi: artık NULL içeren yinelenen çiftler de DB
    // seviyesinde `23505` verir — ama bu kontrol o migration'dan ÖNCE de
    // yazılmıştı ve migration YOKKEN bile gerekliydi (aksi hâlde create()
    // sessizce çift satır yazardı). Bugün ikinci bir savunma katmanı: DB
    // artık AYNI kuralı zorluyor, ama uygulama katmanındaki bu kontrol daha
    // iyi bir hata mesajı üretir ve migration'ın varlığına BAĞIMLI değildir.
    const seen = new Set<string>();
    for (let i = 0; i < pairs.length; i += 1) {
      const key = `${pairs[i].cplId ?? 'NULL'}::${pairs[i].categoryId ?? 'NULL'}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          `'scope' içinde yinelenen çift: ${i}. çift daha önce geçen bir ` +
            '(cplId, categoryId) çiftinin tekrarı. Her çift bir kez ' +
            'verilmelidir — yineleme sessizce tek satıra indirilmez (§2.5).',
        );
      }
      seen.add(key);
    }
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

  /**
   * [[T-242a]] — kapsam GÜNCELLEME/BOŞALTMA yolu. `PATCH /users/:id/scope`.
   *
   * ADIM 0 ölçümü (2026-08-20): `PATCH /users/:id`'in genel gövdesi
   * `scope`'u SESSİZCE yutuyordu — `Object.assign` `User` entity'sine
   * yazıyordu, `User`'da böyle bir kolon yok, `save()` onu yok sayıyordu.
   * `update-user.dto.ts`'te `scope` artık DTO'dan çıkarıldı (o yol artık
   * 400 döner); kapsam güncellemesinin TEK ve CANLI yolu burasıdır.
   *
   * `Z15` KARAR 1 — TAM DEĞİŞTİRME: `dto.scope` (ya da `REVOKE_ALL`'da boş
   * küme) HEDEF durumun tamamıdır. Bu metod DB'de var olan satırlarla hedef
   * kümeyi KARŞILAŞTIRIR ve fark kadar yazar (upsert/deactivate) — ama bu
   * içeride kalan bir DİFF'tir, çağırana sızmaz: çağıran hâlâ tek bir
   * "hedef küme" gönderir, sıra bağımlı bir ekle/çıkar akışı YOKTUR.
   *
   * Diff neden gerekli (silme değil): `user_scopes`'un `(user_id, cpl_id,
   * category_id)` üzerindeki UNIQUE INDEX'i PARTIAL DEĞİL (`is_active`
   * koşulu yok, `1779000000000-CreateUserScopes.ts`) — yani bir satırı
   * `isActive=false` yapmak o (cplId,categoryId) anahtarını YENİDEN
   * kullanılabilir kılmaz. Aynı çifti tekrar hedef kümeye koymak (ör.
   * boşalt → geri ver) bir bare INSERT ile çakışır — bu yüzden aşağıdaki
   * kod önce `existingRows`'ta arıyor, kör bir INSERT denemiyor.
   * `user-scope.seed.ts` aynı kısıt altında AYNI upsert desenini
   * kullanıyor (mevcut satır varsa `isActive` günceller, yoksa INSERT
   * eder) — burada o desen tekrar kullanıldı, yeniden icat edilmedi.
   *
   * ⚠️ DÜZELTİLDİ (code-review, 2026-08-20): "INSERT ile çakışır" ifadesi
   * `1810000000000` migration'ından (`NULLS NOT DISTINCT`, [[T-245]])
   * ÖNCE yalnız her İKİ boyutu da DOLU çiftler için garantiliydi — NULL
   * içeren bir çiftin (ör. `{cplId:X, categoryId:null}`, PLANNER'ların
   * ÇOĞUNLUĞU) bare INSERT'i eski düz UNIQUE'te HİÇ çakışmazdı (NULL'lar
   * ayrı sayılırdı), yalnız iki aktif+pasif AYNI satır çoğalırdı. Kod bu
   * riske migration'dan BAĞIMSIZ zaten dayanıklıydı, çünkü "önce ara, INSERT
   * etme" deseni izliyordu — reaktivasyon mantığı hiçbir zaman DB
   * çakışmasına GÜVENMEDİ. Migration 1810'dan SONRA artık DB de aynı kuralı
   * (NULL dahil TÜM çiftlerde) zorluyor — iki katman şimdi TUTARLI, ama
   * uygulama katmanı ondan önce de doğruydu.
   *
   * `Z15` KARAR 2 — BOŞALTMA izinli ama SESSİZ OLAMAZ: `intent` ZORUNLU;
   * `intent=UPDATE` + boş küme → RET; `intent=REVOKE_ALL` + dolu küme →
   * RET (tutarsız niyet); `intent=REVOKE_ALL` + gerekçesiz → RET
   * (`DENETIM_SOZLUGU.md` Madde 1: REVOKE_ALL'da gerekçe zorunlu).
   *
   * `K-2.6.10` sınırı: bu metod bir kapsam YAZAR, bir yetki HESAPLAMAZ —
   * `resolveScopeRowsToWrite`'ın yorumuyla birebir aynı sınır, aynı gerekçe.
   *
   * WILDCARD_SCOPE_ROLES (ADMIN/FINANCE/READONLY) bu uçtan YÖNETİLEMEZ:
   * bu roller HER ZAMAN tek joker satır taşır (T-241 kararı) ve bunu
   * değiştirmenin yolu rol değişimidir — o da [[T-242b]]'nin konusu ve
   * ERTELENDİ. Burada izin verilseydi iki farklı mekanizma (bu uç +
   * rol-değişim akışındaki `assertRoleChangeScopeConsistent`) aynı
   * garantiyi (wildcard roller = wildcard satır) iki ayrı yerden
   * korumaya çalışırdı — tek nokta (`İlke 4`) bunu burada REDDETMEK.
   *
   * Denetim: `docs/process/DENETIM_SOZLUGU.md` Madde 1 — `eski küme`/
   * `yeni küme`, aktör (çağıran ADMIN, etkilenen kullanıcı DEĞİL — A1
   * dersinin burada da geçerli olduğu), `entity_type='user'` (Z17).
   * Atomiklik: kapsam satır değişimi + denetim kaydı AYNI transaction'da
   * (`options.manager`, T-244 deseni).
   */
  async updateScope(
    tenantId: string,
    userId: string,
    dto: UpdateUserScopeDto,
    actorId: string,
    actorEmail: string,
    ipAddress?: string,
  ): Promise<{ scope: ScopeAuditPair[] }> {
    const user = await this.findOne(tenantId, userId);

    if (WILDCARD_SCOPE_ROLES.has(user.role)) {
      throw new BadRequestException(
        `role=${user.role} için kapsam bu uçtan GÜNCELLENEMEZ — bu rol her ` +
          'zaman JOKER kapsam taşır (tüm CPL + tüm kategori) ve bunu ' +
          'değiştirmenin yolu rol değişimidir, kapsam güncellemesi değil ' +
          "(kapsam-yönetilebilir bir role rol DEĞİŞİMİ [[T-242b]]'nin " +
          'konusudur ve ERTELENDİ). Bugün bu rol için tek satır (null, ' +
          'null) sabittir.',
      );
    }
    if (!SCOPE_REQUIRED_ROLES.has(user.role)) {
      // §2.5: role, WILDCARD_SCOPE_ROLES ile SCOPE_REQUIRED_ROLES'ün
      // tümleyeni olmalıydı — resolveScopeRowsToWrite'ın aynı savunması.
      throw new Error(
        `UserService.updateScope: role=${user.role} ne WILDCARD_SCOPE_ROLES'ta ` +
          "ne SCOPE_REQUIRED_ROLES'ta — user-scope.entity.ts'teki iki sabit " +
          'güncel UserRole kümesini kapsamıyor olabilir.',
      );
    }

    // ── Z15 KARAR 2: boş küme ∧ intent ≠ REVOKE_ALL → RET ────────────────
    if (dto.intent === ScopeUpdateIntent.UPDATE && dto.scope.length === 0) {
      throw new BadRequestException(
        "intent='UPDATE' için 'scope' en az 1 çift taşımalıdır — kapsamı " +
          "TÜMÜYLE boşaltmak için intent='REVOKE_ALL' kullanılmalıdır " +
          '(Z15 KARAR 2). Boş bir dizi sessizce "temizle" anlamına gelmez.',
      );
    }
    if (dto.intent === ScopeUpdateIntent.REVOKE_ALL) {
      if (dto.scope.length > 0) {
        throw new BadRequestException(
          "intent='REVOKE_ALL' 'scope' alanıyla BİRLİKTE gelemez — " +
            'REVOKE_ALL hedef kümeyi HER ZAMAN boşaltır. Belirli çiftler ' +
            "bırakmak istiyorsanız intent='UPDATE' kullanın (tutarsız " +
            'niyet sessizce çözülmez, §2.5).',
        );
      }
      if (!dto.reason || dto.reason.trim().length === 0) {
        throw new BadRequestException(
          "intent='REVOKE_ALL' için 'reason' ZORUNLUDUR " +
            '(DENETIM_SOZLUGU.md Madde 1) — kapsamı tümüyle boşaltmak ' +
            'yıkıcı bir işlemdir, gerekçesiz yapılamaz.',
        );
      }
    }

    const targetPairs: UserScopePairDto[] =
      dto.intent === ScopeUpdateIntent.REVOKE_ALL ? [] : dto.scope;

    if (targetPairs.length > 0) {
      this.assertScopePairsValidForRole(user.role, targetPairs);

      const cplIds = [
        ...new Set(
          targetPairs
            .map((pair) => pair.cplId)
            .filter((id): id is string => id !== null && id !== undefined),
        ),
      ];
      const categoryIds = [
        ...new Set(
          targetPairs
            .map((pair) => pair.categoryId)
            .filter((id): id is string => id !== null && id !== undefined),
        ),
      ];
      await this.assertCplIdsBelongToTenant(tenantId, cplIds);
      await this.assertCategoryIdsBelongToTenant(tenantId, categoryIds);
    }

    const targetKey = (p: {
      cplId: string | null;
      categoryId: string | null;
    }): string => `${p.cplId ?? 'NULL'}::${p.categoryId ?? 'NULL'}`;

    const { after, auditLog } = await this.dataSource.transaction(
      async (manager) => {
        const userScopeRepo = manager.getRepository(UserScope);

        // Unique index TÜM satırları kapsar (isActive'e bakmaksızın, bkz.
        // JSDoc) — bu yüzden reaktivasyon/deaktivasyon kararı için AKTİF
        // OLMAYAN satırları da görmemiz gerekir.
        const existingRows = await userScopeRepo.find({
          where: { tenantId, userId },
        });

        const before: ScopeAuditPair[] = existingRows
          .filter((r) => r.isActive)
          .map((r) => ({
            cplId: r.cplId ?? null,
            categoryId: r.categoryId ?? null,
          }));

        const targetSet = new Map<string, UserScopePairDto>(
          targetPairs.map((pair) => [
            targetKey({
              cplId: pair.cplId ?? null,
              categoryId: pair.categoryId ?? null,
            }),
            pair,
          ]),
        );

        // 1) Artık hedefte olmayan AKTİF satırları deaktive et.
        for (const row of existingRows) {
          const key = targetKey({
            cplId: row.cplId ?? null,
            categoryId: row.categoryId ?? null,
          });
          if (row.isActive && !targetSet.has(key)) {
            row.isActive = false;
            row.updatedBy = actorId;
            await userScopeRepo.save(row);
          }
        }

        // 2) Hedef kümedeki her çift için: var olan satırı reaktive et
        //    (unique index nedeniyle yeniden INSERT edilemez), yoksa yenisini
        //    yaz. Zaten aktif ve hedefte olan satıra dokunulmaz (idempotency).
        for (const [key, pair] of targetSet) {
          const existingRow = existingRows.find(
            (row) =>
              targetKey({
                cplId: row.cplId ?? null,
                categoryId: row.categoryId ?? null,
              }) === key,
          );
          if (existingRow) {
            if (!existingRow.isActive) {
              // M2 (code-review, ürün sahibi kararı 2026-08-20): reaktivasyon
              // YENİ bir verme eylemidir — satırın yeniden kullanılıyor
              // olması olayın AYNI olduğu anlamına gelmez. `createdBy` da
              // (yalnız `updatedBy` değil) GÜNCEL aktöre yazılır; aksi hâlde
              // satır bayat bir aktörde kalır ve `created_by` kendi
              // sorusuna ("bu erişimi kim verdi") yanlış cevap verir —
              // denetim kaydına bakmaya mecbur kalmak alanın var olma
              // sebebini ortadan kaldırır (A1'in aynı sınıfı: desen var,
              // bu yolda kullanılmıyordu).
              existingRow.isActive = true;
              existingRow.createdBy = actorId;
              existingRow.updatedBy = actorId;
              await userScopeRepo.save(existingRow);
            }
          } else {
            const created = userScopeRepo.create({
              tenantId,
              userId,
              cplId: pair.cplId ?? undefined,
              categoryId: pair.categoryId ?? undefined,
              isActive: true,
              createdBy: actorId,
            });
            await userScopeRepo.save(created);
          }
        }

        const after: ScopeAuditPair[] = targetPairs.map((pair) => ({
          cplId: pair.cplId ?? null,
          categoryId: pair.categoryId ?? null,
        }));

        const actionType =
          dto.intent === ScopeUpdateIntent.REVOKE_ALL
            ? ScopeAuditActionType.SCOPE_REVOKE_ALL
            : ScopeAuditActionType.SCOPE_UPDATE;

        // DENETIM_SOZLUGU.md Madde 1: "kim" = AKTÖR (çağıran admin), "neye"
        // = kullanıcı (Z17, entity_type='user'). T-014/T-244 deseni: aynı
        // transaction (`{manager}`), rollback olursa denetim kaydı da hiç
        // yazılmamış olur.
        const auditLog = await this.adminAuditService.logAdminAction(
          tenantId,
          actorId,
          actorEmail,
          actionType,
          SCOPE_AUDIT_ENTITY_TYPE,
          userId,
          ipAddress,
          'SUCCESS',
          { scope: sortScopeAuditPairsCanonically(before) },
          { scope: sortScopeAuditPairsCanonically(after) },
          dto.reason,
          { manager },
        );

        return { before, after, auditLog };
      },
    );
    // m1 (code-review, ürün sahibi kararı 2026-08-20): cache invalidasyonu
    // COMMIT'TEN SONRA, transaction'ın DIŞINDA çağrılır — `flushPendingAlert`
    // ile AYNI yerleşim gerekçesi. Transaction İÇİNDE çağrılsaydı ve sonra
    // ROLLBACK olsaydı zararsız olurdu (cache'i boşuna temizlemiş olurduk),
    // ama COMMIT'TEN ÖNCE çağrılsaydı bir yarış penceresi doğardı: başka bir
    // istek commit'ten önceki eski (artık YANLIŞ) değeri okuyup cache'e
    // yeniden yazabilirdi — cache invalidasyonu commit'ten sonra gelen bir
    // okumanın DOĞRU değeri görmesini garanti eder, öncesinin değil. Bir
    // erişim KALDIRMA işlemi (REVOKE_ALL) 5sn TTL boyunca bile gecikemez —
    // kusurun yönü fail-open'dır (T-039'un aynı sınıfı, ikinci vaka).
    this.accessScopeService.clearCache();

    // T-014 kalıbı: create()'in aynı gerekçesi — alarm gönderimi başarısız
    // olursa commit'li bir işlemi 500'e ÇEVİRMEMELİ. m2 (code-review) ile
    // `SCOPE_REVOKE_ALL` artık `isHighRiskAction`'da (admin-audit.service.ts)
    // — yani bu çağrı REVOKE_ALL'da GERÇEKTEN alarm üretir; `SCOPE_UPDATE`
    // bilerek listede DEĞİL (olağan bir kapsam değişikliği), o dalda hâlâ
    // no-op.
    try {
      await this.adminAuditService.flushPendingAlert(auditLog);
    } catch (alertErr) {
      this.logger.error(
        `HIGH-RISK ALERT FAILED — user ${userId} scope updated successfully; alert not delivered: ${
          alertErr instanceof Error ? alertErr.message : 'Unknown error'
        }`,
      );
    }

    return { scope: after };
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

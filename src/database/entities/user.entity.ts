import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import * as bcrypt from 'bcrypt';
import { BaseEntity } from './base.entity';
import { Tenant } from './tenant.entity';

/**
 * B dalgası / R2a (K-2.6.4, K-2.6.4d — `EK_C_VERI_SOZLUGU.md` §B dalgası `R2` eşleme
 * tablosu, ürün sahibi kararı 2026-08-13, **düzeltildi 2026-08-13 ⛔ P0**):
 *
 * ⚠️ **Enum DEĞERLERİ ASCII KALIR — Türkçeye TAŞINMAZ.** İlk turda enum değerleri
 * (`ADMIN = 'YÖNETİCİ'` vb.) doğrudan Türkçeye çevrilmişti. Bağımsız kontrol bunun bir
 * **tel protokolü kırılması** olduğunu ölçtü: `collmind.frontend/src/types/user.types.ts`
 * aynı enum'u `UserRole.ADMIN = 'ADMIN'` olarak taşıyor, ve `roleUtils.ts#hasRole`
 * birebir string eşitliğiyle çalışıyor (`'YÖNETİCİ' === 'ADMIN'` → `false`) — sonuç:
 * **her rol kapılı rota, her kullanıcı için reddediliyordu**, ve hiçbir kapı bunu
 * görmedi (backend `tsc`/testler/guards yeşildi; frontend `type-check` de yeşildi çünkü
 * `user.role as UserRole` cast'i tipi susturuyordu). Gerekçe: `K-2.6.4` bir **iş
 * kataloğudur**, şema/tel sözleşmesi değil — `K-2.2.7`'nin görüntü/davranış ayrımı
 * (renk vs kontrol merdiveni) burada da geçerli: Türkçe ad **görüntü katmanına** gider,
 * tel değerine değil. Kaynak: `EK_C_VERI_SOZLUGU.md § Enum DEĞERLERİ ASCII kalır`.
 *
 * Enum DEĞERLERİ (tel) — çoğu DEĞİŞMEDİ:
 * ```
 * ADMIN → ADMIN · PLANNER → PLANNER · CATEGORY_MANAGER → CATEGORY_MANAGER
 * READONLY → READONLY
 * FINANCE_MANAGER → FINANCE   ⚠️ TEK ad değişikliği — eski jenerik `FINANCE` (0
 *                                kullanıcı, K-2.6.4b'nin reddettiği rol) SİLİNİYOR ve
 *                                etiket `FINANCE_MANAGER`'a devrediliyor.
 * APPROVER / MANAGER / (eski) FINANCE → SİLİNİR (üçü de 0 kullanıcı, ölçüldü 2026-08-13)
 * ```
 *
 * TS enum KEY'leri (sol taraf) DEĞİŞMEDİ — kod hâlâ `UserRole.FINANCE_MANAGER` yazıyor;
 * yalnız o key'in TAŞIDIĞI string `'FINANCE_MANAGER'` → `'FINANCE'` oldu.
 *
 * K-2.6.4'ün Türkçe rol katalogu (YÖNETİCİ/PLANLAMACI/KATEGORİ MÜDÜRÜ/FİNANS/İZLEYİCİ)
 * bir **görüntü eşlemesidir** — bugün frontend'de var olan tek eşleme mekanizması
 * `EnumBadge.tsx#formatLabel` (yalnız `snake_case → Title Case`, ÇEVİRİ yapmıyor).
 * Türkçe görüntü katmanının TAM olarak nereye (`EnumBadge` genişlemesi mi, ayrı bir
 * i18n katmanı mı) konacağı bu migration'ın kapsamı DIŞINDA — Team Lead kararı.
 *
 * R2b (ölü kod referansları: `APPROVER` 7 dosya, `MANAGER` 13, `FINANCE` 6 — backend
 * tarafı) BU DALGADA DEĞİL — ayrı PR. Frontend tarafı (`collmind.frontend`) ise ASCII
 * kararıyla kapsam KÜÇÜLDÜ AMA SIFIR DEĞİL: `FINANCE_MANAGER`'ın tel değeri değiştiği
 * ve üç değer silindiği için frontend'in KENDİ `UserRole` enum'u + tüketicileri de bu
 * migration'ın bir parçası olarak güncellendi (ayrı repo, aynı PR/tur — bkz. `collmind.
 * frontend/src/types/user.types.ts` ve grep ile üretilen tüketici listesi, final rapor).
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  PLANNER = 'PLANNER',
  CATEGORY_MANAGER = 'CATEGORY_MANAGER',
  FINANCE_MANAGER = 'FINANCE', // ⚠️ tek ad değişikliği — eski jenerik FINANCE'in yerini alıyor
  READONLY = 'READONLY', // Read-only access — all GET endpoints, no write
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  LOCKED = 'LOCKED',
}

@Entity({ name: 'users', schema: 'main' })
@Index(['tenantId', 'email'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['role'])
export class User extends BaseEntity {
  @Column({ length: 200 })
  email!: string;

  @Column({ name: 'password_hash', length: 255 })
  @Exclude()
  passwordHash!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.PLANNER,
  })
  role!: UserRole;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING,
  })
  status!: UserStatus;

  @Column({ name: 'full_name', length: 200 })
  fullName!: string;

  @Column({ name: 'first_name', length: 100, nullable: true })
  firstName?: string;

  @Column({ name: 'last_name', length: 100, nullable: true })
  lastName?: string;

  @Column({ name: 'phone_number', length: 50, nullable: true })
  phoneNumber?: string;

  @Column({ length: 100, nullable: true })
  department?: string;

  @Column({ name: 'job_title', length: 100, nullable: true })
  jobTitle?: string;

  // Avatar/Profile
  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl?: string;

  // Authentication
  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt?: Date;

  @Column({ name: 'login_count', type: 'int', default: 0 })
  loginCount!: number;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ name: 'locked_until', type: 'timestamp', nullable: true })
  lockedUntil?: Date;

  @Column({ name: 'password_changed_at', type: 'timestamp', nullable: true })
  passwordChangedAt?: Date;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  // Refresh Token
  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  @Exclude()
  refreshToken?: string;

  // Email Verification
  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ name: 'email_verification_token', type: 'text', nullable: true })
  @Exclude()
  emailVerificationToken?: string;

  @Column({
    name: 'email_verification_expires',
    type: 'timestamp',
    nullable: true,
  })
  emailVerificationExpires?: Date;

  // Password Reset
  @Column({ name: 'password_reset_token', type: 'text', nullable: true })
  @Exclude()
  passwordResetToken?: string;

  @Column({ name: 'password_reset_expires', type: 'timestamp', nullable: true })
  passwordResetExpires?: Date;

  // Preferences
  @Column({ type: 'jsonb', nullable: true })
  preferences?: {
    language?: string;
    timezone?: string;
    dateFormat?: string;
    notifications?: {
      email?: boolean;
      inApp?: boolean;
      mobile?: boolean;
    };
    theme?: 'light' | 'dark' | 'auto';
  };

  // Permissions (for fine-grained access control)
  @Column({ type: 'jsonb', nullable: true })
  permissions?: string[];

  // Relations
  @ManyToOne(() => Tenant, (tenant) => tenant.users)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @BeforeInsert()
  @BeforeUpdate()
  async hashPassword() {
    if (this.passwordHash && !this.passwordHash.startsWith('$2b$')) {
      this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
    }
  }

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.passwordHash);
  }
}

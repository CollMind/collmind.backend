# Şube (Branch) Verileri İmplementasyon Planı

## 📊 Değerlendirme

### Mevcut Durum
- ✅ `numberOfBranches` alanı mevcut (sadece sayı)
- ❌ Şube detayları yok (ad, adres, iletişim, durum vb.)
- ❌ Şube bazlı filtreleme/arama yok
- ❌ Şube bazlı işlemler yok

### İhtiyaç Analizi

**Eğer şunlara ihtiyacınız varsa → İlişkisel Yaklaşım:**
- Her şube için ayrı bilgi tutmak (ad, adres, telefon)
- Şube bazlı filtreleme/arama yapmak
- Şube bazlı raporlama/analiz
- Şube bazlı sipariş/ürün yönetimi
- Şube durumu takibi (aktif/pasif)
- Şube bazlı iletişim kişileri

**Eğer sadece sayı yeterliyse → Basit Yaklaşım (Mevcut):**
- Sadece toplam şube sayısını göstermek
- Basit istatistikler için

---

## 🎯 Önerilen Yaklaşım: İlişkisel Model

### Neden?
1. **Ölçeklenebilirlik**: Gelecekte şube detaylarına ihtiyaç duyulabilir
2. **Esneklik**: Her şube için farklı bilgiler tutulabilir
3. **İş Mantığı**: Şube bazlı işlemler yapılabilir
4. **Raporlama**: Şube bazlı analizler yapılabilir

---

## 📋 İmplementasyon Adımları

### 1. Branch Entity Oluşturma

**Dosya**: `src/database/entities/branch.entity.ts`

```typescript
import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Customer } from './customer.entity';

export enum BranchStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  CLOSED = 'CLOSED',
}

@Entity({ name: 'branches', schema: 'main' })
@Index(['tenantId', 'customerId', 'code'], { unique: true })
@Index(['tenantId', 'customerId'])
@Index(['tenantId', 'status'])
@Index(['city'])
export class Branch extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({
    type: 'enum',
    enum: BranchStatus,
    default: BranchStatus.ACTIVE,
  })
  status!: BranchStatus;

  // Location Information
  @Column({ length: 100, nullable: true })
  city?: string;

  @Column({ length: 100, nullable: true })
  district?: string;

  @Column({ length: 100, nullable: true })
  region?: string;

  @Column({ length: 100, nullable: true })
  country?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ name: 'postal_code', length: 20, nullable: true })
  postalCode?: string;

  // Contact Information
  @Column({ name: 'contact_person', length: 200, nullable: true })
  contactPerson?: string;

  @Column({ name: 'contact_email', length: 255, nullable: true })
  contactEmail?: string;

  @Column({ name: 'contact_phone', length: 50, nullable: true })
  contactPhone?: string;

  @Column({ name: 'contact_mobile', length: 50, nullable: true })
  contactMobile?: string;

  // Business Information
  @Column({ name: 'tax_number', length: 50, nullable: true })
  taxNumber?: string;

  @Column({ name: 'tax_office', length: 100, nullable: true })
  taxOffice?: string;

  // Operational
  @Column({ name: 'opening_date', type: 'date', nullable: true })
  openingDate?: Date;

  @Column({ name: 'closing_date', type: 'date', nullable: true })
  closingDate?: Date;

  @Column({ name: 'store_size', type: 'decimal', precision: 10, scale: 2, nullable: true })
  storeSize?: number; // m²

  @Column({ name: 'number_of_employees', type: 'int', nullable: true })
  numberOfEmployees?: number;

  // Additional
  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    operatingHours?: {
      monday?: string;
      tuesday?: string;
      wednesday?: string;
      thursday?: string;
      friday?: string;
      saturday?: string;
      sunday?: string;
    };
    coordinates?: {
      latitude?: number;
      longitude?: number;
    };
    amenities?: string[];
  };

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // Relations
  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;
}
```

### 2. Migration Oluşturma

**Dosya**: `src/database/migrations/[timestamp]-CreateBranches.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateBranches[timestamp] implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'branches',
        schema: 'main',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'tenant_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'customer_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'code',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '200',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACTIVE', 'INACTIVE', 'PENDING', 'CLOSED'],
            default: "'ACTIVE'",
          },
          {
            name: 'city',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'district',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'region',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'country',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'address',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'postal_code',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'contact_person',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'contact_email',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'contact_phone',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'contact_mobile',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'tax_number',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'tax_office',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'opening_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'closing_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'store_size',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'number_of_employees',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'updated_by',
            type: 'uuid',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Indexes
    await queryRunner.createIndex(
      'main.branches',
      new TableIndex({
        name: 'IDX_branches_tenant_customer_code',
        columnNames: ['tenant_id', 'customer_id', 'code'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'main.branches',
      new TableIndex({
        name: 'IDX_branches_tenant_customer',
        columnNames: ['tenant_id', 'customer_id'],
      }),
    );

    await queryRunner.createIndex(
      'main.branches',
      new TableIndex({
        name: 'IDX_branches_tenant_status',
        columnNames: ['tenant_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'main.branches',
      new TableIndex({
        name: 'IDX_branches_city',
        columnNames: ['city'],
      }),
    );

    // Foreign Key
    await queryRunner.createForeignKey(
      'main.branches',
      new TableForeignKey({
        columnNames: ['customer_id'],
        referencedTableName: 'customers',
        referencedSchema: 'main',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('main.branches');
  }
}
```

### 3. Customer Entity Güncelleme

**Customer entity'ye OneToMany ilişki ekle:**

```typescript
// customer.entity.ts içine ekle
import { OneToMany } from 'typeorm';
import { Branch } from './branch.entity';

// ... mevcut kod ...

// Relations bölümüne ekle
@OneToMany(() => Branch, (branch) => branch.customer)
branches?: Branch[];
```

### 4. Branch Module Oluşturma

**Dosya Yapısı:**
```
src/modules/branch/
├── branch.module.ts
├── branch.service.ts
├── branch.repository.ts
├── branch.controller.ts
└── dto/
    ├── create-branch.dto.ts
    ├── update-branch.dto.ts
    ├── branch-filter.dto.ts
    └── branch-response.dto.ts
```

### 5. Database Module Güncelleme

**Branch entity'yi TypeORM'e kaydet:**

```typescript
// database.module.ts
import { Branch } from './entities/branch.entity';

// TypeOrmModule.forFeature içine ekle
TypeOrmModule.forFeature([
  Tenant,
  User,
  Customer,
  Branch, // ✅ Yeni
])
```

---

## 🔄 Geçiş Stratejisi

### Seçenek 1: Yumuşak Geçiş (Önerilen)
1. Branch entity'yi oluştur
2. `numberOfBranches` alanını koru (geriye dönük uyumluluk için)
3. Yeni şubeler Branch tablosuna eklenir
4. İsteğe bağlı: Mevcut `numberOfBranches` değerlerini Branch kayıtlarına dönüştür

### Seçenek 2: Tam Geçiş
1. Branch entity'yi oluştur
2. `numberOfBranches` alanını kaldır
3. Tüm şube bilgilerini Branch tablosuna taşı

---

## 📊 Karşılaştırma Tablosu

| Özellik | Basit (Mevcut) | İlişkisel (Önerilen) |
|---------|----------------|----------------------|
| Şube sayısı | ✅ | ✅ |
| Şube detayları | ❌ | ✅ |
| Şube bazlı filtreleme | ❌ | ✅ |
| Şube bazlı arama | ❌ | ✅ |
| Şube bazlı işlemler | ❌ | ✅ |
| Performans | ⚡⚡⚡ | ⚡⚡ |
| Karmaşıklık | Düşük | Orta |
| Ölçeklenebilirlik | Düşük | Yüksek |

---

## 🎯 Sonuç ve Öneri

**Öneri: İlişkisel Yaklaşım**

**Neden?**
1. Gelecekte şube detaylarına ihtiyaç duyulabilir
2. Daha esnek ve ölçeklenebilir
3. İş mantığı açısından daha mantıklı
4. Raporlama ve analiz için daha uygun

**Ne zaman basit yaklaşım yeterli?**
- Sadece sayısal bilgi yeterliyse
- Şube detaylarına hiç ihtiyaç yoksa
- Çok basit bir sistem ise

---

## 📝 Yapılacaklar Listesi

- [ ] Branch entity oluştur
- [ ] Migration oluştur ve çalıştır
- [ ] Customer entity'ye OneToMany ilişki ekle
- [ ] Branch module oluştur (service, repository, controller)
- [ ] Branch DTOs oluştur
- [ ] Branch endpoints oluştur
- [ ] Database module'ü güncelle
- [ ] Customer service'te branch sayısını otomatik hesapla (opsiyonel)
- [ ] Test yaz

---

**Son Güncelleme**: 2024-01-XX




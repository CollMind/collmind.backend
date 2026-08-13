import {
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * ImmutableBaseEntity — `BaseEntity` minus `deletedAt`.
 *
 * B dalgası / R1 (`K-2.3.4`, `EK_C_VERI_SOZLUGU.md` §C.7): "Bir kuralın 'bu kolon hep boş
 * olmalı' demek zorunda kalması, kolonun hiç olmaması gerektiğinin işaretidir." Ledger
 * kayıtları hiçbir zaman soft-delete edilmez (audit/immutability invariant); `deleted_at`
 * kolonunun VARLIĞI kendisi bu invariant'ı ihlal etmeye açık bir yüzeydi.
 *
 * `LedgerEntry` bu entity'yi `BaseEntity` yerine extend eder ki `migration:generate`
 * `ledger_entries.deleted_at`'i tekrar önermesin (entity metadata ↔ DB parite kuralı,
 * bkz. CLAUDE.md "Bir şema kararını geri alırken entity metadata'sını da geri al").
 *
 * ⚠️ Yeni bir entity soft-delete İSTEMİYORSA bu sınıfı extend etsin — `BaseEntity`'yi
 * extend edip `deletedAt`'i yoksaymak YETMEZ, decorator hâlâ kolonu şemaya yazar.
 */
export abstract class ImmutableBaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index()
  tenantId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string;
}

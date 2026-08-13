import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GenericUnit } from './generic-unit.entity';
import { ForecastingUnit } from './forecasting-unit.entity';

@Entity({ name: 'skus', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['guId'])
@Index(['fuId'])
export class Sku extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'gu_id', type: 'uuid' })
  guId!: string;

  @Column({ name: 'fu_id', type: 'uuid', nullable: true })
  fuId?: string; // Nullable (some SKUs not FU-mapped)

  @Column({ length: 100, nullable: true })
  variant?: string; // "Parlak Renkler", "Bukleler", etc.

  @Column({ length: 20, nullable: true })
  size?: string;

  @Column({ length: 50, nullable: true })
  barcode?: string;

  @Column({
    name: 'unit_price',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  unitPrice?: number;

  @Column({
    name: 'cogs',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  cogs?: number; // Cost of Goods Sold

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  // B dalgası / R3 (K-2.1.12b): serbest `unit_of_measure` alanı KALDIRILDI — çekirdek
  // tablolarda birim alanı olmaması "en iyi doğrulama". Yerine S12 (K-2.1.12c): bilgi
  // amaçlı satış birimi + adete çevrim çarpanı.

  /** B dalgası / S12 (K-2.1.12c): bilgi amaçlı — "koli". Hesaba katılmaz. */
  @Column({ name: 'sales_unit', length: 20, nullable: true })
  salesUnit?: string;

  /** B dalgası / S12 (K-2.1.12c, K-2.1.12d): koli → adet, varsayılan 1. */
  @Column({
    name: 'conversion_factor',
    type: 'decimal',
    precision: 9,
    scale: 4,
    default: 1,
  })
  conversionFactor!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => GenericUnit, (gu) => gu.skus)
  @JoinColumn({ name: 'gu_id' })
  genericUnit!: GenericUnit;

  @ManyToOne(() => ForecastingUnit, (fu) => fu.skus, { nullable: true })
  @JoinColumn({ name: 'fu_id' })
  forecastingUnit?: ForecastingUnit;
}

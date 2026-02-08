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

  @Column({ name: 'unit_price', type: 'decimal', precision: 18, scale: 4, nullable: true })
  unitPrice?: number;

  @Column({ name: 'cogs', type: 'decimal', precision: 18, scale: 4, nullable: true })
  cogs?: number; // Cost of Goods Sold

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  @Column({ name: 'unit_of_measure', length: 20, nullable: true })
  unitOfMeasure?: string; // "EA", "CS", "KG", "LT"

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

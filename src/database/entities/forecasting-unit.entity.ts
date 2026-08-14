import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { GenericUnit } from './generic-unit.entity';
import { Sku } from './sku.entity';
import { UnitPriceTransformer } from '../transformers/decimal.transformer';

@Entity({ name: 'forecasting_units', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['guId'])
export class ForecastingUnit extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'gu_id', type: 'uuid' })
  guId!: string;

  @Column({ length: 20, nullable: true })
  size?: string; // e.g., "500ml"

  @Column({ length: 50, nullable: true })
  segment?: string; // "Premium", "Mass", etc.

  @Column({ name: 'is_plannable', type: 'boolean', default: true })
  isPlannable!: boolean;

  // ⛔ Transformer YOK — bilerek. Ne para ne birim fiyat: hacim (K-2.1.12a).
  // İki transformer kararının kapsamı dışında (T-197/T-221 ikinci yarı).
  @Column({
    name: 'default_base_volume',
    type: 'decimal',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  defaultBaseVolume?: number; // Historical baseline for planning

  @Column({
    name: 'base_price',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
    transformer: UnitPriceTransformer,
  })
  basePrice?: number;

  @Column({ length: 3, default: 'TRY' })
  currency!: string;

  @Column({ name: 'unit_of_measure', length: 20, nullable: true })
  unitOfMeasure?: string; // "EA", "CS", "KG", "LT"

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => GenericUnit, (gu) => gu.forecastingUnits)
  @JoinColumn({ name: 'gu_id' })
  genericUnit!: GenericUnit;

  @OneToMany(() => Sku, (sku) => sku.forecastingUnit)
  skus!: Sku[];
}

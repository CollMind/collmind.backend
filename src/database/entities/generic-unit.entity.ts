import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from './base.entity';
import { Brand } from './brand.entity';
import { Category } from './category.entity';
import { ForecastingUnit } from './forecasting-unit.entity';
import { Sku } from './sku.entity';

@Entity({ name: 'generic_units', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['brandId'])
@Index(['categoryId'])
export class GenericUnit extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'brand_id', type: 'uuid' })
  brandId!: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Brand, (brand) => brand.genericUnits)
  @JoinColumn({ name: 'brand_id' })
  brand!: Brand;

  @ManyToOne(() => Category, (category) => category.genericUnits)
  @JoinColumn({ name: 'category_id' })
  category!: Category;

  @OneToMany(() => ForecastingUnit, (fu) => fu.genericUnit)
  forecastingUnits!: ForecastingUnit[];

  @OneToMany(() => Sku, (sku) => sku.genericUnit)
  skus!: Sku[];
}

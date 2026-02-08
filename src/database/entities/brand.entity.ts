import { Entity, Column, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GenericUnit } from './generic-unit.entity';

@Entity({ name: 'brands', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
export class Brand extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @OneToMany(() => GenericUnit, (gu) => gu.brand)
  genericUnits!: GenericUnit[];
}

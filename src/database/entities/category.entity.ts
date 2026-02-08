import { Entity, Column, Index, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GenericUnit } from './generic-unit.entity';

@Entity({ name: 'categories', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['parentCategoryId'])
export class Category extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'parent_category_id', type: 'uuid', nullable: true })
  parentCategoryId?: string;

  @Column({ type: 'int', default: 1 })
  level!: number; // 1=top level, 2=sub-category, etc.

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Category, (category) => category.children, { nullable: true })
  @JoinColumn({ name: 'parent_category_id' })
  parentCategory?: Category;

  @OneToMany(() => Category, (category) => category.parentCategory)
  children!: Category[];

  @OneToMany(() => GenericUnit, (gu) => gu.category)
  genericUnits!: GenericUnit[];
}

import { Entity, Column, Index, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity({ name: 'regions', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
@Index(['parentRegionId'])
export class Region extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'parent_region_id', type: 'uuid', nullable: true })
  parentRegionId?: string;

  @Column({ type: 'int', default: 1 })
  level!: number; // 1=country, 2=region, 3=city, etc.

  @Column({ length: 100, nullable: true })
  country?: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // Relations
  @ManyToOne(() => Region, (region) => region.children, { nullable: true })
  @JoinColumn({ name: 'parent_region_id' })
  parentRegion?: Region;

  @OneToMany(() => Region, (region) => region.parentRegion)
  children!: Region[];
}

import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity({ name: 'channels', schema: 'main' })
@Index(['tenantId', 'code'], { unique: true })
export class Channel extends BaseEntity {
  @Column({ length: 50 })
  code!: string;

  @Column({ length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ length: 50, nullable: true })
  subchannel?: string; // Optional: "Premium", "Mass"

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number; // For display ordering

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}

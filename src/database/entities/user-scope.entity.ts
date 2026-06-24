import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Cpl } from './cpl.entity';
import { Category } from './category.entity';

/**
 * User Scope Entity
 *
 * Maps users to their authorized CPLs and Categories
 * Rule: Planner → sadece yetkili CPL + Category görür
 */
@Entity({ name: 'user_scopes', schema: 'main' })
@Index(['userId', 'cplId', 'categoryId'], { unique: true })
@Index(['userId'])
export class UserScope extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'cpl_id', type: 'uuid', nullable: true })
  cplId?: string; // If null, user has access to all CPLs in their channel

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId?: string; // If null, user has access to all categories

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string; // Optional: can restrict to specific channel

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // Relations
  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Cpl, { nullable: true })
  @JoinColumn({ name: 'cpl_id' })
  cpl?: Cpl;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category?: Category;
}

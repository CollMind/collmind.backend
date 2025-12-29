import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  async findByEmail(tenantId: string, email: string): Promise<User | null> {
    return this.repository.findOne({
      where: { tenantId, email },
    });
  }

  async findByEmailWithoutTenant(email: string): Promise<User | null> {
    return this.repository.findOne({
      where: { email },
    });
  }

  async findById(tenantId: string, id: string): Promise<User | null> {
    return this.repository.findOne({
      where: { tenantId, id },
    });
  }

  async findOne(options: any): Promise<User | null> {
    return this.repository.findOne(options);
  }

  async findAllByTenant(tenantId: string): Promise<User[]> {
    return this.repository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByRole(tenantId: string, role: string): Promise<User[]> {
    return this.repository.find({
      where: { tenantId, role: role as any },
    });
  }

  create(entity: Partial<User>): User {
    return this.repository.create(entity);
  }

  async save(entity: User): Promise<User> {
    return this.repository.save(entity);
  }

  async softRemove(entity: User): Promise<User> {
    return this.repository.softRemove(entity);
  }
}


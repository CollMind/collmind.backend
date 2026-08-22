import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CommonModule } from '../../common/common.module';
import { UserController } from './user.controller';
import { AuthController } from './auth.controller';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../../database/entities/user.entity';
import { UserScope } from '../../database/entities/user-scope.entity';
import { Cpl } from '../../database/entities/cpl.entity';
import { Category } from '../../database/entities/category.entity';
import { AccessScopeModule } from '../shared/access-scope/access-scope.module';

@Module({
  imports: [
    // T-241: UserScope (user.service.ts#create, dataSource.transaction içinde
    // manager.getRepository(UserScope) ile yazılıyor — modülün gerçek
    // bağımlılığını burada da açık tutmak için forFeature'a eklendi),
    // Cpl/Category (scope referanslarının tenant-aidiyet kontrolü,
    // @InjectRepository ile doğrudan kullanılıyor).
    // T-253: Plan/Agreement/BudgetEnvelope buradan kaldırıldı — yalnız
    // silinen `getDashboardSummary` onları kullanıyordu (0 başka tüketici,
    // ölçüldü).
    TypeOrmModule.forFeature([User, UserScope, Cpl, Category]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION') || '1h',
        },
      }),
      inject: [ConfigService],
    }),
    // T-244: UserService now writes SCOPE_UPDATE audit rows via
    // AdminAuditService (CommonModule) — atomically, inside the same
    // dataSource.transaction as the user + user_scopes writes.
    CommonModule,
    // m1 (T-242a code-review, 2026-08-20): UserService#updateScope
    // AccessScopeService.clearCache()'i çağırıyor — REVOKE_ALL sonrası
    // kaldırılmış bir kapsamın 5sn TTL boyunca fail-open kalmasını
    // önlemek için. Döngüsel bağımlılık YOK: AccessScopeModule yalnız
    // TypeOrmModule'e bağımlı, UserModule'e bağımlı değil (ölçüldü,
    // access-scope.module.ts).
    AccessScopeModule,
  ],
  controllers: [UserController, AuthController],
  providers: [UserService, UserRepository, JwtStrategy],
  exports: [UserService, UserRepository],
})
export class UserModule {}

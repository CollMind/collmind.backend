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
import { Plan } from '../../database/entities/plan.entity';
import { Agreement } from '../../database/entities/agreement.entity';
import { BudgetEnvelope } from '../../database/entities/budget-envelope.entity';
import { UserScope } from '../../database/entities/user-scope.entity';
import { Cpl } from '../../database/entities/cpl.entity';
import { Category } from '../../database/entities/category.entity';

@Module({
  imports: [
    // T-241: UserScope (user.service.ts#create, dataSource.transaction içinde
    // manager.getRepository(UserScope) ile yazılıyor — modülün gerçek
    // bağımlılığını burada da açık tutmak için forFeature'a eklendi),
    // Cpl/Category (scope referanslarının tenant-aidiyet kontrolü,
    // @InjectRepository ile doğrudan kullanılıyor).
    TypeOrmModule.forFeature([
      User,
      Plan,
      Agreement,
      BudgetEnvelope,
      UserScope,
      Cpl,
      Category,
    ]),
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
  ],
  controllers: [UserController, AuthController],
  providers: [UserService, UserRepository, JwtStrategy],
  exports: [UserService, UserRepository],
})
export class UserModule {}

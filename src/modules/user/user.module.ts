import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserController } from './user.controller';
import { AuthController } from './auth.controller';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../../database/entities/user.entity';
import { Plan } from '../../database/entities/plan.entity';
import { Agreement } from '../../database/entities/agreement.entity';
import { BudgetEnvelope } from '../../database/entities/budget-envelope.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Plan, Agreement, BudgetEnvelope]),
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
  ],
  controllers: [UserController, AuthController],
  providers: [UserService, UserRepository, JwtStrategy],
  exports: [UserService, UserRepository],
})
export class UserModule {}


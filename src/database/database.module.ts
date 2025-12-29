import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SnakeCaseNamingStrategy } from './strategies/snake-case-naming.strategy';
import { User } from './entities/user.entity';
import { Tenant } from './entities/tenant.entity';
import { Customer } from './entities/customer.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        schema: configService.get('DB_SCHEMA') || 'main',
        entities: [User, Tenant, Customer],
        synchronize: false,
        logging: configService.get('NODE_ENV') === 'development',
        namingStrategy: new SnakeCaseNamingStrategy(),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}



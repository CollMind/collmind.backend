import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SnakeCaseNamingStrategy } from './strategies/snake-case-naming.strategy';
// T-224: entity listesi artık TEK KAYNAK — `typeorm.config.ts`'in ihraç ettiği
// `ALL_ENTITIES`. Önceden burada ayrı, elle tutulan bir ikinci liste vardı;
// `B` dalgası (T-219) yalnız `typeorm.config.ts`'i güncelledi, bu dosyayı
// unuttu, ve 17/17 e2e dosyası bootstrap'ta düştü (`İlke 4`: aynı yeteneğin
// iki listesi, biri karanlıkta). Artık ikinci liste yok — bu dosya kendi
// entity import'unu tutmaz.
import { ALL_ENTITIES } from '../config/typeorm.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dbConfig = {
          type: 'postgres' as const,
          host: configService.get('DB_HOST'),
          port: parseInt(configService.get('DB_PORT') || '5432', 10),
          username: configService.get('DB_USERNAME'),
          password: configService.get('DB_PASSWORD'),
          database: configService.get('DB_DATABASE'),
          schema: configService.get('DB_SCHEMA') || 'main',
          // Retry mechanism for Cloud Run (VPC connections can be slow)
          retryAttempts: 5,
          retryDelay: 3000, // 3 seconds between retries
          // Connection pool settings for Cloud Run
          extra: {
            max: 10, // Maximum number of connections in the pool
            connectionTimeoutMillis: 60000, // 60 seconds timeout (increased for VPC)
            idleTimeoutMillis: 30000,
            statement_timeout: 30000,
          },
        };

        console.log('Database configuration:', {
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          schema: dbConfig.schema,
          username: dbConfig.username,
        });

        return {
          ...dbConfig,
          entities: ALL_ENTITIES,
          synchronize: false,
          logging: configService.get('NODE_ENV') === 'development',
          namingStrategy: new SnakeCaseNamingStrategy(),
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}

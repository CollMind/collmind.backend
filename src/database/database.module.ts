import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SnakeCaseNamingStrategy } from './strategies/snake-case-naming.strategy';
// T-224: entity listesi artık TEK KAYNAK — `ALL_ENTITIES`. Önceden burada
// ayrı, elle tutulan bir ikinci liste vardı; `B` dalgası (T-219) yalnız
// `typeorm.config.ts`'i güncelledi, bu dosyayı unuttu, ve 17/17 e2e dosyası
// bootstrap'ta düştü (`İlke 4`: aynı yeteneğin iki listesi, biri karanlıkta).
// Artık ikinci liste yok — bu dosya kendi entity import'unu tutmaz.
//
// K-2.6.13(B4): kaynak `../config/typeorm.config.ts` DEĞİL, doğrudan
// `./entities/all-entities.ts`. `typeorm.config.ts` modül seviyesinde
// CLI/seed'in DDL-yetkili rol kimliğini eksikse durdurmak için bir
// kimlik-çözümleme çağrısı çalıştırır; bu dosyadan import etmek, RUNTIME
// sürecini (NestJS uygulaması) yalnız kendi DML rolünü kullanırken o
// DDL-yetkili kimlik bilgilerini de ortamında taşımaya ZORLUYORDU — ölçüldü
// (K-2.6.13(B4) task raporu, ampirik komut + çıktı orada). `all-entities.ts`
// yan etkisiz; bu satır artık o yan etkiyi tetiklemiyor.
//
// ⚠️ Bu dosyaya (K-2.6.13d/AC#8(a) guard'ı — `db-role-sessiz-fallback.
// e2e-spec.ts`) DDL-yetkili rol/kimlik adlarını LİTERAL olarak YAZMA —
// guard `src/` içindeki dosyaları bu desenler için tarar ve yalnız dört
// dosyaya izin verir (bu dosya ONLARDAN biri DEĞİL). Yukarıdaki paragraf
// bilerek o desenleri kullanmıyor.
import { ALL_ENTITIES } from './entities/all-entities';
import { runtimeDbCredentials } from '../config/db-role-env';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        // K-2.6.13a/d: NestJS uygulamasının ÇALIŞMA ZAMANI bağlantısı —
        // `app_runtime` (DML, RLS'e tabi, DDL yok, tablo sahibi değil).
        // Eksik/boş kimlik bilgisi sessizce ayrıcalıklı bir role düşmez;
        // `runtimeDbCredentials()` açık hata fırlatır (bkz.
        // `src/config/db-role-env.ts`).
        const { username, password } = runtimeDbCredentials();
        const dbConfig = {
          type: 'postgres' as const,
          host: configService.get('DB_HOST'),
          port: parseInt(configService.get('DB_PORT') || '5432', 10),
          username,
          password,
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

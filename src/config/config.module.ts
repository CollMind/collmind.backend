import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // envFilePath is optional - Cloud Run sets env vars directly
      // For local development, .env file will be used if it exists
      envFilePath: process.env.NODE_ENV === 'production' ? undefined : '.env',
    }),
  ],
})
export class ConfigModule {}



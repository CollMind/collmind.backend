/**
 * E2E Test Application Bootstrap Helper
 *
 * Nest uygulamasını main.ts ile birebir aynı global pipe konfigürasyonuyla
 * başlatır. Her e2e spec dosyası bu modülü kullanarak app'i ayağa kaldırır
 * ve teardown'da kapatır.
 *
 * ValidationPipe ayarları main.ts ile birebir senkronize edilmiştir:
 *   whitelist: true
 *   forbidNonWhitelisted: true
 *   transform: true
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

let app: INestApplication;
let moduleRef: TestingModule;

export async function createTestApp(): Promise<INestApplication> {
  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();

  // main.ts ile birebir: ValidationPipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}

export async function closeTestApp(): Promise<void> {
  if (app) {
    await app.close();
  }
}

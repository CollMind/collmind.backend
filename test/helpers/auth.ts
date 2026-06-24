/**
 * E2E Auth Helper
 *
 * Seed kullanıcılarla (wella.com domain) JWT token alır ve
 * supertest request'lere eklenecek Authorization header'ı döner.
 *
 * Seed şifresi: user.seed.ts → bcrypt.hash('Collmind2026!', 10)
 *
 * Login endpoint: POST /auth/login
 * auth.controller.ts → x-tenant-id header gerekmiyor;
 *   email üzerinden tenantId otomatik çözülür (findByEmailWithoutTenant).
 */

import request from 'supertest';
import { INestApplication } from '@nestjs/common';

export const SEED_USERS = {
  ADMIN: { email: 'admin@wella.com', password: 'Collmind2026!' },
  PLANNER: { email: 'planner@wella.com', password: 'Collmind2026!' },
  MANAGER: { email: 'manager@wella.com', password: 'Collmind2026!' },
  FINANCE: { email: 'finance@wella.com', password: 'Collmind2026!' },
  FINANCE_MANAGER: {
    email: 'finance.manager@wella.com',
    password: 'Collmind2026!',
  },
  CATEGORY_MANAGER: {
    email: 'category.manager@wella.com',
    password: 'Collmind2026!',
  },
  READONLY: { email: 'readonly@wella.com', password: 'Collmind2026!' },
} as const;

export type SeedUserKey = keyof typeof SEED_USERS;

export interface LoginResult {
  accessToken: string;
  tenantId: string;
  userId: string;
  authHeader: () => { Authorization: string };
}

const tokenCache = new Map<SeedUserKey, LoginResult>();

/**
 * Seed kullanıcısı için JWT token alır.
 * Aynı oturum içinde tekrar çağrılırsa cache'den döner.
 */
export async function loginAs(
  app: INestApplication,
  role: SeedUserKey,
): Promise<LoginResult> {
  const cached = tokenCache.get(role);
  if (cached) return cached;

  const credentials = SEED_USERS[role];
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);

  const result: LoginResult = {
    accessToken: res.body.accessToken,
    tenantId: res.body.user?.tenantId,
    userId: res.body.user?.id,
    authHeader: () => ({ Authorization: `Bearer ${res.body.accessToken}` }),
  };

  tokenCache.set(role, result);
  return result;
}

/**
 * Token cache'ini temizler — her describe bloğu başında çağır.
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}

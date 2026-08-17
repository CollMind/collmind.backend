import { SetMetadata } from '@nestjs/common';

/**
 * ADIM 3 Faz A (`0072-adim3-route-yetki-olcumu.md` §0, ölçüldü 2026-08-17):
 * `JwtAuthGuard` (`src/common/guards/jwt-auth.guard.ts:19,24`) `'isPublic'`
 * metadata anahtarını Reflector ile OKUYORDU, ama repoda onu SET eden bir
 * dekoratör YOKTU (`grep -rn "isPublic\|@Public(" src` → yalnız guard'ın
 * kendi okuma satırları). Mekanizma vardı, tüketici yoktu.
 *
 * Bugün gerçekten public olan üç uç (`POST auth/login` · `POST auth/refresh` ·
 * `GET /` health check) `@UseGuards(JwtAuthGuard)` hiç TAŞIMADIKLARI için zaten
 * açıktı — bu dekoratör onların davranışını DEĞİŞTİRMİYOR, yalnız İŞARETLİYOR:
 * bir sonraki okuyucu onları `K-2.6.6` ihlali (yetkisiz erişim) sanmasın.
 *
 * ⚠️ Üç bilinçli-açık ucun ikisi (login, refresh) `JwtAuthGuard`'ı hiç
 * TAŞIMIYOR — `@Public()` orada yalnız BELGE değeri taşır, guard'ın kendisi
 * onu hiç okumaz. Sağlayacağı fark, `JwtAuthGuard`'ın Faz B'de (örn. global
 * guard'a taşınması) bu üç ucu YANLIŞLIKLA kapatmasını önlemektir.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

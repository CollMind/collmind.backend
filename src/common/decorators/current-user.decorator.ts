import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '../../database/entities/user.entity';

/**
 * `request.user`'ın GERÇEK şekli — ÖLÇÜLDÜ (T-256, 2026-08-21).
 *
 * Tek üreticisi `JwtStrategy.validate` (`src/modules/user/strategies/
 * jwt.strategy.ts`, `return { id, sub, email, role, tenantId }`). Repoda
 * `request.user`'a yazan BAŞKA bir yol yoktur — ölçüm: `grep -rn
 * "request.user = \|req.user = " src/` → 0 eşleşme, ve `find src -name
 * "*.strategy.ts"` → yalnız `jwt.strategy.ts` + `snake-case-naming.strategy.ts`
 * (ikincisi TypeORM adlandırma stratejisi, auth ile ilgisiz).
 *
 * ⚠️ `id` ve `sub` AYNI değeri (`user.id`) taşır — `sub` geriye dönük
 * uyumluluk için duruyor (`user.controller.ts` bazı yerlerde `req.user.sub`
 * okuyor). İkisi ayrışırsa bu tip yalan söyler.
 */
export interface AuthenticatedUser {
  id: string;
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string;
}

/**
 * T-256 KÖK NEDEN: bu fabrika `data`'yı HİÇ KULLANMIYORDU —
 * `return request.user` idi. Yani `@CurrentUser('id') userId: string`
 * yazan her yer string bir id değil, TÜM `request.user` OBJESİNİ alıyordu
 * ve imza yalan söylüyordu.
 *
 * Etkilenen çağrı yerleri — ÖLÇÜLDÜ (`grep -rn "@CurrentUser('" src/`,
 * yorum/test başlığı satırları elenerek): `approval.controller.ts`
 * 57/72/100/112/123 + `admin-audit.controller.ts:29` (sonuncusundaki
 * `adminId` zaten kullanılmıyor — `getAuditLogs(tenantId, undefined, …)`).
 * Argümansız `@CurrentUser()` yazan çağrı yerleri ETKİLENMEDİ.
 *
 * Düzeltme öncesi davranış — MUTASYONLA ÖLÇÜLDÜ (2026-08-21, bu gövde eski
 * hâline döndürülüp `test/approval-current-user.e2e-spec.ts` koşuldu):
 *   GET  /approvals/my-requests   → 500
 *   POST /approvals/:id/cancel    → gerçek sahip bile 403 (string !== obje)
 *   POST /approvals/:id/approve   → 500
 *   POST /approvals/:id/reject    → 500
 * Hata metni (üçünde de aynı):
 *   `QueryFailedError: invalid input syntax for type uuid: "{"id":…}"`
 *
 * ⚠️ `approve` FAIL-OPEN DEĞİLDİ — MASKELİYDİ, ve bu ayrım ölçülmeden
 * yazılamaz. Self-approval yüklemi (`request.requestedById === approverId`)
 * gerçekten hiçbir zaman `true` olmuyordu, ama istek korumayı geçtikten
 * SONRA yazma aşamasında patlıyordu (`updatedBy`/`approvedById` alanlarına
 * obje gidiyor, `uuid` kolonu reddediyor). Yani `/approvals/:id/approve`
 * üzerinden self-approval bugün de mümkün DEĞİLDİ — ikinci bir kusur
 * tarafından KAZARA kapatılmıştı. Düzeltmeden sonra `K-2.5.11`/`EA-001`
 * koruması GERÇEKTEN çalışır (davranışsal pin: yukarıdaki e2e dosyası).
 *
 * 📌 `ApprovalService.approve`'un plan/agreement iç çağrıları
 * (`agreement.service.ts:760` · `approval-workflow.service.ts:546` ·
 * `plan.service.ts:1602`) bu kusurdan HİÇ etkilenmedi — üçü de argümansız
 * `@CurrentUser()` → `user.id` ile gerçek bir string taşıyor.
 *
 * ⛔ SESSİZ SIFIR / SESSİZ UNDEFINED YASAĞI (CLAUDE.md §2.5):
 * `data` verildiğinde ve aktör kimliği çözülemediğinde `undefined`
 * DÖNÜLMEZ, açık hata fırlatılır. Gerekçe ölçülmüş bir yön farkıdır:
 * `undefined` dönmek `cancel`'da fail-closed (403) ama `approve`'da
 * FAIL-OPEN'dır — `request.requestedById === undefined` yine hiçbir zaman
 * true olmaz ve self-approval koruması yine ateşlemez. Yani sessiz
 * `undefined`, düzeltilen kusurun ta kendisini geri getirir.
 *
 * ⚠️ Argümansız `@CurrentUser()` davranışı BİLEREK değiştirilmedi:
 * `request.user` neyse o döner — kullanıcı yoksa yine `undefined`. Bu yolu
 * kullanan çağrı yerleri repodaki EZİCİ ÇOĞUNLUKTUR ve hepsi bugün doğru
 * çalışıyor; oraya bir fırlatma eklemek bu turun kapsamı değil, ve
 * regresyon riski TAM OLARAK oradadır. (Ölçüm komutu, sayı yazmak yerine:
 * `grep -rn "@CurrentUser()" src/ | wc -l`.)
 */
export function currentUserFactory(
  data: keyof AuthenticatedUser | undefined,
  ctx: ExecutionContext,
): AuthenticatedUser | AuthenticatedUser[keyof AuthenticatedUser] {
  const request = ctx.switchToHttp().getRequest();
  const user: AuthenticatedUser | undefined = request.user;

  if (data === undefined) {
    return user as AuthenticatedUser;
  }

  if (!user) {
    throw new UnauthorizedException(
      `Kimliği doğrulanmış kullanıcı bulunamadı — '${data}' çözülemiyor.`,
    );
  }

  const value = user[data];
  if (value === undefined || value === null) {
    throw new InternalServerErrorException(
      `Kimlik doğrulama bağlamında '${data}' alanı yok — JwtStrategy.validate ` +
        `ile CurrentUser sözleşmesi ayrışmış olabilir.`,
    );
  }

  return value;
}

export const CurrentUser = createParamDecorator(currentUserFactory);

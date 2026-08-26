import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CAPABILITY_KEY } from '../decorators/require-capability.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  ROLE_CAPABILITIES,
  type Capability,
} from '../authorization/capabilities';
import { UserRole } from '../../database/entities/user.entity';

/**
 * `B3` `Dalga-M` — yetenek kapısı.
 *
 * ⛔ `RolesGuard`'ın YANINA kurulur, YERİNE DEĞİL. ~~`223` rotanın çoğu bugün
 * `@Roles` taşıyor~~ ⚠️ REVİZE (`Z44 §3`, 2026-08-27): bugün **`15`** kaldı
 * (`210` rotanın `195`'i göçtü). ⛔ VE SAYI YAZMA — kanonik kaynak
 * `scripts/analysis/route-cell-map.py` çıktısıdır.
 *
 * ~~`RolesGuard`'ın kaldırılması `B4`'ün işidir ve kalan-`@Roles` listesi
 * BOŞALMADAN yapılamaz~~ — bu cümle **SİLİNMEDİ, DOĞRULANARAK REVİZE EDİLDİ**
 * (`Z44 §3`): `B` düğmesi için **HÂLÂ DOĞRU** (`RolesGuard`, `@Roles`
 * boşalmadan ölemez — pin `3` ölçtü: çıkarılırsa 15 rota yetkisiz role açılır).
 * **YANLIŞ OLAN, o cümlenin `B4`'ün TAMAMINI tarif ettiği OKUMASIYDI.**
 *
 * ⇒ `B4` = `A′ → B`, SIRALI İKİ ADIM:
 *     `A′`  default-deny İSTİSNA-LİSTEYLE iner — üç ön-şartla:
 *           (1) `@Public`/`@SelfScoped` TANINIR  (2) `@Roles` muafiyeti
 *           TÜRETİLMİŞ evrenden (elle liste DEĞİL, yüklemin kendisi)
 *           (3) kalan-`@Roles` ratchet'i açılır
 *     `B`   `RolesGuard`'ın ölümü — tetiği TARİH değil OLAY: kalan-`@Roles` = 2
 *
 * ⚠️ Ve *"liste boşalınca"* beklemesi **SAĞLANAMAZ BİR KOŞULDU**: kalan `15`'in
 * `2`'si KALICI (`Z44 §4`). Sıfır bir tarih değil, **gelmeyecek bir olaydı**.
 *
 * ⚠️ `Dalga-M` (kuruluş turu) `0` rota göçürdü — guard doğdu, hiçbir
 * controller'a takılmadı. **`W1` (2026-08-25) ilk tüketiciyi getirdi:**
 * `admin/audit-log` · `admin/audit-log/high-risk` · `notifications/:id/read`.
 * Güncel üyelik için:
 *   bash scripts/guards/route-scope.sh --list   # CAPABILITY kovası
 * (Sayı BURAYA yazılmaz — elle yazılmış her üye-sayısı bir sonraki göçte
 * yalan söyler; ölçülmüş oran bu repoda 9/9 kusurlu.)
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const required = this.reflector.getAllAndOverride<Capability>(
      CAPABILITY_KEY,
      targets,
    );

    // Yetenek bildirilmemiş → bu guard'ın konusu değil. `@Roles` taşıyan
    // rotalar buradan SESSİZCE geçer ve `RolesGuard`'a kalır: geçiş dönemi
    // boyunca iki mekanizma birlikte yaşar.
    if (!required) {
      return true;
    }

    // ⛔ ROTA BAŞINA TEK MEKANİZMA — çalışma zamanı savunması.
    // Asıl kapı statiktir (`scripts/guards/single-mechanism.sh`); bu, o kapı
    // bir şekilde atlanırsa FAIL-CLOSED davranmak için var. İki mekanizma
    // aynı rotada birbirini gevşetir; hangisinin bağladığı bir OKUMA sorusu
    // olurdu.
    const roles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      targets,
    );
    if (roles) {
      return false;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    // §2.5: bilinmeyen bir rol sessizce bir yetenek kümesine düşmez.
    // `ROLE_CAPABILITIES` her `UserRole` için tanımlı (`Record<UserRole, …>`);
    // yine de eksik bir anahtar FAIL-CLOSED okunur, boş liste sayılmaz.
    const granted = ROLE_CAPABILITIES[user.role as UserRole];
    if (!granted) {
      return false;
    }

    return granted.includes(required);
  }
}

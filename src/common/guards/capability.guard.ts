import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CAPABILITY_KEY } from '../decorators/require-capability.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SELF_SCOPED_KEY } from '../decorators/self-scoped.decorator';
import {
  ROLE_CAPABILITIES,
  type Capability,
} from '../authorization/capabilities';
import { UserRole } from '../../database/entities/user.entity';

/**
 * `B4` `A′` keskinleştirme-1 (ürün sahibi hükmü, 2026-08-27) — TANINAN
 * domain-guard kümesi. ⛔ Bu KAYNAK B'dir — `route-scope.sh`'ın
 * `KNOWN_DOMAIN_GUARDS` varsayılanı (KAYNAK A, `route-scope.sh:184`,
 * `ROUTE_SCOPE_DOMAIN_GUARDS:-ReversalGuard SettlementGuard`) ile
 * BAĞIMSIZ tutulur ve `scripts/guards/domain-guard-parity.sh` ikisini
 * ÇAKIŞTIRIR (çift-kayıt şartı — "her giriş bir karar adlandırır").
 * İSİM-TABANLI kontrol BİLİNÇLİ tercih: `common/` katmanının feature
 * guard sınıflarını (`modules/...`) İTHAL ETMESİ mimari yönü TERSİNE
 * ÇEVİRİRDİ (`common` bağımlı OLUNUR, bağımlı OLMAZ). `route-scope.awk`
 * zaten aynı ismi (statik metin) tanıyor — iki taraf da isim-tabanlı,
 * simetrik.
 */
// ⚠️ BU KONTROL `constructor.name`'e BAĞLIDIR (review `S2`, ölçüldü):
// minify sınıf adlarını değiştirirse muafiyet DÜŞER — yön GÜVENLİ
// (fail-CLOSED, `403`) ama sonuç bir ÜRETİM KESİNTİSİ olur. Bu yüzden
// `webpack.config.js`'e `optimization.minimize = false` AÇIKÇA yazıldı;
// önceden `@nestjs/cli`'nin ÖRTÜK `mode: 'none'` varsayılanına
// yaslanıyordu ve hiçbir kapı onu tutmuyordu.
const KNOWN_DOMAIN_GUARD_NAMES: readonly string[] = [
  'ReversalGuard',
  'SettlementGuard',
];

/**
 * `B3` `Dalga-M` → `A′` (`Z44 §2`, 2026-08-27) — **default-deny** yetenek kapısı.
 *
 * ⛔ Bu guard artık `@Roles`'un YANINDA yaşamıyor, `default-deny`'ın KENDİSİNİ
 * uyguluyor. `Z44 §7`'nin pinlediği sıra (mutasyon+geri-yükleme ile ölçüldü):
 *
 *   1  `@Public`          → true                            (kimliksiz açık uç)
 *   2  `@SelfScoped`      → true                            ("kayıt benim mi" yüklemi)
 *   3  yetenek VAR → rol↔yetenek eşlemesi (YETENEK BAĞLAR)
 *   4  yetenek YOK ∧ TANINAN DOMAIN-GUARD → true  ⛔ keskinleştirme-1 (`Z44`,
 *      "`DUR` ÇÖZÜLDÜ — SEÇENEK 1"): rota kendi erişimini `ReversalGuard`/
 *      `SettlementGuard` gibi bir ALAN_GUARD ile ZATEN zorluyorsa
 *      `CapabilityGuard` onun ÖNÜNE GEÇMEZ (bkz. `KNOWN_DOMAIN_GUARD_NAMES`,
 *      dosya başı — KAYNAK B, `domain-guard-parity.sh` ile KAYNAK A'ya
 *      [`route-scope.sh`] karşı çakıştırılır)
 *   4  yetenek VAR        → mevcut mantık (rol↔yetenek eşlemesi)
 *   5  yetenek YOK ∧ `@Roles` VAR → true      (MUAFİYET — kontrol `RolesGuard`'a bırakılır)
 *   6  yetenek YOK ∧ `@Roles` YOK → **false** ⛔ DEFAULT-DENY
 *
 * ⛔ MUAFİYET (adım 5) TÜRETİLMİŞ EVRENDEN gelir — elle liste DEĞİL. Yüklem
 * "`@Roles` taşıyor" MI sorusunun KENDİSİ; hiçbir rota adı burada yazılı
 * değil ve yazılmaz (`DISIPLIN`: türetilmiş > taranmış > yazılmış). Bir rota
 * `@Roles`'unu kaybederse otomatik olarak adım 6'ya düşer — bu İSTENEN
 * davranıştır (`FILTRESIZ`'e sessiz düşüş yerine `403`).
 *
 * ⚠️ TANINAN DOMAIN-GUARD (adım 3) elle-liste MUAFİYETİ ile AYNI riski
 * taşımaz gibi görünse de taşır: ratchet'ler yalnız SAYIYI tutar
 * ("yeni bir `ALAN_GUARD` rotası eklendi mi"), yeni bir guard SINIFININ
 * `KNOWN_DOMAIN_GUARD_NAMES`'e MEŞRU girip girmediğini tutmaz. Bu yüzden
 * `domain-guard-parity.sh` (çift-kayıt) VAR: `KNOWN_DOMAIN_GUARD_NAMES`
 * (KAYNAK B) ile `route-scope.sh`'ın `KNOWN_DOMAIN_GUARDS` varsayılanı
 * (KAYNAK A) birbirinden BAĞIMSIZ tutulur; ikisi UYUŞMAZSA kapı kırmızı
 * olur, guard adını ADIYLA söyleyerek — yeni bir domain-guard eklemek
 * İKİ yere birden dokunmayı, yani bir KARAR KAYDI ihtiyacını zorunlu kılar.
 *
 * ⛔ `RolesGuard`'ın ölümü (`B` düğmesi) BU TURUN İŞİ DEĞİL — kalan `@Roles`
 * `2`'ye (KALICI ikiliye) inene kadar beklenir, ve o `2` **sıfıra ASLA
 * inmez** (`Z44 §4`: `pending-approvals` · `budget-variance`, ikisi de
 * gerekçesiyle kayıtlı, koşulsuz kalıcı). ⇒ *"kalan `@Roles` sıfırlanınca"*
 * beklemesi **hiçbir zaman GERÇEKLEŞMEYECEK bir OLAYI** bekler demekti;
 * `B` bu iki satırın kendi mekanizmasına devredilmesi ya da `RolesGuard`'ın
 * dar bir artık-guard'a inmesiyle açılır — O GÜNÜN kararı, bugünün değil.
 *
 * Güncel `@Roles`/`CAPABILITY` üyeliği için (sayı BURAYA YAZILMAZ — elle
 * yazılmış her üye-sayısı bir sonraki göçte yalan söyler, ölçülmüş oran bu
 * repoda 9/9 kusurlu):
 *   bash scripts/guards/route-scope.sh          # kova özeti
 *   bash scripts/guards/roles-ratchet.sh         # kalan-@Roles büyümesin
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    // 1 — `@Public()`: kimliksiz erişime bilinçli açık uç (login/refresh/health).
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      targets,
    );
    if (isPublic) {
      return true;
    }

    // 2 — `@SelfScoped()`: "kayıt benim mi" yüklemi, bir rol kümesine bağlı
    // değil. Kimliklenmiş HER kullanıcı kendi kaydına erişir (ALAN kısıtı —
    // "neyi yazabilirim" — bu guard'ın değil, dar DTO'nun işidir, `Z26`).
    const isSelfScoped = this.reflector.getAllAndOverride<boolean>(
      SELF_SCOPED_KEY,
      targets,
    );
    if (isSelfScoped) {
      return true;
    }

    // 3 — TANINAN DOMAIN-GUARD — `Z44` keskinleştirme-1: rota zaten kendi
    // erişimini KENDİ guard'ı (ör. `SettlementGuard`, `ReversalGuard`)
    // üzerinden zorluyorsa `CapabilityGuard` onun ÖNÜNE geçip
    // default-deny ile KESMEZ. `GUARDS_METADATA` (`__guards__`) Nest'in
    // `@UseGuards(...)`'ın kendi metadata anahtarı — İKİNCİ bir statik
    // parser YAZILMADI, Nest'in KENDİ mekanizması okunuyor. Sınıf VE rota
    // seviyesi `getAllAndMerge` ile BİRLEŞTİRİLİR (route-scope.awk'ın
    // cg/rg birleşimiyle AYNI ilke).
    // `Function` tipi `ban-types` tarafından yasak — çağrılabilir HERHANGİ
    // bir şeyi kabul eder, tip güvenliği sağlamaz. `@UseGuards`'ın kendisi
    // yalnız SINIF (constructor) kabul eder; `NewableFunction` bunu
    // isim-tabanlı kontrolümüzün ihtiyacı olan `.name`'i taşırken doğru
    // tipi ifade eder.
    const appliedGuards = this.reflector.getAllAndMerge<NewableFunction[]>(
      GUARDS_METADATA,
      targets,
    );
    const hasKnownDomainGuard = (appliedGuards || []).some((g) =>
      KNOWN_DOMAIN_GUARD_NAMES.includes(g.name),
    );
    // ⛔ SIRA DÜZELTİLDİ (`A′` review `B1`, 2026-08-27) — muafiyet BURADA
    // DEĞİL, `!required` dalının İÇİNDE uygulanır. Eski sıra (`return true`
    // burada) `@RequireCapability` TAŞIYAN bir rotayı da muaf yapıyordu:
    //   runtime  … → DOMAIN-GUARD → required     (muaf)
    //   statik   … → CAPABILITY   → ALAN_GUARD   (CAPABILITY kovasında)
    // İki taraf ZIT sıralıydı ⇒ `İlke-4`: aynı olgunun iki temsili, FARKLI
    // cevap. Ölçüldü (probe): `@RequireCapability(ADMIN_READ)` + tanınan
    // domain-guard taşıyan rota, `READONLY` ile bile `true` dönüyordu.
    // ⚠️ Ve sınıf seviyesine konan bir domain-guard, o dosyadaki HER rotayı
    // (yetenek taşıyanlar dahil) muaf yapardı — `docs/DISIPLIN.md`:
    // "SINIF-SEVİYESİ dekoratör, dosyadaki HER rotanın sözleşmesini
    // değiştirir". Şimdi runtime sırası statik sırayla AYNI: YETENEK BAĞLAR.
    const required = this.reflector.getAllAndOverride<Capability>(
      CAPABILITY_KEY,
      targets,
    );

    const roles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      targets,
    );

    // ⛔ ROTA BAŞINA TEK MEKANİZMA — çalışma zamanı savunması.
    // Asıl kapı statiktir (`scripts/guards/single-mechanism.sh`); bu, o kapı
    // bir şekilde atlanırsa FAIL-CLOSED davranmak için var. İki mekanizma
    // aynı rotada birbirini gevşetir; hangisinin bağladığı bir OKUMA sorusu
    // olurdu. Sıra `required` kontrolünden ÖNCE: hem `@Roles` hem yetenek
    // taşıyan bir rota, yetenek eşlemesine hiç girmeden reddedilir.
    if (required && roles) {
      return false;
    }

    if (!required) {
      // 4 — yetenek yok, ama rota kendi erişimini KENDİ domain-guard'ıyla
      // zorluyor → MUAFİYET (`Z44` keskinleştirme-1). ⛔ Yalnız BURADA:
      // yetenek VARSA yetenek bağlar (bkz. yukarıdaki `B1` notu).
      if (hasKnownDomainGuard) {
        return true;
      }
      // 5 — yetenek yok. `@Roles` taşıyorsa MUAFİYET: kontrol `RolesGuard`'a
      // bırakılır (türetilmiş evren — elle liste değil, bkz. dosya başı).
      if (roles) {
        return true;
      }
      // 6 — ne yetenek ne `@Roles` ne `@Public` ne `@SelfScoped` ne TANINAN
      // domain-guard → DEFAULT-DENY.
      return false;
    }

    // 4 — yetenek VAR: mevcut rol↔yetenek eşlemesi.
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

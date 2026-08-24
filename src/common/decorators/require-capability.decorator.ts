import { SetMetadata } from '@nestjs/common';
import type { Capability } from '../authorization/capabilities';

export const CAPABILITY_KEY = 'capability';

/**
 * `B3` — bir rotayı YETENEK ile kapılar (`@Roles`'ün yerine geçecek mekanizma).
 *
 * ⛔ ROTA BAŞINA TEK MEKANİZMA: bir rota `@Roles` VEYA `@RequireCapability`
 * taşır, **ikisini birden DEĞİL**. İkisi birden bulunursa:
 *   - çalışma zamanı: `CapabilityGuard` **fail-closed** reddeder (savunma)
 *   - statik: `scripts/guards/single-mechanism.sh` **exit 2** (asıl KAPI)
 * Sebep: iki mekanizma aynı rotada birbirini GEVŞETİR — hangisinin bağladığı
 * bir okuma sorusu olur, ve `İlke 4` (aynı olgunun iki temsili) doğar.
 *
 * ⛔ TEK YETENEK: dekoratör **bir** yetenek alır, liste değil. Liste bir
 * `union`/`intersection` sorusu açardı ve `Z18`'in reddettiği ekseni geri
 * getirirdi — *"mekanik olarak türetilmiş bir değer GEREKÇE değildir"*.
 *
 * Harita tek kaynak: `ROLE_CAPABILITIES` (`common/authorization/capabilities.ts`).
 * Bu dekoratör bir yetki HESAPLAMAZ; yalnız rotanın hangi yeteneği istediğini
 * bildirir.
 */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(CAPABILITY_KEY, capability);

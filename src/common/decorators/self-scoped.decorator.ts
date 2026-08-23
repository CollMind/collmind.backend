import { SetMetadata } from '@nestjs/common';

/**
 * `SELF` kovası — Team Lead `SELF` kararı (`Z18` dördüncü-eksen reddi +
 * `Z26`, `docs/brd-v2/04_KARAR_KAYDI.md`).
 *
 * `SELF` bir rol kovası DEĞİLDİR — bir YÜKLEM SINIFIDIR: "kayıt benim mi"
 * (`req.user.sub` == hedef kayıt). Bir `@SelfScoped()` ucu hiçbir role
 * bağlı değildir; kimliklenmiş HER kullanıcı kendi kaydına erişir.
 *
 * ⚠️ Bu dekoratör YALNIZ yüklemi işaretler ("kayıt benim mi"). `SELF`
 * sözleşmesinin ikinci parçası — "neyi yazabilirim" (ALAN) — bu
 * dekoratörün PARAMETRESİ DEĞİLDİR; DAR bir DTO (ör. `UpdateSelfDto`)
 * tarafından, TİP SİSTEMİNDE ayrıca zorlanır. `Z26`: "İki mekanizma,
 * sessizce genişleyemeyen iki ayrı yer."
 *
 * `route-scope.awk`/`route-scope.sh` bu dekoratörü DÖRDÜNCÜ bir kova
 * olarak tanır (`SELF`) — `FILTRESIZ` kovasının KONUSU DEĞİLDİR (`Z28`).
 * Guard değişikliği `self-scoped.decorator.ts` ile AYNI turda indi —
 * ayrılırsa (`v1` ölçümü, `SELF_OLCUM_RAPORU.md §4`) yeni bir `SELF` ucu
 * FILTRESIZ'e sessizce düşer ve hiçbir şey kırmızıya dönmez.
 */
export const SELF_SCOPED_KEY = 'selfScoped';
export const SelfScoped = () => SetMetadata(SELF_SCOPED_KEY, true);

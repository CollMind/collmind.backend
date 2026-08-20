import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * T-242a — `scope` bilinçli olarak DIŞLANDI (`OmitType`).
 *
 * ADIM 0 ölçümü (2026-08-20, gerçek HTTP + `user_scopes` öncesi/sonrası
 * sayımı): `UpdateUserDto` `PartialType(CreateUserDto)` üzerinden `scope`
 * alanını miras alıyordu, `forbidNonWhitelisted` onu geçiriyordu (DTO'da
 * tanımlı bir alan), `UserService#update` `Object.assign(user,
 * updateUserDto)` ile bunu `User` entity'sine yazıyordu — ama `User`
 * entity'sinde `scope` diye bir KOLON yok. Sonuç: `PATCH /users/:id`
 * `{scope:[...]}` ile çağrıldığında **200** dönüyor, yanıt gövdesi
 * `scope`'u YANKILIYOR (in-memory nesnede duruyor), ama `main.user_scopes`
 * tablosu **değişmiyor** — sessiz no-op (§2.5 sınıfı: bir `if` yazılmış,
 * `else`i yok; burada denk düşen "yazma yolu" hiç yoktu).
 *
 * Kapsam artık AYRI, DEKLARATİF bir uçtan yönetiliyor:
 * `PATCH /users/:id/scope` (`UpdateUserScopeDto`, `UserService#updateScope`,
 * `Z15` KARAR 1 — tam değiştirme, KARAR 2 — boşaltma `intent` ile).
 *
 * `scope`'u buradan (genel kullanıcı güncelleme DTO'sundan) çıkarmak sessiz
 * no-op'u AÇIK bir hataya çevirir: `forbidNonWhitelisted` açık olduğu için
 * `PATCH /users/:id` gövdesinde `scope` gönderilirse artık "bilinmeyen alan"
 * 400'ü alınır — hiçbir şey sessizce yutulmaz.
 *
 * Çapraz-repo kontrolü: frontend'in `updateUserSchema`'sı (T-243,
 * `user.schema.ts:95-102`) zaten `scope` alanı GÖNDERMİYOR — bu değişiklik
 * bugünkü frontend sözleşmesini KIRMIYOR.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['scope'] as const),
) {
  password?: string; // Exclude password from update
}

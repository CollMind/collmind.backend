import { PartialType, PickType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * `PATCH /users/me` — `Z26` kararı (`docs/brd-v2/04_KARAR_KAYDI.md`).
 *
 * `SELF` sözleşmesinin ALAN parçası: "neyi yazabilirim" sorusunun cevabı
 * bu TİPTE yaşar. Alan listesi ÖLÇÜMDEN gelir (`SELF_OLCUM_RAPORU.md §2`,
 * `PATCH /users/me` DB'ye gerçekten ULAŞAN alanlar):
 *
 *   fullName · firstName · lastName · phoneNumber · department · jobTitle
 *
 * ⛔ `role` · `status` · `mustChangePassword` · `permissions` · `email` ·
 * `password` · `scope` · `tenantId` bu tipte YOKTUR — `PATCH /users/:id`
 * (`UpdateUserDto`, `USER_MANAGE`) ile PAYLAŞILMAZ (`Z26` ⛔ SINIF KURALI:
 * "`SELF` ucu `MANAGE` ucunun DTO'sunu MİRAS ALAMAZ"). `ValidationPipe`
 * (`whitelist: true, forbidNonWhitelisted: true`, `main.ts`) bu alanların
 * DIŞINDA gönderilen HERHANGİ bir alanı `400` ile REDDEDER — sessiz
 * düşürme (eski `delete dto.role`) değil, açık hata.
 *
 * `email` de bilinçli dışlandı: `SELF_OLCUM_RAPORU.md §2` satır 1'in
 * ölçtüğü gibi `PATCH /users/me` üzerinden e-posta değişimi bugün DB'ye
 * yazıyordu; bu DTO onu artık `400` ile reddeder (alan sınırı DARALTILDI,
 * genişletilmedi — kapsam dışına çıkan bir davranış bu kararla kapanıyor).
 */
export class UpdateSelfDto extends PartialType(
  PickType(CreateUserDto, [
    'fullName',
    'firstName',
    'lastName',
    'phoneNumber',
    'department',
    'jobTitle',
  ] as const),
) {}

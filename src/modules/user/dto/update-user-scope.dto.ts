import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserScopePairDto } from './create-user.dto';

/**
 * T-242a — `PATCH /users/:id/scope`'un niyet alanı.
 *
 * `04_KARAR_KAYDI.md` `Z15` KARAR 2: boşaltma (`REVOKE_ALL`) izinli ama
 * SESSİZ olamaz — aynı uçta, `intent` ZORUNLU bir alan olarak ayrılır. Bir
 * varsayılan DEĞERİ yok (§2.5): çağıran boş bir dizi gönderip "temizledim"
 * mi "unuttum" mu demek istediğini AÇIKÇA belirtmek zorunda.
 *
 * `docs/process/DENETIM_SOZLUGU.md` Madde 1, `Z17`: bu alan kayıtta AYRI bir
 * kolon DEĞİL — `ScopeAuditActionType` (`SCOPE_UPDATE` | `SCOPE_REVOKE_ALL`)
 * olarak `ne` alanına düşer. İki tür zaten iki değer taşıyor; üçüncü bir
 * kolon hiçbir bilgi eklemez (`İlke 1`).
 */
export enum ScopeUpdateIntent {
  UPDATE = 'UPDATE',
  REVOKE_ALL = 'REVOKE_ALL',
}

/**
 * T-242a — kapsam GÜNCELLEME/BOŞALTMA gövdesi. `Z15` KARAR 1 (TAM
 * DEĞİŞTİRME): uç hedef durumu alır, ekle/çıkar delta'sı almaz. Bu yüzden
 * `scope` her zaman HEDEF kümenin TAMAMIdır — `intent=UPDATE` iken bugünkü
 * kümenin üstüne eklenmez, onun YERİNE geçer.
 *
 * `scope`'un uzunluk kısıtı (`intent=UPDATE` → ≥1, `intent=REVOKE_ALL` → 0)
 * KASITLI OLARAK DTO dekoratöründe değil, servis katmanında uygulanır —
 * `Z15` KARAR 2'nin metni doğrulamayı orada tarif ediyor ("boş küme ∧
 * intent ≠ REVOKE_ALL → RET") ve iki farklı `@ValidateIf` koşulunu aynı
 * property üzerinde güvenilir biçimde birleştirmek class-validator'da
 * kırılgan (bkz. UserService#updateScope JSDoc'u).
 */
export class UpdateUserScopeDto {
  @ApiProperty({ enum: ScopeUpdateIntent })
  @IsEnum(ScopeUpdateIntent)
  intent!: ScopeUpdateIntent;

  @ApiProperty({
    type: [UserScopePairDto],
    description:
      'HEDEF kümenin TAMAMI (ekle/çıkar değil, replace). intent=UPDATE için ' +
      'zorunlu ve boş olamaz; intent=REVOKE_ALL için boş dizi olmalıdır. ' +
      'Zorunluluk/uzunluk kuralı serviste denetlenir (UserService#updateScope).',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserScopePairDto)
  scope!: UserScopePairDto[];

  /**
   * `DENETIM_SOZLUGU.md` Madde 1: `REVOKE_ALL`'da ZORUNLU, `UPDATE`'te
   * opsiyonel — yıkıcı olan eylem gerekçe ister, olağan olan istemez
   * (`K-2.5.15` ailesiyle tutarlı, `Z15`).
   *
   * ⚠️ Bu koşullu zorunluluk BİLEREK burada bir `@ValidateIf` ile ifade
   * EDİLMEDİ: aynı property üzerinde iki farklı `@ValidateIf` koşulu
   * (REVOKE_ALL→zorunlu, UPDATE→opsiyonel) class-validator'da GÜVENİLİR
   * biçimde birleşmez — koşullardan biri diğerinin metadata'sının üstüne
   * yazabilir (ölçülmedi, ama davranış class-validator sürümüne bağlı ve
   * dokümante değil; finansal bir yolda "muhtemelen çalışır" kabul
   * edilemez, §2.5). Gerçek zorunluluk kontrolü `UserService#updateScope`
   * içinde, açık bir `if`/`throw` ile yapılır — TEK kaynak, tahmin yok.
   */
  @ApiPropertyOptional({
    description:
      'intent=REVOKE_ALL için ZORUNLU; intent=UPDATE için opsiyonel.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

import { IsEnum, IsNumber, IsOptional, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalPolicyTemplate } from '../../../../database/entities/approval-policy.entity';

/**
 * T-214 — tenant'ın onay politikası seçimini günceller.
 *
 * `K-2.5.13c`: tenant bir şablon SEÇER ve eşik değerlerini AYARLAR; kural
 * YAZAMAZ. Bu DTO bilerek yalnız `template` ve `amountThreshold` taşır —
 * `tierRoles`/`delegateAllowed` (`K-2.5.13e`'nin Faz 2 alanları) bu ucun
 * KAPSAMINDA DEĞİL. Global `ValidationPipe({ whitelist: true,
 * forbidNonWhitelisted: true })` (`main.ts`) bu iki alanı DTO'da
 * tanımlanmadıkları için zaten reddeder — burada ayrıca özel bir ret
 * mantığı YAZILMADI (ambient davranış, her uçta aynı).
 *
 * `template` VE `amountThreshold` AYNI istekte birlikte gelir — iki ayrı
 * PATCH çağrısı (önce şablon, sonra eşik) araya `CHK_approval_policies_
 * threshold_template`'i ihlal eden bir ARA DURUM sokardı.
 */
export class UpdateApprovalPolicyDto {
  @ApiProperty({
    enum: ApprovalPolicyTemplate,
    description: 'Onay şablonu (katalog: STANDARD · TWO_TIER · THRESHOLD)',
  })
  @IsEnum(ApprovalPolicyTemplate)
  template!: ApprovalPolicyTemplate;

  @ApiPropertyOptional({
    example: 50000,
    description:
      'Yalnız template=THRESHOLD iken ZORUNLU. Diğer şablonlarda gönderilemez ' +
      '(`CHK_approval_policies_threshold_template`, `K-2.5.13a`).',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amountThreshold?: number;
}

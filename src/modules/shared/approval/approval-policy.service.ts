import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApprovalPolicyRepository } from './approval-policy.repository';
import { UpdateApprovalPolicyDto } from './dto';
import {
  ApprovalPolicy,
  ApprovalPolicyTemplate,
} from '../../../database/entities/approval-policy.entity';

/**
 * T-214 — `approval_policies` yazma yolu.
 *
 * Karar (`K-2.5.13c`, ürün sahibi 2026-08-16, `T-214.md`): model DEĞİŞMEDİ.
 * Katalog = enum (kod), seçim + parametre = satır (veri, tenant başına).
 * Eksik olan tek şey buydu: tenant'ın şablonu VE eşiği AYNI ANDA yazdığı
 * bir uç. İki ayrı çağrı (önce şablon, sonra eşik) araya
 * `CHK_approval_policies_threshold_template`'i ihlal eden bir ARA DURUM
 * sokardı — bu yüzden tek metod, tek DB yazması.
 */
@Injectable()
export class ApprovalPolicyService {
  constructor(private readonly policyRepo: ApprovalPolicyRepository) {}

  async findOne(id: string, tenantId: string): Promise<ApprovalPolicy> {
    const policy = await this.policyRepo.findById(id, tenantId);
    if (!policy) {
      throw new NotFoundException('Onay politikası bulunamadı');
    }
    return policy;
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdateApprovalPolicyDto,
    updatedBy: string,
  ): Promise<ApprovalPolicy> {
    // Satırın var olduğunu ve bu tenant'a ait olduğunu doğrula (404) —
    // tenant izolasyonu burada da korunur, findById tenantId ile filtreler.
    await this.findOne(id, tenantId);

    // §2.5 "önce doğrula, sonra yaz": `CHK_approval_policies_threshold_
    // template`'in DB'de reddedeceği her girdi, burada AÇIK ve anlaşılır
    // bir 400'e çevrilir. CHECK bir arka duvar olarak kalır — tek savunma
    // değil (bkz. wrapCheckViolation).
    const amountThreshold = this.resolveAmountThreshold(dto);

    try {
      return await this.policyRepo.updatePolicySelection(id, tenantId, {
        template: dto.template,
        amountThreshold,
        updatedBy,
      });
    } catch (err) {
      throw this.wrapCheckViolation(err);
    }
  }

  /**
   * `K-2.5.13a`: yalnız THRESHOLD şablonu bir tutar eşiği taşır/gerektirir.
   * `CHK_approval_policies_threshold_template` tam bunu zorluyor:
   *   (template = 'THRESHOLD' AND amount_threshold IS NOT NULL)
   *   OR (template <> 'THRESHOLD' AND amount_threshold IS NULL)
   *
   * Sessiz varsayılan / sessiz yok sayma YOK (`§2.5`): THRESHOLD eşiksiz
   * gelirse reddedilir (eşik uydurulmaz); THRESHOLD-olmayan bir şablona eşik
   * gönderilirse de reddedilir (ürün sahibi kararı — sessizce yok saymak,
   * kullanıcının girdiği bir değerin kaybolması demektir).
   */
  private resolveAmountThreshold(dto: UpdateApprovalPolicyDto): number | null {
    const isThreshold = dto.template === ApprovalPolicyTemplate.THRESHOLD;
    const hasAmount =
      dto.amountThreshold !== undefined && dto.amountThreshold !== null;

    if (isThreshold && !hasAmount) {
      throw new BadRequestException(
        'THRESHOLD (EŞİKLİ) şablonu bir tutar eşiği (amountThreshold) ' +
          'gerektirir. Eşik tenant tarafından ayarlanır, varsayılan yoktur ' +
          '(K-2.5.13c).',
      );
    }

    if (!isThreshold && hasAmount) {
      throw new BadRequestException(
        `amountThreshold yalnız template=THRESHOLD iken kabul edilir. ` +
          `'${dto.template}' şablonu bir eşik taşımaz (K-2.5.13a).`,
      );
    }

    return isThreshold ? (dto.amountThreshold as number) : null;
  }

  /**
   * Birincil savunma `resolveAmountThreshold` — bu yalnız bir arka duvar.
   * DB'den `23514` (check_violation) gelirse ham `QueryFailedError`
   * kullanıcıya 500 olarak dönmemeli.
   */
  private wrapCheckViolation(err: unknown): unknown {
    const code =
      (err as { code?: string; driverError?: { code?: string } })?.code ??
      (err as { driverError?: { code?: string } })?.driverError?.code;
    if (code === '23514') {
      return new BadRequestException(
        'Onay politikası kısıtı ihlal edildi: şablon ve tutar eşiği ' +
          'tutarsız (THRESHOLD -> eşik zorunlu; diğer şablonlar -> eşik ' +
          'kabul etmez).',
      );
    }
    return err;
  }
}

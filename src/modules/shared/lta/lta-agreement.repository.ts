import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LTAAgreement,
  LTAAgreementStatus,
} from '../../../database/entities/lta-agreement.entity';

@Injectable()
export class LTAAgreementRepository {
  constructor(
    @InjectRepository(LTAAgreement)
    private readonly repository: Repository<LTAAgreement>,
  ) {}

  async findByCode(
    tenantId: string,
    agreementCode: string,
  ): Promise<LTAAgreement | null> {
    return this.repository.findOne({
      where: { tenantId, agreementCode },
      relations: [
        'cpl',
        'rates',
        'rates.channelEntity',
        'rates.categoryEntity',
      ],
    });
  }

  async findById(tenantId: string, id: string): Promise<LTAAgreement | null> {
    return this.repository.findOne({
      where: { tenantId, id },
      relations: [
        'cpl',
        'rates',
        'rates.channelEntity',
        'rates.categoryEntity',
        'planOverrides',
      ],
    });
  }

  async findAllByTenant(
    tenantId: string,
    status?: LTAAgreementStatus,
  ): Promise<LTAAgreement[]> {
    const where: any = { tenantId };
    if (status) {
      where.status = status;
    }
    return this.repository.find({
      where,
      relations: ['cpl', 'rates'],
      order: { effectiveDate: 'DESC' },
    });
  }

  async findActiveForCPL(
    tenantId: string,
    cplId: string,
    date: Date,
  ): Promise<LTAAgreement | null> {
    return (
      this.repository
        .createQueryBuilder('lta')
        .where('lta.tenantId = :tenantId', { tenantId })
        .andWhere('lta.cplId = :cplId', { cplId })
        .andWhere('lta.status = :status', { status: LTAAgreementStatus.ACTIVE })
        .andWhere('lta.effectiveDate <= :date', { date })
        .andWhere('(lta.expiryDate IS NULL OR lta.expiryDate >= :date)', {
          date,
        })
        .leftJoinAndSelect('lta.cpl', 'cpl')
        .leftJoinAndSelect('lta.rates', 'rates')
        .leftJoinAndSelect('rates.channelEntity', 'channelEntity')
        .leftJoinAndSelect('rates.categoryEntity', 'categoryEntity')
        // T-269 Kusur 2: bu join YOKTU — `lta-agreement.service.ts:420`in
        // `agreement.planOverrides` kontrolü HER ZAMAN undefined'a düşüyordu,
        // yani plan bazlı müzakere edilmiş LTA oranı sessizce yok sayılıp
        // varsayılan orana çöküyordu (`getLTAForPlanContext` bu metottan
        // besleniyor). GRANT (bkz. 02-runtime-grants.sql) ile AYNI TURDA —
        // yalnız GRANT verilseydi bu dal yine hiç ateşlemezdi (sessiz kusur
        // örtülü kalırdı); yalnız join eklenseydi bu sorgu YENİ bir 500
        // verirdi (`lta_plan_overrides` SELECT'i app_runtime'da yoktu).
        .leftJoinAndSelect('lta.planOverrides', 'planOverrides')
        .orderBy('lta.effectiveDate', 'DESC')
        .getOne()
    );
  }

  async findOverlappingAgreements(
    tenantId: string,
    cplId: string,
    effectiveDate: Date,
    expiryDate: Date | null,
    excludeId?: string,
  ): Promise<LTAAgreement[]> {
    const query = this.repository
      .createQueryBuilder('lta')
      .where('lta.tenantId = :tenantId', { tenantId })
      .andWhere('lta.cplId = :cplId', { cplId })
      .andWhere('lta.status != :terminated', {
        terminated: LTAAgreementStatus.TERMINATED,
      })
      .andWhere(
        // T-271 Kusur 4 — `:expiryDate`'in İLK kullanımı `IS NOT NULL`
        // içindeydi ve bu bağlam Postgres'e hiçbir tip ipucu vermiyor.
        // Extended query protocol'de (node-pg, TypeORM) client tip OID'i
        // GÖNDERMEZ — Postgres'in "could not determine data type of
        // parameter $5" ile HER ZAMAN düşmesine yol açıyordu (boş VE dolu
        // `expiryDate` ile aynı hata, ölçüldü). `::date` cast'i (kolon
        // tipiyle BİREBİR — `lta_agreements.expiry_date` `date`) ilk
        // kullanıma tip bağlıyor; sonraki `:expiryDate` kullanımları zaten
        // `date` kolonlarıyla karşılaştırıldığı için ayrıca cast GEREKMEZ,
        // ama ikinci `IS NOT NULL` kullanımı da aynı riski taşıdığı için
        // (aynı kalıp, aynı sınıf) o da cast'lendi.
        `(
          (lta.effectiveDate <= :effectiveDate AND (lta.expiryDate IS NULL OR lta.expiryDate >= :effectiveDate))
          OR
          (:expiryDate::date IS NOT NULL AND lta.effectiveDate <= :expiryDate AND (lta.expiryDate IS NULL OR lta.expiryDate >= :expiryDate))
          OR
          (lta.effectiveDate >= :effectiveDate AND (lta.expiryDate IS NULL OR (:expiryDate::date IS NOT NULL AND lta.expiryDate <= :expiryDate)))
        )`,
        { effectiveDate, expiryDate },
      );

    if (excludeId) {
      query.andWhere('lta.id != :excludeId', { excludeId });
    }

    return query.getMany();
  }

  create(entity: Partial<LTAAgreement>): LTAAgreement {
    return this.repository.create(entity);
  }

  async save(entity: LTAAgreement): Promise<LTAAgreement> {
    return this.repository.save(entity);
  }

  async softRemove(entity: LTAAgreement): Promise<LTAAgreement> {
    return this.repository.softRemove(entity);
  }
}

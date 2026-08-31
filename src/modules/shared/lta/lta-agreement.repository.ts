import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LTAAgreement,
  LTAAgreementStatus,
} from '../../../database/entities/lta-agreement.entity';
import {
  AgreementStatus,
  IN_FORCE_AGREEMENT_STATES,
} from '../../../database/entities/agreement.entity';

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
    // [[T-336]] `Q22` — "BİR EBEVEYN = BİR BAŞLIK, ÖMÜR BOYU": DB tarafı
    // (`@Index(['tenantId','agreementCode'], { unique: true })`,
    // migration `1817000000000`) KISMİ DEĞİL — `deleted_at` predicate'i
    // YOK, yani soft-delete edilmiş bir satır kodu İŞGAL ETMEYE devam
    // eder. `withDeleted: true` OLMADAN bu kontrol soft-delete edilmiş bir
    // çakışmayı GÖRMEZ ve `save()` ham `QueryFailedError`'a (23505) düşüp
    // `500` döner — kullanıcıya NEDEN çarptığını söylemeyen bir hata.
    return this.repository.findOne({
      where: { tenantId, agreementCode },
      withDeleted: true,
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
        // ── [[T-335]] · `Z38 §3(a)` — EBEVEYN DURUM KAPISI ────────────────
        // `Z38 §3(a)` bağa şunu yüklemişti: *"`agreements` = onay · audit ·
        // SoD · defter bağının KANONİK YERİ"*. Bağ `1817` ile kuruldu, ama
        // o kaydın ONAY DURUMUNU okuyan HİÇBİR YOL yoktu: bu sorgu yalnız
        // `lta.status='active'` filtreliyordu ve `agreements`'a JOIN'i
        // YOKTU. Sonuç, canlı olarak ölçüldü (e2e reprodüksiyon,
        // `lta-parent-lifecycle-status-gate.e2e-spec.ts`, düzeltmeden
        // ÖNCE): HİÇ ONAYA SUNULMAMIŞ (`DRAFT`) bir yaşam döngüsü kaydının
        // %9'luk oran kademesi `BASE_LTA_ON`'a iniyordu (`7368.30`,
        // beklenen `0`) — yani onaysız bir indirim planlama motorunda
        // uygulanıyordu. *"Mekanizma var, ona giden yol yok"* sınıfının
        // OKUMA tarafı.
        //
        // Küme gerekçesi ve DÖRT kardeş implementasyonun neden
        // birleştirilmediği: `IN_FORCE_AGREEMENT_STATES` (agreement.entity.ts).
        //
        // ⚠️ `innerJoin` BİLEREK (`leftJoin` değil): `agreement_id` `NOT NULL`
        // + FK `RESTRICT` (`1817`) ⇒ ebeveynsiz satır YAPISAL OLARAK
        // imkânsız, ve ebeveyn bir şekilde okunamıyorsa sorgu FAIL-CLOSED
        // olmalı (oran inmez), fail-open değil (`§2.5`).
        .innerJoin('lta.agreement', 'parentAgreement')
        .andWhere('parentAgreement.tenantId = :tenantId', { tenantId })
        // ⚠️ `deletedAt` AÇIKÇA yazılıyor — TypeORM'un `innerJoin`'e
        // soft-delete şartını kendiliğinden eklediğine GÜVENİLMİYOR
        // (ölçülmedi ⇒ varsayılmaz). Silinmiş bir yaşam döngüsü kaydının
        // oranı da inmemeli; `if` yazıp `else` bırakmama disiplini.
        .andWhere('parentAgreement.deletedAt IS NULL')
        .andWhere('parentAgreement.status IN (:...inForceStatuses)', {
          inForceStatuses: IN_FORCE_AGREEMENT_STATES as AgreementStatus[],
        })
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

import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BudgetTierNotificationService } from './budget-tier-notification.service';
import {
  BudgetEnvelope,
  BudgetEnvelopeNotifiedTier,
} from '../../../database/entities/budget-envelope.entity';
import { BudgetSummaryView } from '../../../database/entities/budget-summary.view-entity';
import { BudgetPolicyService } from './budget-policy.service';
import { NotificationService } from '../../notification/notification.service';
import { NotificationType } from '../../../database/entities/notification.entity';
import { UserRepository } from '../../user/user.repository';
import { UserRole } from '../../../database/entities/user.entity';

/**
 * `T-319` — `P1` (ilişki-pini) `P2` (şablon) `P3` (tekrar-bastırma)
 * `P4a` (sessiz-düşme yasağı) `P4a-owner-fallback` (görünür fallback).
 *
 * `P4b` (bildirim-yolu-canlılığı, UÇTAN UCA/mock'suz) bu dosyanın
 * KAPSAMI DIŞINDA — bkz. `test/budget-tier-notification.e2e-spec.ts`.
 *
 * Kaynak: `Z56 §4` · `Z57` · `Z59` (`docs/brd-v2/04_KARAR_KAYDI.md`).
 */
describe('BudgetTierNotificationService', () => {
  const TENANT_ID = 'tenant-001';
  const ENVELOPE_ID = 'env-001';

  let service: BudgetTierNotificationService;
  let envelopeRepo: { findOne: jest.Mock; update: jest.Mock };
  let summaryRepo: { findOne: jest.Mock };
  let dataSource: { getRepository: jest.Mock };
  let policyService: { resolvePolicy: jest.Mock };
  let notificationService: { createNotification: jest.Mock };
  let userRepository: { findById: jest.Mock; findByRole: jest.Mock };

  function buildEnvelope(
    overrides: Partial<BudgetEnvelope> = {},
  ): BudgetEnvelope {
    return {
      id: ENVELOPE_ID,
      tenantId: TENANT_ID,
      code: 'ENV-TEST',
      name: 'Test Envelope',
      budgetOwnerId: 'owner-001',
      budgetOwnerName: 'Owner One',
      lastNotifiedTier: BudgetEnvelopeNotifiedTier.NONE,
      ...overrides,
    } as BudgetEnvelope;
  }

  function buildSummary(utilizationPct: number): BudgetSummaryView {
    return {
      envelopeId: ENVELOPE_ID,
      tenantId: TENANT_ID,
      allocatedAmount: 1000,
      consumedAmount: 0,
      reservedAmount: 0,
      availableAmount: 1000,
      utilizationPct,
    } as unknown as BudgetSummaryView;
  }

  function buildPolicy(
    warningPct: number,
    financeReviewPct: number,
    blockPct = 100,
  ) {
    return {
      warningPct,
      financeReviewPct,
      blockPct,
      financeReviewMode: 'NOTIFY' as const,
      source: { policyId: 'policy-001', channelId: null, categoryId: null },
    };
  }

  const OWNER = {
    id: 'owner-001',
    email: 'owner@wella.com',
    fullName: 'Owner One',
  };
  const FINANCE_1 = {
    id: 'finance-001',
    email: 'finance@wella.com',
    fullName: 'Finance One',
  };
  const FINANCE_2 = {
    id: 'finance-002',
    email: 'finance.manager@wella.com',
    fullName: 'Finance Two',
  };

  beforeEach(async () => {
    envelopeRepo = { findOne: jest.fn(), update: jest.fn() };
    summaryRepo = { findOne: jest.fn() };
    dataSource = { getRepository: jest.fn().mockReturnValue(summaryRepo) };
    policyService = { resolvePolicy: jest.fn() };
    notificationService = {
      createNotification: jest.fn().mockResolvedValue([]),
    };
    userRepository = { findById: jest.fn(), findByRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetTierNotificationService,
        { provide: getRepositoryToken(BudgetEnvelope), useValue: envelopeRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: BudgetPolicyService, useValue: policyService },
        { provide: NotificationService, useValue: notificationService },
        { provide: UserRepository, useValue: userRepository },
      ],
    }).compile();

    service = module.get(BudgetTierNotificationService);
  });

  // ═══ P1 — İLİŞKİ-PİNİ (Z56 §4) ═══
  describe('P1 — ilişki-pini: eşik KONFİGÜRASYONDAN okunur, sabit değil', () => {
    it(
      'kanonik (80/90) konfigürasyonda %80 WARNING TETİKLER, %79 tetiklemez — ' +
        've eşik testte SABİT YAZILMAZ, buildPolicy() parametresinden okunur',
      async () => {
        const policy = buildPolicy(80, 90);
        policyService.resolvePolicy.mockResolvedValue(policy);
        userRepository.findById.mockResolvedValue(OWNER);

        // %79: eşiğin BİR ALTINDA — düşmemeli
        envelopeRepo.findOne.mockResolvedValueOnce(buildEnvelope());
        summaryRepo.findOne.mockResolvedValueOnce(
          buildSummary(policy.warningPct - 1),
        );
        await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);
        expect(notificationService.createNotification).not.toHaveBeenCalled();

        // eşiği GEÇER (>=) — düşmeli
        envelopeRepo.findOne.mockResolvedValueOnce(buildEnvelope());
        summaryRepo.findOne.mockResolvedValueOnce(
          buildSummary(policy.warningPct),
        );
        await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);
        expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
        expect(notificationService.createNotification).toHaveBeenCalledWith(
          TENANT_ID,
          NotificationType.BUDGET_ALERT_80,
          OWNER.id,
          OWNER.email,
          OWNER.fullName,
          expect.any(Object),
          expect.any(Array),
          undefined,
        );
      },
    );

    it(
      '⛔ POZİTİF KONTROL (Z57 §1a — canlı 50/60 vakasını HEDEFLER): eşik ' +
        'DEĞİŞTİRİLİR (85/95), pin YİNE tutar — aynı %80 bu sefer WARNING ' +
        'TETİKLEMEZ (85 altında kaldığı için), %85 tetikler. Bir DEĞER-pini ' +
        '(sabit ">= 80" bekleyen) bu ikinci ölçümde YANLIŞ-POZİTİF (ya da ' +
        'burada YANLIŞ-NEGATİF: hiç fark etmeyen bir kod, ki mutasyon kanıtı ' +
        'bunu ölçer) verirdi.',
      async () => {
        const customPolicy = buildPolicy(85, 95);
        policyService.resolvePolicy.mockResolvedValue(customPolicy);
        userRepository.findById.mockResolvedValue(OWNER);

        // %80 — kanonik dünyada WARNING tetiklerdi, bu (85/95) dünyasında
        // eşiğin ALTINDA kalıyor.
        envelopeRepo.findOne.mockResolvedValueOnce(buildEnvelope());
        summaryRepo.findOne.mockResolvedValueOnce(buildSummary(80));
        await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);
        expect(notificationService.createNotification).not.toHaveBeenCalled();

        // %85 — YENİ eşiği geçer.
        envelopeRepo.findOne.mockResolvedValueOnce(buildEnvelope());
        summaryRepo.findOne.mockResolvedValueOnce(buildSummary(85));
        await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);
        expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
      },
    );

    it(
      '⛔ POZİTİF KONTROL — canlı ölçülmüş 50/60 dünyası: %55 (kanonik ' +
        '80/90 dünyasında hiçbir kademeyi tetiklemez) bu politika altında ' +
        'WARNING tetikler (55 >= 50)',
      async () => {
        const legacyPolicy = buildPolicy(50, 60);
        policyService.resolvePolicy.mockResolvedValue(legacyPolicy);
        userRepository.findById.mockResolvedValue(OWNER);

        envelopeRepo.findOne.mockResolvedValueOnce(buildEnvelope());
        summaryRepo.findOne.mockResolvedValueOnce(buildSummary(55));
        await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);

        expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
        expect(notificationService.createNotification).toHaveBeenCalledWith(
          TENANT_ID,
          NotificationType.BUDGET_ALERT_80,
          OWNER.id,
          OWNER.email,
          OWNER.fullName,
          expect.any(Object),
          expect.any(Array),
          undefined,
        );
      },
    );
  });

  // ═══ P2 — aynı desen, her olayda (WARNING VE FINANCE_REVIEW) ═══
  describe('P2 — şablon: %80 ve %90 AYNI ŞEKİLDE pinlenir', () => {
    it.each([
      {
        label: 'WARNING (%80)',
        pct: 80,
        expectedType: NotificationType.BUDGET_ALERT_80,
      },
      {
        label: 'FINANCE_REVIEW (%90)',
        pct: 90,
        expectedType: NotificationType.BUDGET_FINANCE_REVIEW,
      },
    ])(
      '$label: eşiği GEÇEN yüzde kendi bildirim tipini KONFİGÜRASYONDAN ' +
        'okunan eşikle tetikler',
      async ({ pct, expectedType }) => {
        const policy = buildPolicy(80, 90);
        policyService.resolvePolicy.mockResolvedValue(policy);
        userRepository.findById.mockResolvedValue(OWNER);
        userRepository.findByRole.mockResolvedValue([FINANCE_1, FINANCE_2]);

        envelopeRepo.findOne.mockResolvedValueOnce(buildEnvelope());
        summaryRepo.findOne.mockResolvedValueOnce(buildSummary(pct));
        await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);

        const calledTypes =
          notificationService.createNotification.mock.calls.map(
            (call: unknown[]) => call[1],
          );
        expect(calledTypes).toContain(expectedType);
      },
    );
  });

  // ═══ P3 — TEKRAR-BASTIRMA ("olay bir GEÇİŞTİR, durum değil") ═══
  describe('P3 — tekrar-bastırma', () => {
    // Tek FINANCE kullanıcısı — P3'ün saydığı şey "bildirim OLAYI"dır
    // (bir tetiklemenin kaç alıcıya fan-out ettiği P2/fallback testlerinde
    // ayrıca pinli), burada bire bir tutması için alıcı kümesi TEKİL.
    beforeEach(() => {
      policyService.resolvePolicy.mockResolvedValue(buildPolicy(80, 90));
      userRepository.findById.mockResolvedValue(OWNER);
      userRepository.findByRole.mockResolvedValue([FINANCE_1]);
    });

    it('%89 → %91 ⇒ BİR bildirim (FINANCE_REVIEW — WARNING zaten bildirilmişti)', async () => {
      envelopeRepo.findOne.mockResolvedValueOnce(
        buildEnvelope({ lastNotifiedTier: BudgetEnvelopeNotifiedTier.WARNING }),
      );
      summaryRepo.findOne.mockResolvedValueOnce(buildSummary(91));
      await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);

      expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationService.createNotification.mock.calls[0][1]).toBe(
        NotificationType.BUDGET_FINANCE_REVIEW,
      );
      expect(envelopeRepo.update).toHaveBeenCalledWith(
        { id: ENVELOPE_ID, tenantId: TENANT_ID },
        { lastNotifiedTier: BudgetEnvelopeNotifiedTier.FINANCE_REVIEW },
      );
    });

    it('%91 → %92 ⇒ SIFIR bildirim (aynı kademede kalmak yeniden bildirim doğurmaz)', async () => {
      envelopeRepo.findOne.mockResolvedValueOnce(
        buildEnvelope({
          lastNotifiedTier: BudgetEnvelopeNotifiedTier.FINANCE_REVIEW,
        }),
      );
      summaryRepo.findOne.mockResolvedValueOnce(buildSummary(92));
      await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);

      expect(notificationService.createNotification).not.toHaveBeenCalled();
      // finalTier === originalTier (ikisi de FINANCE_REVIEW) — durum
      // güncellemesi de tetiklenmemeli (gereksiz yazma değil, DAVRANIŞ farkı).
      expect(envelopeRepo.update).not.toHaveBeenCalled();
    });

    it(
      "%91 → %88 → %91 ⇒ İKİNCİ bildirim: düşüş SESSİZCE durumu WARNING'e " +
        "çeker (bildirim YOK), tekrar %91'e çıkış YENİDEN bildirir — " +
        '"olay bir GEÇİŞTİR, durum değil"',
      async () => {
        // adım 1: %91 → %88 (FINANCE_REVIEW → WARNING, sessiz durum güncellemesi)
        envelopeRepo.findOne.mockResolvedValueOnce(
          buildEnvelope({
            lastNotifiedTier: BudgetEnvelopeNotifiedTier.FINANCE_REVIEW,
          }),
        );
        summaryRepo.findOne.mockResolvedValueOnce(buildSummary(88));
        await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);
        expect(notificationService.createNotification).not.toHaveBeenCalled();
        expect(envelopeRepo.update).toHaveBeenCalledWith(
          { id: ENVELOPE_ID, tenantId: TENANT_ID },
          { lastNotifiedTier: BudgetEnvelopeNotifiedTier.WARNING },
        );

        // adım 2: %88 → %91 (WARNING → FINANCE_REVIEW, YENİDEN bildirir)
        envelopeRepo.findOne.mockResolvedValueOnce(
          buildEnvelope({
            lastNotifiedTier: BudgetEnvelopeNotifiedTier.WARNING,
          }),
        );
        summaryRepo.findOne.mockResolvedValueOnce(buildSummary(91));
        await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);
        expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
        expect(notificationService.createNotification.mock.calls[0][1]).toBe(
          NotificationType.BUDGET_FINANCE_REVIEW,
        );
      },
    );
  });

  // ═══ P4a — SESSİZ-DÜŞME YASAĞI ═══
  describe('P4a — sessiz-düşme yasağı: yutulan exception YOK', () => {
    it('FINANCE_REVIEW alıcı kümesi boş (tenant içinde FINANCE yok) ⇒ FIRLAR, yutulmaz', async () => {
      policyService.resolvePolicy.mockResolvedValue(buildPolicy(80, 90));
      userRepository.findById.mockResolvedValue(OWNER);
      userRepository.findByRole.mockResolvedValue([]); // FINANCE boş

      envelopeRepo.findOne.mockResolvedValueOnce(buildEnvelope());
      summaryRepo.findOne.mockResolvedValueOnce(buildSummary(91));

      await expect(
        service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('WARNING: owner yok VE FINANCE de boş ⇒ FIRLAR (owner-boşluğu bunu ÖRTMEZ)', async () => {
      policyService.resolvePolicy.mockResolvedValue(buildPolicy(80, 90));
      userRepository.findByRole.mockResolvedValue([]); // FINANCE fallback de boş

      envelopeRepo.findOne.mockResolvedValueOnce(
        buildEnvelope({ budgetOwnerId: undefined }),
      );
      summaryRepo.findOne.mockResolvedValueOnce(buildSummary(80));

      await expect(
        service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ═══ GÖRÜNÜR FALLBACK PİNİ (Z59 §2) ═══
  describe("Görünür fallback (Z59 §2): owner'sız zarf → WARNING FINANCE'e düşer", () => {
    it('owner UNSET ⇒ FINANCE kullanıcılarına, gövde fallback bilgisini TAŞIR', async () => {
      policyService.resolvePolicy.mockResolvedValue(buildPolicy(80, 90));
      userRepository.findByRole.mockResolvedValue([FINANCE_1, FINANCE_2]);

      envelopeRepo.findOne.mockResolvedValueOnce(
        buildEnvelope({ budgetOwnerId: undefined }),
      );
      summaryRepo.findOne.mockResolvedValueOnce(buildSummary(80));

      await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);

      expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
      for (const call of notificationService.createNotification.mock.calls) {
        const [, type, recipientId, , , metadata] = call;
        expect(type).toBe(NotificationType.BUDGET_ALERT_80);
        expect([FINANCE_1.id, FINANCE_2.id]).toContain(recipientId);
        expect((metadata as Record<string, unknown>).fallbackRecipient).toBe(
          true,
        );
        expect((metadata as Record<string, unknown>).fallbackReason).toBe(
          'OWNER_UNSET',
        );
      }
    });

    it('owner var ama kullanıcı BULUNAMADI (OWNER_NOT_FOUND) ⇒ aynı FINANCE fallback', async () => {
      policyService.resolvePolicy.mockResolvedValue(buildPolicy(80, 90));
      userRepository.findById.mockResolvedValue(null); // owner id var, kullanıcı yok
      userRepository.findByRole.mockResolvedValue([FINANCE_1]);

      envelopeRepo.findOne.mockResolvedValueOnce(
        buildEnvelope({ budgetOwnerId: 'ghost-owner-id' }),
      );
      summaryRepo.findOne.mockResolvedValueOnce(buildSummary(80));

      await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);

      expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
      const [, , , , , metadata] =
        notificationService.createNotification.mock.calls[0];
      expect((metadata as Record<string, unknown>).fallbackReason).toBe(
        'OWNER_NOT_FOUND',
      );
    });

    it('FINANCE_REVIEW alıcısı tenant içindeki TÜM FINANCE rollü kullanıcılardır', async () => {
      policyService.resolvePolicy.mockResolvedValue(buildPolicy(80, 90));
      userRepository.findByRole.mockResolvedValue([FINANCE_1, FINANCE_2]);

      envelopeRepo.findOne.mockResolvedValueOnce(buildEnvelope());
      summaryRepo.findOne.mockResolvedValueOnce(buildSummary(90));
      await service.evaluateAndNotify(TENANT_ID, ENVELOPE_ID);

      expect(userRepository.findByRole).toHaveBeenCalledWith(
        TENANT_ID,
        UserRole.FINANCE,
      );
      const recipientIds = notificationService.createNotification.mock.calls
        .filter(
          (c: unknown[]) => c[1] === NotificationType.BUDGET_FINANCE_REVIEW,
        )
        .map((c: unknown[]) => c[2]);
      expect(recipientIds.sort()).toEqual([FINANCE_1.id, FINANCE_2.id].sort());
    });
  });
});

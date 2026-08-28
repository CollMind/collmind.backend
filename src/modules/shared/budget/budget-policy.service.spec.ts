import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BUDGET_POLICY_AMBIGUOUS_CODE,
  BUDGET_POLICY_NOT_CONFIGURED_CODE,
  BudgetPolicyService,
} from './budget-policy.service';
import { BudgetPolicy } from '../../../database/entities/budget-policy.entity';

const TENANT_ID = 'tenant-001';
const CHANNEL_ID = 'channel-nka';
const CATEGORY_ID = 'category-hair';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPolicy(overrides: Record<string, any>): BudgetPolicy {
  return {
    id: `policy-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT_ID,
    channelId: null,
    categoryId: null,
    warningThresholdPct: 80,
    financeReviewThresholdPct: 90,
    blockThresholdPct: 100,
    financeReviewMode: 'NOTIFY',
    ...overrides,
  } as unknown as BudgetPolicy;
}

describe('BudgetPolicyService', () => {
  let service: BudgetPolicyService;
  let repo: jest.Mocked<Repository<BudgetPolicy>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetPolicyService,
        {
          provide: getRepositoryToken(BudgetPolicy),
          useValue: { find: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<BudgetPolicyService>(BudgetPolicyService);
    repo = module.get(getRepositoryToken(BudgetPolicy));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolvePolicy', () => {
    it('throws BadRequestException when tenantId is missing', async () => {
      await expect(
        service.resolvePolicy('', CHANNEL_ID, CATEGORY_ID),
      ).rejects.toThrow('tenantId zorunlu');
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('K-2.2.8c: en-spesifik-kazanır — kanal+kategori satırı jokeri ezer (iki girdi iki çıktı, 1/2)', async () => {
      const joker = buildPolicy({ id: 'joker' });
      const exact = buildPolicy({
        id: 'exact',
        channelId: CHANNEL_ID,
        categoryId: CATEGORY_ID,
        warningThresholdPct: 70,
        financeReviewThresholdPct: 85,
        blockThresholdPct: 95,
      });
      repo.find.mockResolvedValue([joker, exact]);

      const result = await service.resolvePolicy(
        TENANT_ID,
        CHANNEL_ID,
        CATEGORY_ID,
      );

      expect(result.warningPct).toBe(70);
      expect(result.financeReviewPct).toBe(85);
      expect(result.blockPct).toBe(95);
      expect(result.source.policyId).toBe('exact');
    });

    it('K-2.2.8c: aynı girdi jokerden okur — spesifik satır YOKKEN (iki girdi iki çıktı, 2/2)', async () => {
      const joker = buildPolicy({ id: 'joker' });
      repo.find.mockResolvedValue([joker]);

      const result = await service.resolvePolicy(
        TENANT_ID,
        CHANNEL_ID,
        CATEGORY_ID,
      );

      expect(result.warningPct).toBe(80);
      expect(result.financeReviewPct).toBe(90);
      expect(result.blockPct).toBe(100);
      expect(result.source.policyId).toBe('joker');
    });

    it('en-spesifik: tek-boyut (kanal-only) satır jokeri ezer, kategori-only satırı ezmez', async () => {
      const joker = buildPolicy({ id: 'joker' });
      const channelOnly = buildPolicy({
        id: 'channel-only',
        channelId: CHANNEL_ID,
        warningThresholdPct: 75,
      });
      repo.find.mockResolvedValue([joker, channelOnly]);

      const result = await service.resolvePolicy(TENANT_ID, CHANNEL_ID, null);

      expect(result.source.policyId).toBe('channel-only');
      expect(result.warningPct).toBe(75);
    });

    it('§2.5: sıfır aday (joker satırı eksik) → açık hata, varsayılan YOK', async () => {
      repo.find.mockResolvedValue([]);

      await expect(
        service.resolvePolicy(TENANT_ID, CHANNEL_ID, CATEGORY_ID),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: BUDGET_POLICY_NOT_CONFIGURED_CODE,
        }),
      });
    });

    it('§2.5: eşit-spesifiklikte çakışan kanal-only/kategori-only satır → açık hata, gizli tie-break YOK', async () => {
      const channelOnly = buildPolicy({
        id: 'channel-only',
        channelId: CHANNEL_ID,
        warningThresholdPct: 60,
      });
      const categoryOnly = buildPolicy({
        id: 'category-only',
        categoryId: CATEGORY_ID,
        warningThresholdPct: 65,
      });
      repo.find.mockResolvedValue([channelOnly, categoryOnly]);

      await expect(
        service.resolvePolicy(TENANT_ID, CHANNEL_ID, CATEGORY_ID),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: BUDGET_POLICY_AMBIGUOUS_CODE,
        }),
      });
    });

    it('channelId/categoryId verilmezse yalnız joker aday olur (belirsiz boyuta özel politika sızmaz)', async () => {
      const joker = buildPolicy({ id: 'joker' });
      repo.find.mockResolvedValue([joker]);

      await service.resolvePolicy(TENANT_ID);

      const callArg = repo.find.mock.calls[0][0] as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where: any[];
      };
      expect(callArg.where).toHaveLength(1);
      expect(callArg.where[0].tenantId).toBe(TENANT_ID);
      expect(callArg.where[0].channelId.type).toBe('isNull');
      expect(callArg.where[0].categoryId.type).toBe('isNull');
    });
  });
});

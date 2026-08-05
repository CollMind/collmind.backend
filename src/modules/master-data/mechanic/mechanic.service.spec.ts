import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MechanicService } from './mechanic.service';
import { MechanicRepository } from './mechanic.repository';
import { TacticRepository } from '../tactic/tactic.repository';
import { AdminAuditService } from '../../../common/services/admin-audit.service';
import {
  Mechanic,
  MechanicType,
} from '../../../database/entities/mechanic.entity';
import { CreateMechanicDto } from './dto/create-mechanic.dto';
import { UpdateMechanicDto } from './dto/update-mechanic.dto';

/**
 * T-084 — min/max bound guard (`boundOf`), via `create` and `update`.
 *
 * Kaynak: mechanic.service.ts doc comment (satır 26-50). Ölçülmüş canlı
 * kusur: `min=50, max=100` (geçerli aralık) ve `max` NULL ("sınır yok") her
 * ikisi de eski kodda 400 veriyordu — altı mekaniğin üçü (DISPLAY_FEE,
 * PRICE_SUP, VIS_LS) hiçbir alanda PATCH edilemiyordu. İki kök neden:
 *   1. `!== undefined` koruması DB'den gelen `null`'ı geçiriyordu →
 *      `0 >= null` → `0 >= 0` → true.
 *   2. `min_value`/`max_value` transformer'sız `decimal` kolon → TypeORM
 *      STRING döner → `"50.0000" >= "100.0000"` sözlüksel karşılaştırma.
 *
 * Bu suite sadece min/max koruma davranışını kapsar (T-084 scope). Diğer
 * `create`/`update` yolları (formula validation, circular dependency, vb.)
 * bu dosyanın kapsamı DIŞINDADIR — testler o yolları tetiklememek için
 * asgari geçerli girdi kullanır.
 */
describe('MechanicService — min/max bound guard (T-084)', () => {
  let service: MechanicService;
  let mechanicRepository: jest.Mocked<MechanicRepository>;
  let tacticRepository: jest.Mocked<TacticRepository>;
  let auditService: jest.Mocked<AdminAuditService>;

  const tenantId = 'tenant-084';
  const tacticId = 'tactic-084';
  const mechanicId = 'mechanic-084';

  const mockTactic: any = { id: tacticId, tenantId, code: 'TAC-TEST' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MechanicService,
        {
          provide: MechanicRepository,
          useValue: {
            findByCode: jest.fn(),
            findOne: jest.fn(),
            findAllByTenant: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softRemove: jest.fn(),
          },
        },
        {
          provide: TacticRepository,
          useValue: {
            findOne: jest.fn(),
            findByCode: jest.fn(),
          },
        },
        {
          provide: AdminAuditService,
          useValue: {
            logAdminAction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MechanicService>(MechanicService);
    mechanicRepository = module.get(
      MechanicRepository,
    ) as jest.Mocked<MechanicRepository>;
    tacticRepository = module.get(
      TacticRepository,
    ) as jest.Mocked<TacticRepository>;
    auditService = module.get(
      AdminAuditService,
    ) as jest.Mocked<AdminAuditService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function baseCreateDto(
    overrides: Partial<CreateMechanicDto> = {},
  ): CreateMechanicDto {
    return {
      code: 'TEST_MEC',
      name: 'Test Mechanic',
      tacticId,
      mechanicType: MechanicType.AMOUNT,
      ...overrides,
    } as CreateMechanicDto;
  }

  // T-084: `minValue`/`maxValue` are typed `number | undefined` on the
  // entity, but the doc comment on `boundOf` is explicit that this is a lie
  // — a row read from Postgres carries `null` (or, for these `decimal`
  // columns, a numeric STRING). `overrides` is loosely typed here on
  // purpose so fixtures can reproduce both traps.
  function baseMechanicEntity(overrides: Record<string, any> = {}): Mechanic {
    return {
      id: mechanicId,
      tenantId,
      code: 'TEST_MEC',
      name: 'Test Mechanic',
      tacticId,
      mechanicType: MechanicType.AMOUNT,
      minValue: null,
      maxValue: null,
      ...overrides,
    } as unknown as Mechanic;
  }

  // ──────────────────────────────────────────────────────────────────────
  // create()
  // ──────────────────────────────────────────────────────────────────────

  describe('create — boundOf guard', () => {
    beforeEach(() => {
      mechanicRepository.findByCode.mockResolvedValue(null);
      tacticRepository.findOne.mockResolvedValue(mockTactic);
      mechanicRepository.create.mockImplementation(
        (entity) => entity as Mechanic,
      );
      mechanicRepository.save.mockImplementation((entity) =>
        Promise.resolve({ ...entity, id: mechanicId } as Mechanic),
      );
    });

    it('min=0, max=100 → passes (ordinary range, baseline sanity)', async () => {
      const dto = baseCreateDto({ minValue: 0, maxValue: 100 });
      await expect(service.create(tenantId, dto)).resolves.toBeDefined();
    });

    it("min=50, max=100 → passes — REGRESSION: old code 400'd here (both bounds present, min < max, but not 0)", async () => {
      const dto = baseCreateDto({ minValue: 50, maxValue: 100 });
      await expect(service.create(tenantId, dto)).resolves.toBeDefined();
    });

    it('max is absent (no upper bound) → passes — REGRESSION: old code treated missing max as 0 and rejected min=0 >= 0', async () => {
      const dto = baseCreateDto({ minValue: 0 });
      await expect(service.create(tenantId, dto)).resolves.toBeDefined();
    });

    it('min is absent (no lower bound), max present → passes', async () => {
      const dto = baseCreateDto({ maxValue: 100 });
      await expect(service.create(tenantId, dto)).resolves.toBeDefined();
    });

    it('both min and max absent → passes', async () => {
      const dto = baseCreateDto();
      await expect(service.create(tenantId, dto)).resolves.toBeDefined();
    });

    it('min=50, max=10 → 400 (real violation, must still be rejected)', async () => {
      const dto = baseCreateDto({ minValue: 50, maxValue: 10 });
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        'minValue must be less than maxValue',
      );
    });

    it('min == max → 400 (pinned current behaviour — product decision not made, see mechanic.service.ts comment)', async () => {
      const dto = baseCreateDto({ minValue: 50, maxValue: 50 });
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // update()
  // ──────────────────────────────────────────────────────────────────────

  describe('update — boundOf guard', () => {
    beforeEach(() => {
      mechanicRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as Mechanic),
      );
    });

    it('min=0, max=100 → passes (ordinary range, baseline sanity)', async () => {
      mechanicRepository.findOne.mockResolvedValue(
        baseMechanicEntity({ minValue: null, maxValue: null }),
      );
      const dto: UpdateMechanicDto = { minValue: 0, maxValue: 100 };
      await expect(
        service.update(tenantId, mechanicId, dto),
      ).resolves.toBeDefined();
    });

    it("min=50, max=100 → passes — REGRESSION: old code 400'd here", async () => {
      mechanicRepository.findOne.mockResolvedValue(
        baseMechanicEntity({ minValue: null, maxValue: null }),
      );
      const dto: UpdateMechanicDto = { minValue: 50, maxValue: 100 };
      await expect(
        service.update(tenantId, mechanicId, dto),
      ).resolves.toBeDefined();
    });

    it('stored max is NULL, DTO does not touch bounds → passes — REGRESSION: old code treated stored NULL max as 0', async () => {
      // Mirrors the live seed defect: VIS_LS/PRICE_SUP/DISPLAY_FEE stored
      // with min_value=0, max_value=NULL. A PATCH that never sends
      // minValue/maxValue must fall back to the stored (NULL) bounds and
      // still pass.
      mechanicRepository.findOne.mockResolvedValue(
        baseMechanicEntity({ minValue: 0, maxValue: null }),
      );
      const dto: UpdateMechanicDto = { isActive: false };
      await expect(
        service.update(tenantId, mechanicId, dto),
      ).resolves.toBeDefined();
    });

    it('DTO min is NULL-equivalent (absent), stored max present → passes', async () => {
      mechanicRepository.findOne.mockResolvedValue(
        baseMechanicEntity({ minValue: null, maxValue: 100 }),
      );
      const dto: UpdateMechanicDto = { isActive: true };
      await expect(
        service.update(tenantId, mechanicId, dto),
      ).resolves.toBeDefined();
    });

    it('min=50, max=10 → 400 (real violation, must still be rejected)', async () => {
      mechanicRepository.findOne.mockResolvedValue(
        baseMechanicEntity({ minValue: null, maxValue: null }),
      );
      const dto: UpdateMechanicDto = { minValue: 50, maxValue: 10 };
      await expect(service.update(tenantId, mechanicId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update(tenantId, mechanicId, dto)).rejects.toThrow(
        'minValue must be less than maxValue',
      );
    });

    it('min == max → 400 (pinned current behaviour)', async () => {
      mechanicRepository.findOne.mockResolvedValue(
        baseMechanicEntity({ minValue: null, maxValue: null }),
      );
      const dto: UpdateMechanicDto = { minValue: 50, maxValue: 50 };
      await expect(service.update(tenantId, mechanicId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('STRING bounds from a decimal column (the second trap): stored minValue/maxValue as "50.0000"/"100.0000" → passes, not rejected by lexicographic comparison', async () => {
      // This is the case that a purely numeric fixture can never exercise:
      // TypeORM hands back `decimal` columns as strings. The old guard
      // compared "50.0000" >= "100.0000" as strings (true, wrongly
      // rejected). `boundOf` must coerce both to Number before comparing.
      mechanicRepository.findOne.mockResolvedValue(
        baseMechanicEntity({
          minValue: '50.0000' as unknown as number,
          maxValue: '100.0000' as unknown as number,
        }),
      );
      const dto: UpdateMechanicDto = { isActive: false };
      await expect(
        service.update(tenantId, mechanicId, dto),
      ).resolves.toBeDefined();
    });

    it('STRING bounds, real violation ("50.0000" vs "10.0000") → still 400 after numeric coercion', async () => {
      mechanicRepository.findOne.mockResolvedValue(
        baseMechanicEntity({
          minValue: '50.0000' as unknown as number,
          maxValue: '10.0000' as unknown as number,
        }),
      );
      const dto: UpdateMechanicDto = { isActive: false };
      await expect(service.update(tenantId, mechanicId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditLog } from '../../database/entities/admin-audit-log.entity';

// ---------------------------------------------------------------------------
// T-014: AdminAuditService transaction-aware `logAdminAction` unit tests.
//
// NOTE: these are signature/behavior unit tests with mocked repositories.
// They prove *what gets called with what*, not that a real Postgres
// transaction actually rolls the row back — that proof is the e2e/SQL
// evidence in the T-014 report (mocks cannot demonstrate real rollback
// atomicity; see task instructions).
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-001';
const ADMIN_ID = 'admin-001';
const ADMIN_EMAIL = 'admin@test.com';

describe('AdminAuditService', () => {
  let service: AdminAuditService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDefaultRepo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockManagerRepo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockManager: any;

  beforeEach(async () => {
    mockDefaultRepo = {
      create: jest.fn().mockImplementation((data) => data),
      save: jest
        .fn()
        .mockImplementation((entity) =>
          Promise.resolve({ id: 'log-1', ...entity }),
        ),
      findOne: jest.fn().mockResolvedValue({
        id: 'log-1',
        alertSent: false,
      }),
    };

    mockManagerRepo = {
      create: jest.fn().mockImplementation((data) => data),
      save: jest
        .fn()
        .mockImplementation((entity) =>
          Promise.resolve({ id: 'log-2', ...entity }),
        ),
    };

    mockManager = {
      getRepository: jest.fn().mockReturnValue(mockManagerRepo),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuditService,
        {
          provide: getRepositoryToken(AdminAuditLog),
          useValue: mockDefaultRepo,
        },
      ],
    }).compile();

    service = module.get<AdminAuditService>(AdminAuditService);
  });

  // -------------------------------------------------------------------------
  // Backward compatibility: 11-arg call (no options) — existing 13 call
  // sites in the codebase must keep working unchanged.
  // -------------------------------------------------------------------------

  describe('backward compatibility (no options / default connection)', () => {
    it('writes via the default (non-manager) repository', async () => {
      await service.logAdminAction(
        TENANT_ID,
        ADMIN_ID,
        ADMIN_EMAIL,
        'CREATE',
        'agreement',
        'entity-1',
        undefined,
        'SUCCESS',
      );

      expect(mockDefaultRepo.create).toHaveBeenCalled();
      expect(mockDefaultRepo.save).toHaveBeenCalled();
      expect(mockManager.getRepository).not.toHaveBeenCalled();
    });

    it('triggers the alert immediately (synchronously, same call) for high-risk actions', async () => {
      await service.logAdminAction(
        TENANT_ID,
        ADMIN_ID,
        ADMIN_EMAIL,
        'CLOSE',
        'AGREEMENT',
        'agr-1',
        undefined,
        'SUCCESS',
      );

      // triggerAlert (private) calls findOne + save via the default repo
      // to mark alertSent = true.
      expect(mockDefaultRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'log-1' },
      });
      expect(mockDefaultRepo.save).toHaveBeenCalledTimes(2); // create-save + alertSent-save
    });

    it('does not trigger an alert for non-high-risk actions', async () => {
      await service.logAdminAction(
        TENANT_ID,
        ADMIN_ID,
        ADMIN_EMAIL,
        'UPDATE',
        'agreement', // not in the high-risk list
        'entity-1',
        undefined,
        'SUCCESS',
      );

      expect(mockDefaultRepo.findOne).not.toHaveBeenCalled();
      expect(mockDefaultRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // T-014: transaction-aware overload (options.manager)
  // -------------------------------------------------------------------------

  describe('transaction-aware overload (options.manager provided)', () => {
    it('writes via manager.getRepository(AdminAuditLog), not the default repository', async () => {
      await service.logAdminAction(
        TENANT_ID,
        ADMIN_ID,
        ADMIN_EMAIL,
        'CLOSE',
        'AGREEMENT',
        'agr-1',
        undefined,
        'SUCCESS',
        undefined,
        undefined,
        undefined,
        { manager: mockManager },
      );

      expect(mockManager.getRepository).toHaveBeenCalledWith(AdminAuditLog);
      expect(mockManagerRepo.create).toHaveBeenCalled();
      expect(mockManagerRepo.save).toHaveBeenCalled();
      expect(mockDefaultRepo.create).not.toHaveBeenCalled();
      expect(mockDefaultRepo.save).not.toHaveBeenCalled();
    });

    it('does NOT trigger the alert inline for a high-risk action (deferred to flushPendingAlert)', async () => {
      await service.logAdminAction(
        TENANT_ID,
        ADMIN_ID,
        ADMIN_EMAIL,
        'CLOSE',
        'AGREEMENT',
        'agr-1',
        undefined,
        'SUCCESS',
        undefined,
        undefined,
        undefined,
        { manager: mockManager },
      );

      // No call against either repository's findOne/save for alertSent —
      // the alert must wait for flushPendingAlert() to be called by the
      // caller after its own commitTransaction() succeeds.
      expect(mockDefaultRepo.findOne).not.toHaveBeenCalled();
      expect(mockManagerRepo.save).toHaveBeenCalledTimes(1); // only the initial save
    });

    it('returns the saved log with isHighRisk set so the caller can flushPendingAlert after commit', async () => {
      const log = await service.logAdminAction(
        TENANT_ID,
        ADMIN_ID,
        ADMIN_EMAIL,
        'CLOSE',
        'AGREEMENT',
        'agr-1',
        undefined,
        'SUCCESS',
        undefined,
        undefined,
        undefined,
        { manager: mockManager },
      );

      expect(log.isHighRisk).toBe(true);
      expect(log.alertSent).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // flushPendingAlert
  // -------------------------------------------------------------------------

  describe('flushPendingAlert', () => {
    it('triggers the alert (via the default connection) for a high-risk, not-yet-alerted log', async () => {
      await service.flushPendingAlert({
        id: 'log-2',
        isHighRisk: true,
        alertSent: false,
        actionType: 'CLOSE',
        entityType: 'AGREEMENT',
        adminEmail: ADMIN_EMAIL,
        entityId: 'agr-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(mockDefaultRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'log-2' },
      });
      expect(mockDefaultRepo.save).toHaveBeenCalled();
    });

    it('is a no-op for a non-high-risk log', async () => {
      await service.flushPendingAlert({
        id: 'log-3',
        isHighRisk: false,
        alertSent: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(mockDefaultRepo.findOne).not.toHaveBeenCalled();
      expect(mockDefaultRepo.save).not.toHaveBeenCalled();
    });

    it('is a no-op when the alert was already sent (idempotent)', async () => {
      await service.flushPendingAlert({
        id: 'log-4',
        isHighRisk: true,
        alertSent: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(mockDefaultRepo.findOne).not.toHaveBeenCalled();
      expect(mockDefaultRepo.save).not.toHaveBeenCalled();
    });

    it('alerts only once when the SAME log object is flushed twice', async () => {
      const log = {
        id: 'log-5',
        isHighRisk: true,
        alertSent: false,
        actionType: 'REVERSE',
        entityType: 'TRANSACTION',
        adminEmail: ADMIN_EMAIL,
        entityId: 'tx-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      await service.flushPendingAlert(log);
      await service.flushPendingAlert(log);

      // `triggerAlert` `alertSent`'i DB'de ayrı bir obje üzerinde günceller;
      // çağıranın referansı da işaretlenmezse ikinci flush alarmı TEKRAR
      // gönderirdi (duplicate bildirim).
      expect(log.alertSent).toBe(true);
      expect(mockDefaultRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });
});

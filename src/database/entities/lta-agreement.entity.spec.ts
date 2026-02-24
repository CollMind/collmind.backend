import { LTAAgreement, LTAAgreementStatus } from './lta-agreement.entity';

describe('LTAAgreement Entity', () => {
  it('should have all required fields', () => {
    const lta = new LTAAgreement();
    lta.id = 'test-id';
    lta.tenantId = 'tenant-id';
    lta.cplId = 'cpl-id';
    lta.agreementName = 'Test Agreement';
    lta.agreementCode = 'TEST_AGREEMENT_001';
    lta.effectiveDate = new Date('2024-01-01');
    lta.status = LTAAgreementStatus.DRAFT;

    expect(lta.cplId).toBe('cpl-id');
    expect(lta.agreementName).toBe('Test Agreement');
    expect(lta.agreementCode).toBe('TEST_AGREEMENT_001');
    expect(lta.effectiveDate).toEqual(new Date('2024-01-01'));
    expect(lta.status).toBe(LTAAgreementStatus.DRAFT);
  });

  it('should support optional fields', () => {
    const lta = new LTAAgreement();
    lta.totalAgreementValue = 100000;
    lta.notes = 'Test notes';

    expect(lta.totalAgreementValue).toBe(100000);
    expect(lta.notes).toBe('Test notes');
  });

  it('should support optional expiry_date', () => {
    const lta = new LTAAgreement();
    lta.expiryDate = new Date('2024-12-31');
    expect(lta.expiryDate).toEqual(new Date('2024-12-31'));
  });

  it('should support status enum', () => {
    const lta = new LTAAgreement();
    lta.status = LTAAgreementStatus.ACTIVE;
    expect(lta.status).toBe(LTAAgreementStatus.ACTIVE);
    
    lta.status = LTAAgreementStatus.EXPIRED;
    expect(lta.status).toBe(LTAAgreementStatus.EXPIRED);
  });
});

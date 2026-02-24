import { Mechanic, SpendingType, MechanicType } from './mechanic.entity';

describe('Mechanic Entity', () => {
  it('should have all required fields', () => {
    const mechanic = new Mechanic();
    mechanic.id = 'test-id';
    mechanic.tenantId = 'tenant-id';
    mechanic.code = 'MECH-001';
    mechanic.name = 'Test Mechanic';
    mechanic.tacticId = 'tactic-id';
    mechanic.mechanicType = MechanicType.PERCENT;
    mechanic.isActive = true;

    expect(mechanic.id).toBe('test-id');
    expect(mechanic.tenantId).toBe('tenant-id');
    expect(mechanic.code).toBe('MECH-001');
    expect(mechanic.name).toBe('Test Mechanic');
    expect(mechanic.tacticId).toBe('tactic-id');
    expect(mechanic.mechanicType).toBe(MechanicType.PERCENT);
    expect(mechanic.isActive).toBe(true);
  });

  it('should support spending_type enum', () => {
    const mechanic = new Mechanic();
    mechanic.spendingType = SpendingType.ON_INVOICE;
    expect(mechanic.spendingType).toBe(SpendingType.ON_INVOICE);

    mechanic.spendingType = SpendingType.OFF_INVOICE;
    expect(mechanic.spendingType).toBe(SpendingType.OFF_INVOICE);

    mechanic.spendingType = SpendingType.BOTH;
    expect(mechanic.spendingType).toBe(SpendingType.BOTH);
  });

  it('should support optional fields', () => {
    const mechanic = new Mechanic();
    mechanic.calculationFormula = 'volume * price * 0.1';
    mechanic.applicabilityRules = { channels: ['NKA'], categories: ['HAIR_CARE'] };
    mechanic.inputConstraints = { min: 0, max: 100, step: 0.5 };

    expect(mechanic.calculationFormula).toBe('volume * price * 0.1');
    expect(mechanic.applicabilityRules).toEqual({ channels: ['NKA'], categories: ['HAIR_CARE'] });
    expect(mechanic.inputConstraints).toEqual({ min: 0, max: 100, step: 0.5 });
  });

  it('should have SpendingType enum values', () => {
    expect(SpendingType.ON_INVOICE).toBe('on_invoice');
    expect(SpendingType.OFF_INVOICE).toBe('off_invoice');
    expect(SpendingType.BOTH).toBe('both');
  });
});

import {
  PlanMechanicValue,
  DistributionMethod,
} from './plan-mechanic-value.entity';

describe('PlanMechanicValue Entity', () => {
  it('should have all required fields', () => {
    const pmv = new PlanMechanicValue();
    pmv.id = 'test-id';
    pmv.tenantId = 'tenant-id';
    pmv.planFuId = 'plan-fu-id';
    pmv.mechanicId = 'mechanic-id';
    pmv.calculatedSpend = 1000.5;
    pmv.onInvoiceAmount = 600.3;
    pmv.offInvoiceAmount = 400.2;

    expect(pmv.planFuId).toBe('plan-fu-id');
    expect(pmv.mechanicId).toBe('mechanic-id');
    expect(pmv.calculatedSpend).toBe(1000.5);
    expect(pmv.onInvoiceAmount).toBe(600.3);
    expect(pmv.offInvoiceAmount).toBe(400.2);
  });

  it('should support the three semantic entry columns (ADR 0007 Karar 4)', () => {
    // entered_value was split by semantics in migration 1796 and dropped in
    // 1797: one column could not say whether 15.5 meant 15.5% or 15.50 TRY.
    const pmv = new PlanMechanicValue();
    pmv.enteredRatePct = 15.5;
    expect(pmv.enteredRatePct).toBe(15.5);

    const perUnit = new PlanMechanicValue();
    perUnit.enteredUnitAmount = 2.75;
    expect(perUnit.enteredUnitAmount).toBe(2.75);

    const total = new PlanMechanicValue();
    total.enteredTotalAmount = 5000;
    expect(total.enteredTotalAmount).toBe(5000);
  });

  it('should support distribution_method enum', () => {
    const pmv = new PlanMechanicValue();
    pmv.distributionMethod = DistributionMethod.PERCENTAGE;
    expect(pmv.distributionMethod).toBe(DistributionMethod.PERCENTAGE);

    pmv.distributionMethod = DistributionMethod.PER_UNIT;
    expect(pmv.distributionMethod).toBe(DistributionMethod.PER_UNIT);

    pmv.distributionMethod = DistributionMethod.LUMPSUM;
    expect(pmv.distributionMethod).toBe(DistributionMethod.LUMPSUM);

    pmv.distributionMethod = DistributionMethod.PROPORTIONAL;
    expect(pmv.distributionMethod).toBe(DistributionMethod.PROPORTIONAL);
  });

  it('should have DistributionMethod enum values', () => {
    expect(DistributionMethod.PERCENTAGE).toBe('percentage');
    expect(DistributionMethod.PER_UNIT).toBe('per_unit');
    expect(DistributionMethod.LUMPSUM).toBe('lumpsum');
    expect(DistributionMethod.PROPORTIONAL).toBe('proportional');
  });

  it('should calculate total spend correctly', () => {
    const pmv = new PlanMechanicValue();
    pmv.onInvoiceAmount = 500;
    pmv.offInvoiceAmount = 300;
    pmv.calculatedSpend = 800;

    expect(pmv.onInvoiceAmount + pmv.offInvoiceAmount).toBe(
      pmv.calculatedSpend,
    );
  });
});

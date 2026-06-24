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

  it('should support optional entered_value', () => {
    const pmv = new PlanMechanicValue();
    pmv.enteredValue = 15.5;
    expect(pmv.enteredValue).toBe(15.5);
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

import { MechanicSpendBreakdown, DistributionBasis } from './mechanic-spend-breakdown.entity';

describe('MechanicSpendBreakdown Entity', () => {
  it('should have all required fields', () => {
    const breakdown = new MechanicSpendBreakdown();
    breakdown.id = 'test-id';
    breakdown.tenantId = 'tenant-id';
    breakdown.planSkuId = 'plan-sku-id';
    breakdown.mechanicId = 'mechanic-id';
    breakdown.planMechanicValueId = 'plan-mechanic-value-id';
    breakdown.calculatedAmount = 250.75;

    expect(breakdown.planSkuId).toBe('plan-sku-id');
    expect(breakdown.mechanicId).toBe('mechanic-id');
    expect(breakdown.planMechanicValueId).toBe('plan-mechanic-value-id');
    expect(breakdown.calculatedAmount).toBe(250.75);
  });

  it('should support distribution_basis enum', () => {
    const breakdown = new MechanicSpendBreakdown();
    breakdown.distributionBasis = DistributionBasis.BASE_VOLUME_RATIO;
    expect(breakdown.distributionBasis).toBe(DistributionBasis.BASE_VOLUME_RATIO);

    breakdown.distributionBasis = DistributionBasis.PLANNED_VOLUME_RATIO;
    expect(breakdown.distributionBasis).toBe(DistributionBasis.PLANNED_VOLUME_RATIO);

    breakdown.distributionBasis = DistributionBasis.EQUAL;
    expect(breakdown.distributionBasis).toBe(DistributionBasis.EQUAL);
  });

  it('should have DistributionBasis enum values', () => {
    expect(DistributionBasis.BASE_VOLUME_RATIO).toBe('base_volume_ratio');
    expect(DistributionBasis.PLANNED_VOLUME_RATIO).toBe('planned_volume_ratio');
    expect(DistributionBasis.EQUAL).toBe('equal');
  });
});

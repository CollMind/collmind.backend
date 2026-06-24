import { BudgetAllocation } from './budget-allocation.entity';

describe('BudgetAllocation Entity', () => {
  it('should have all required fields', () => {
    const allocation = new BudgetAllocation();
    allocation.id = 'test-id';
    allocation.tenantId = 'tenant-id';
    allocation.cplId = 'cpl-id';
    allocation.periodType = 'monthly' as any;
    allocation.periodStart = new Date('2024-01-01');
    allocation.periodEnd = new Date('2024-01-31');
    allocation.fiscalYear = 2024;
    allocation.onInvoiceBudget = 10000;
    allocation.offInvoiceBudget = 5000;
    allocation.onInvoiceUtilized = 0;
    allocation.offInvoiceUtilized = 0;

    expect(allocation.cplId).toBe('cpl-id');
    expect(allocation.onInvoiceBudget).toBe(10000);
    expect(allocation.offInvoiceBudget).toBe(5000);
    expect(allocation.onInvoiceUtilized).toBe(0);
    expect(allocation.offInvoiceUtilized).toBe(0);
  });

  it('should support alert thresholds', () => {
    const allocation = new BudgetAllocation();
    allocation.alertThreshold80 = true;
    allocation.alertThreshold95 = true;
    allocation.alertThreshold100 = true;

    expect(allocation.alertThreshold80).toBe(true);
    expect(allocation.alertThreshold95).toBe(true);
    expect(allocation.alertThreshold100).toBe(true);
  });

  it('should calculate available budget correctly', () => {
    const allocation = new BudgetAllocation();
    allocation.onInvoiceBudget = 10000;
    allocation.offInvoiceBudget = 5000;
    allocation.onInvoiceUtilized = 3000;
    allocation.offInvoiceUtilized = 1500;
    allocation.onInvoiceReserved = 0;
    allocation.offInvoiceReserved = 0;

    const availableOnInvoice =
      allocation.onInvoiceBudget -
      allocation.onInvoiceUtilized -
      allocation.onInvoiceReserved;
    const availableOffInvoice =
      allocation.offInvoiceBudget -
      allocation.offInvoiceUtilized -
      allocation.offInvoiceReserved;

    expect(availableOnInvoice).toBe(7000);
    expect(availableOffInvoice).toBe(3500);
  });
});

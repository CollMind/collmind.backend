import { Plan, PlanStatus, PlanFu, PlanSku } from './plan.entity';

describe('Plan Entity - Approval Workflow Fields', () => {
  describe('Plan Entity', () => {
    it('should have PENDING_FINANCE_REVIEW status', () => {
      expect(PlanStatus.PENDING_FINANCE_REVIEW).toBe('PENDING_FINANCE_REVIEW');
    });

    it('should have submission fields', () => {
      const plan = new Plan();
      plan.submissionNotes = 'Test submission notes';
      plan.submittedAt = new Date('2026-01-01');
      plan.submittedById = 'user-1';

      expect(plan.submissionNotes).toBe('Test submission notes');
      expect(plan.submittedAt).toBeInstanceOf(Date);
      expect(plan.submittedById).toBe('user-1');
    });

    it('should have escalation fields', () => {
      const plan = new Plan();
      plan.pendingFinanceReview = true;
      plan.escalationReason = 'High spend amount';
      plan.escalatedAt = new Date('2026-01-02');
      plan.escalatedById = 'reviewer-1';

      expect(plan.pendingFinanceReview).toBe(true);
      expect(plan.escalationReason).toBe('High spend amount');
      expect(plan.escalatedAt).toBeInstanceOf(Date);
      expect(plan.escalatedById).toBe('reviewer-1');
    });

    it('should have budget breakdown fields', () => {
      const plan = new Plan();
      plan.onInvoiceSpend = 60000;
      plan.offInvoiceSpend = 40000;

      expect(plan.onInvoiceSpend).toBe(60000);
      expect(plan.offInvoiceSpend).toBe(40000);
    });

    it('should have pendingFinanceReview field', () => {
      const plan = new Plan();
      plan.pendingFinanceReview = false;
      expect(plan.pendingFinanceReview).toBe(false);
    });

    it('should have budget breakdown fields', () => {
      const plan = new Plan();
      plan.onInvoiceSpend = 0;
      plan.offInvoiceSpend = 0;
      expect(plan.onInvoiceSpend).toBe(0);
      expect(plan.offInvoiceSpend).toBe(0);
    });
  });

  describe('PlanSku Entity - Spend Fields', () => {
    it('should have LTA spend fields', () => {
      const planSku = new PlanSku();
      planSku.baseLtaOnInvoiceSpend = 100;
      planSku.baseLtaOffInvoiceSpend = 50;
      planSku.plannedLtaOnInvoiceSpend = 120;
      planSku.plannedLtaOffInvoiceSpend = 60;

      expect(planSku.baseLtaOnInvoiceSpend).toBe(100);
      expect(planSku.baseLtaOffInvoiceSpend).toBe(50);
      expect(planSku.plannedLtaOnInvoiceSpend).toBe(120);
      expect(planSku.plannedLtaOffInvoiceSpend).toBe(60);
    });

    it('should have promo spend fields', () => {
      const planSku = new PlanSku();
      planSku.promoOnInvoiceSpend = 200;
      planSku.promoOffInvoiceSpend = 150;

      expect(planSku.promoOnInvoiceSpend).toBe(200);
      expect(planSku.promoOffInvoiceSpend).toBe(150);
    });

    it('should calculate total spend correctly', () => {
      const planSku = new PlanSku();
      planSku.plannedLtaOnInvoiceSpend = 120;
      planSku.plannedLtaOffInvoiceSpend = 60;
      planSku.promoOnInvoiceSpend = 200;
      planSku.promoOffInvoiceSpend = 150;

      const totalOnInvoice =
        planSku.plannedLtaOnInvoiceSpend + planSku.promoOnInvoiceSpend;
      const totalOffInvoice =
        planSku.plannedLtaOffInvoiceSpend + planSku.promoOffInvoiceSpend;

      expect(totalOnInvoice).toBe(320);
      expect(totalOffInvoice).toBe(210);
    });
  });
});

import {
  PlanApprovalHistory,
  ApprovalHistoryAction,
} from './plan-approval-history.entity';

describe('PlanApprovalHistory Entity', () => {
  it('should create approval history with SUBMITTED action', () => {
    const history = new PlanApprovalHistory();
    history.planId = 'plan-1';
    history.action = ApprovalHistoryAction.SUBMITTED;
    history.actionedById = 'user-1';
    history.comments = 'Submitted for approval';

    expect(history.planId).toBe('plan-1');
    expect(history.action).toBe(ApprovalHistoryAction.SUBMITTED);
    expect(history.actionedById).toBe('user-1');
    expect(history.comments).toBe('Submitted for approval');
  });

  it('should create approval history with REJECTED action and reason', () => {
    const history = new PlanApprovalHistory();
    history.planId = 'plan-1';
    history.action = ApprovalHistoryAction.REJECTED;
    history.actionedById = 'reviewer-1';
    history.rejectionReason = 'Budget insufficient';
    history.comments = 'Rejected';

    expect(history.action).toBe(ApprovalHistoryAction.REJECTED);
    expect(history.rejectionReason).toBe('Budget insufficient');
  });

  it('should create approval history with REQUEST_CHANGES action and specific changes', () => {
    const history = new PlanApprovalHistory();
    history.planId = 'plan-1';
    history.action = ApprovalHistoryAction.REQUEST_CHANGES;
    history.actionedById = 'reviewer-1';
    history.comments = 'Please update volumes';
    history.specificChanges = ['Update SKU volumes', 'Recalculate ROI'];

    expect(history.action).toBe(ApprovalHistoryAction.REQUEST_CHANGES);
    expect(history.specificChanges).toEqual([
      'Update SKU volumes',
      'Recalculate ROI',
    ]);
  });

  it('should create approval history with ESCALATED action and escalation reason', () => {
    const history = new PlanApprovalHistory();
    history.planId = 'plan-1';
    history.action = ApprovalHistoryAction.ESCALATED;
    history.actionedById = 'reviewer-1';
    history.escalationReason = 'High spend amount requires finance review';
    history.comments = 'Escalating to finance';

    expect(history.action).toBe(ApprovalHistoryAction.ESCALATED);
    expect(history.escalationReason).toBe(
      'High spend amount requires finance review',
    );
  });

  it('should support metadata field', () => {
    const history = new PlanApprovalHistory();
    history.metadata = {
      budgetAmount: 100000,
      onInvoiceSpend: 60000,
      offInvoiceSpend: 40000,
    };

    expect(history.metadata).toEqual({
      budgetAmount: 100000,
      onInvoiceSpend: 60000,
      offInvoiceSpend: 40000,
    });
  });
});

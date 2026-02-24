import { validate } from 'class-validator';
import { ReviewPlanDto, ReviewDecision } from './review-plan.dto';

describe('ReviewPlanDto', () => {
  it('should pass validation with APPROVE decision', async () => {
    const dto = new ReviewPlanDto();
    dto.decision = ReviewDecision.APPROVE;
    dto.comments = 'Approved';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should pass validation with REJECT decision and reason', async () => {
    const dto = new ReviewPlanDto();
    dto.decision = ReviewDecision.REJECT;
    dto.rejectionReason = 'Budget insufficient';
    dto.comments = 'Rejected';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should pass validation with REQUEST_CHANGES decision and comments', async () => {
    const dto = new ReviewPlanDto();
    dto.decision = ReviewDecision.REQUEST_CHANGES;
    dto.comments = 'Please update volumes';
    dto.specificChanges = ['Update SKU volumes', 'Recalculate ROI'];

    const errors = await validate(dto);
    // All fields are optional, but specificChanges array items must be strings
    // If validation fails, it might be due to array validation
    expect(errors.length).toBe(0);
  });

  it('should pass validation with ESCALATE decision and reason', async () => {
    const dto = new ReviewPlanDto();
    dto.decision = ReviewDecision.ESCALATE;
    dto.escalationReason = 'High spend amount';
    dto.comments = 'Escalating to finance';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation if decision is not enum value', async () => {
    const dto = new ReviewPlanDto();
    (dto as any).decision = 'INVALID';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });
});

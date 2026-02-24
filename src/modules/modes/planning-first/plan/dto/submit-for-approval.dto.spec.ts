import { validate } from 'class-validator';
import { SubmitForApprovalDto } from './submit-for-approval.dto';

describe('SubmitForApprovalDto', () => {
  it('should pass validation with valid data', async () => {
    const dto = new SubmitForApprovalDto();
    dto.submissionNotes = 'Test submission notes';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should pass validation without submissionNotes (optional)', async () => {
    const dto = new SubmitForApprovalDto();

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation if submissionNotes exceeds max length', async () => {
    const dto = new SubmitForApprovalDto();
    dto.submissionNotes = 'a'.repeat(2001); // Exceeds MaxLength(2000)

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });
});

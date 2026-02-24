import { IsEnum, IsString, IsOptional, IsArray } from 'class-validator';

export enum ReviewDecision {
  APPROVE = 'approve',
  REJECT = 'reject',
  REQUEST_CHANGES = 'request_changes',
  ESCALATE = 'escalate',
}

export class ReviewPlanDto {
  @IsEnum(ReviewDecision)
  decision!: ReviewDecision;

  @IsString()
  @IsOptional()
  comments?: string;

  @IsString()
  @IsOptional()
  rejectionReason?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specificChanges?: string[]; // For request_changes: specific items to change

  @IsString()
  @IsOptional()
  escalationReason?: string;
}

export interface ReviewResult {
  success: boolean;
  planId: string;
  newStatus: string;
  message: string;
}

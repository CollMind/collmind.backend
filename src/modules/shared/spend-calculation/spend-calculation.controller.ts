import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SpendDistributionService } from './spend-distribution.service';
import { SpendValidationService } from './spend-validation.service';
import { DistributionResult, FUDistributionBreakdown, DistributionValidationResult } from './dto/distribution-result.dto';
import { InputValidationResult, CombinationValidationResult, BudgetValidationResult, PreSubmissionValidation } from './dto/validation-result.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantId } from '../../../common/decorators/tenant.decorator';

@ApiTags('Spend Calculation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('spend-calculation')
export class SpendCalculationController {
  constructor(
    private readonly distributionService: SpendDistributionService,
    private readonly validationService: SpendValidationService,
  ) {}

  @Post('distribute/:planFuId/:mechanicId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Distribute mechanic spend from FU to SKUs' })
  @ApiResponse({ status: 200, description: 'Distribution result', type: DistributionResult })
  distributeMechanicSpend(
    @TenantId() tenantId: string,
    @Param('planFuId') planFuId: string,
    @Param('mechanicId') mechanicId: string,
  ) {
    return this.distributionService.distributeMechanicSpend(tenantId, planFuId, mechanicId);
  }

  @Post('recalculate-on-volume-change/:skuId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Recalculate distribution when SKU volume changes' })
  @ApiResponse({ status: 204, description: 'Distribution recalculated' })
  recalculateOnVolumeChange(
    @TenantId() tenantId: string,
    @Param('skuId') skuId: string,
    @Body() body: { newVolume: number },
  ) {
    return this.distributionService.recalculateDistributionOnVolumeChange(tenantId, skuId, body.newVolume);
  }

  @Get('breakdown/:planFuId')
  @ApiOperation({ summary: 'Get distribution breakdown for a FU' })
  @ApiResponse({ status: 200, description: 'Distribution breakdown', type: FUDistributionBreakdown })
  getDistributionBreakdown(
    @TenantId() tenantId: string,
    @Param('planFuId') planFuId: string,
  ) {
    return this.distributionService.getDistributionBreakdown(tenantId, planFuId);
  }

  @Get('validate-distribution/:planFuId')
  @ApiOperation({ summary: 'Validate distribution for a FU' })
  @ApiResponse({ status: 200, description: 'Distribution validation result', type: DistributionValidationResult })
  validateDistribution(
    @TenantId() tenantId: string,
    @Param('planFuId') planFuId: string,
  ) {
    return this.distributionService.validateDistribution(tenantId, planFuId);
  }

  @Get('validate-inputs/:planFuId')
  @ApiOperation({ summary: 'Validate inputs for a FU' })
  @ApiResponse({ status: 200, description: 'Input validation result', type: InputValidationResult })
  validateInputs(
    @TenantId() tenantId: string,
    @Param('planFuId') planFuId: string,
  ) {
    return this.validationService.validateInputs(tenantId, planFuId);
  }

  @Get('validate-combinations/:planFuId')
  @ApiOperation({ summary: 'Validate mechanic combinations for a FU' })
  @ApiResponse({ status: 200, description: 'Combination validation result', type: CombinationValidationResult })
  validateCombinations(
    @TenantId() tenantId: string,
    @Param('planFuId') planFuId: string,
  ) {
    return this.validationService.validateCombinations(tenantId, planFuId);
  }

  @Get('validate-budget/:planId')
  @ApiOperation({ summary: 'Validate budget impact for a plan' })
  @ApiResponse({ status: 200, description: 'Budget validation result', type: BudgetValidationResult })
  validateBudget(
    @TenantId() tenantId: string,
    @Param('planId') planId: string,
  ) {
    return this.validationService.validateBudgetImpact(tenantId, planId);
  }

  @Get('validate-before-submission/:planId')
  @ApiOperation({ summary: 'Validate plan before submission (all validations)' })
  @ApiResponse({ status: 200, description: 'Pre-submission validation result', type: PreSubmissionValidation })
  validateBeforeSubmission(
    @TenantId() tenantId: string,
    @Param('planId') planId: string,
  ) {
    return this.validationService.validateBeforeSubmission(tenantId, planId);
  }
}

import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MechanicRepository } from './mechanic.repository';
import { CreateMechanicDto } from './dto/create-mechanic.dto';
import { UpdateMechanicDto } from './dto/update-mechanic.dto';
import { Mechanic, FormulaValidationStatus } from '../../../database/entities/mechanic.entity';
import { TacticRepository } from '../tactic/tactic.repository';
import { AdminAuditService } from '../../../common/services/admin-audit.service';
import {
  DuplicateMechanicCodeException,
  InvalidFormulaException,
  CircularDependencyException,
  InvalidApplicabilityRulesException,
} from './exceptions/mechanic.exceptions';
import { PlanContextDto } from './dto/plan-context.dto';
import { ValidationResult } from './dto/validation-result.dto';
import { CombinationCheckResult } from './dto/combination-check-result.dto';

@Injectable()
export class MechanicService {
  constructor(
    private readonly mechanicRepository: MechanicRepository,
    private readonly tacticRepository: TacticRepository,
    private readonly auditService: AdminAuditService,
  ) {}

  async create(
    tenantId: string,
    createMechanicDto: CreateMechanicDto,
    adminId?: string,
    adminEmail?: string,
    ipAddress?: string,
  ): Promise<Mechanic> {
    // Validate code uniqueness
    const existing = await this.mechanicRepository.findByCode(tenantId, createMechanicDto.code);
    if (existing) {
      throw new DuplicateMechanicCodeException(createMechanicDto.code);
    }

    // Validate tactic exists
    const tactic = await this.tacticRepository.findOne({
      where: { tenantId, id: createMechanicDto.tacticId },
    });
    if (!tactic) {
      throw new NotFoundException('Tactic not found');
    }

    // Validate min < max
    if (createMechanicDto.minValue !== undefined && createMechanicDto.maxValue !== undefined) {
      if (createMechanicDto.minValue >= createMechanicDto.maxValue) {
        throw new BadRequestException('minValue must be less than maxValue');
      }
    }

    // Validate applicability rules
    this.validateApplicabilityRules(createMechanicDto);

    // Validate formula if provided
    if (createMechanicDto.calculationFormula) {
      const validationResult = await this.validateFormula(
        createMechanicDto.calculationFormula,
        createMechanicDto.testData || {},
      );
      if (!validationResult.isValid) {
        throw new InvalidFormulaException(validationResult.errorMessage || 'Invalid formula', validationResult.details);
      }
    }

    // Check circular dependencies in mutually exclusive
    if (createMechanicDto.mutuallyExclusiveWith?.length) {
      await this.checkCircularDependency(tenantId, createMechanicDto.code, createMechanicDto.mutuallyExclusiveWith);
    }

    const mechanic = this.mechanicRepository.create({
      ...createMechanicDto,
      tenantId,
      isActive: createMechanicDto.isActive ?? true,
      showInGrid: createMechanicDto.showInGrid ?? true,
      trackAgainstBudget: createMechanicDto.trackAgainstBudget ?? true,
      formulaValidationStatus: createMechanicDto.calculationFormula
        ? FormulaValidationStatus.VALID
        : FormulaValidationStatus.PENDING,
    });

    const saved = await this.mechanicRepository.save(mechanic);

    // Audit log
    if (adminId && adminEmail) {
      await this.auditService.logAdminAction(
        tenantId,
        adminId,
        adminEmail,
        'CREATE',
        'mechanic',
        saved.id,
        ipAddress,
        'SUCCESS',
        undefined,
        { code: saved.code, name: saved.name },
      );
    }

    return saved;
  }

  async findAll(tenantId: string, activeOnly = false, tacticId?: string): Promise<Mechanic[]> {
    return this.mechanicRepository.findAllByTenant(tenantId, activeOnly, tacticId);
  }

  async findOne(tenantId: string, id: string): Promise<Mechanic> {
    const mechanic = await this.mechanicRepository.findOne({
      where: { tenantId, id },
      relations: ['tactic'],
    });

    if (!mechanic) {
      throw new NotFoundException(`Mechanic with ID ${id} not found`);
    }

    return mechanic;
  }

  async update(
    tenantId: string,
    id: string,
    updateMechanicDto: UpdateMechanicDto,
    adminId?: string,
    adminEmail?: string,
    ipAddress?: string,
  ): Promise<Mechanic> {
    const mechanic = await this.findOne(tenantId, id);
    const beforeValues = { ...mechanic };

    if (updateMechanicDto.code && updateMechanicDto.code !== mechanic.code) {
      const existing = await this.mechanicRepository.findByCode(tenantId, updateMechanicDto.code);
      if (existing && existing.id !== id) {
        throw new DuplicateMechanicCodeException(updateMechanicDto.code);
      }
    }

    if (updateMechanicDto.tacticId) {
      const tactic = await this.tacticRepository.findOne({
        where: { tenantId, id: updateMechanicDto.tacticId },
      });
      if (!tactic) {
        throw new NotFoundException('Tactic not found');
      }
    }

    // Validate min < max
    const minValue = updateMechanicDto.minValue ?? mechanic.minValue;
    const maxValue = updateMechanicDto.maxValue ?? mechanic.maxValue;
    if (minValue !== undefined && maxValue !== undefined && minValue >= maxValue) {
      throw new BadRequestException('minValue must be less than maxValue');
    }

    // Validate applicability rules if changed
    if (updateMechanicDto.applicableChannels || updateMechanicDto.applicableCategories) {
      this.validateApplicabilityRules(updateMechanicDto);
    }

    // Validate formula if changed
    if (updateMechanicDto.calculationFormula) {
      const validationResult = await this.validateFormula(
        updateMechanicDto.calculationFormula,
        updateMechanicDto.testData || mechanic.testData || {},
      );
      if (!validationResult.isValid) {
        throw new InvalidFormulaException(validationResult.errorMessage || 'Invalid formula', validationResult.details);
      }
      updateMechanicDto.formulaValidationStatus = FormulaValidationStatus.VALID;
    }

    // Check circular dependencies
    const mutuallyExclusive = updateMechanicDto.mutuallyExclusiveWith ?? mechanic.mutuallyExclusiveWith;
    if (mutuallyExclusive?.length) {
      await this.checkCircularDependency(tenantId, mechanic.code, mutuallyExclusive);
    }

    Object.assign(mechanic, updateMechanicDto);
    const saved = await this.mechanicRepository.save(mechanic);

    // Audit log
    if (adminId && adminEmail) {
      await this.auditService.logAdminAction(
        tenantId,
        adminId,
        adminEmail,
        'UPDATE',
        'mechanic',
        saved.id,
        ipAddress,
        'SUCCESS',
        beforeValues,
        { code: saved.code, name: saved.name },
      );
    }

    return saved;
  }

  async remove(
    tenantId: string,
    id: string,
    adminId?: string,
    adminEmail?: string,
    ipAddress?: string,
  ): Promise<void> {
    const mechanic = await this.findOne(tenantId, id);
    await this.mechanicRepository.softRemove(mechanic);

    // Audit log
    if (adminId && adminEmail) {
      await this.auditService.logAdminAction(
        tenantId,
        adminId,
        adminEmail,
        'DELETE',
        'mechanic',
        id,
        ipAddress,
        'SUCCESS',
        { code: mechanic.code, name: mechanic.name },
        undefined,
      );
    }
  }

  async validateFormula(formula: string, testContext: Record<string, any> = {}): Promise<ValidationResult> {
    if (!formula || formula.trim().length === 0) {
      return {
        status: FormulaValidationStatus.INVALID,
        isValid: false,
        errorMessage: 'Formula cannot be empty',
      };
    }

    try {
      // Basic syntax validation - check for balanced parentheses
      const openParens = (formula.match(/\(/g) || []).length;
      const closeParens = (formula.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        return {
          status: FormulaValidationStatus.INVALID,
          isValid: false,
          errorMessage: 'Unbalanced parentheses',
        };
      }

      // Check for dangerous operations (eval, function calls, etc.)
      const dangerousPatterns = /eval|function|import|require|exec|script/i;
      if (dangerousPatterns.test(formula)) {
        return {
          status: FormulaValidationStatus.INVALID,
          isValid: false,
          errorMessage: 'Formula contains unsafe operations',
        };
      }

      // Try to evaluate with test data
      let testResult: number | null = null;
      if (Object.keys(testContext).length > 0) {
        // Create a safe evaluation context
        const safeContext: Record<string, any> = { ...testContext };
        const formulaWithContext = formula.replace(/\b([A-Z_][A-Z0-9_]*)\b/g, (match) => {
          return safeContext[match] !== undefined ? String(safeContext[match]) : match;
        });

        // Simple arithmetic evaluation (very basic - in production use a proper formula parser)
        try {
          // This is a simplified version - in production, use a proper formula parser library
          testResult = this.evaluateFormula(formulaWithContext, safeContext);
        } catch (error: any) {
          return {
            status: FormulaValidationStatus.ERROR,
            isValid: false,
            errorMessage: `Evaluation error: ${error.message}`,
            details: { error: error.message },
          };
        }
      }

      return {
        status: FormulaValidationStatus.VALID,
        isValid: true,
        testResult: testResult ?? undefined,
      };
    } catch (error: any) {
      return {
        status: FormulaValidationStatus.ERROR,
        isValid: false,
        errorMessage: error.message || 'Unknown validation error',
        details: { error: error.message },
      };
    }
  }

  private evaluateFormula(formula: string, context: Record<string, any>): number {
    // Very basic formula evaluation - replace variables and evaluate
    // NOTE: In production, use a proper formula parser library like math.js, expr-eval, or similar
    // This is a simplified placeholder implementation
    
    let expression = formula;
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      expression = expression.replace(regex, String(value));
    }

    // Basic arithmetic operations only - parse manually for safety
    // This is a very simplified parser - replace with proper library in production
    try {
      // Remove whitespace
      expression = expression.replace(/\s+/g, '');
      
      // Validate only contains safe characters
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        throw new Error('Formula contains invalid characters');
      }

      // Simple evaluation using Function constructor (safer than eval but still limited)
      // In production, use math.js: const math = require('mathjs'); return math.evaluate(expression);
      const func = new Function('return ' + expression);
      const result = func();
      
      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('Formula result is not a valid number');
      }
      
      return result;
    } catch (error: any) {
      throw new Error(`Invalid formula expression: ${error.message}`);
    }
  }

  async getApplicableMechanics(tenantId: string, planContext: PlanContextDto): Promise<Mechanic[]> {
    const allMechanics = await this.mechanicRepository.findAllByTenant(tenantId, true);

    return allMechanics.filter((mechanic) => {
      // Check channel applicability
      if (mechanic.applicableChannels && mechanic.applicableChannels.length > 0) {
        const hasAll = mechanic.applicableChannels.includes('ALL');
        const matchesChannel =
          hasAll ||
          (planContext.channelCode && mechanic.applicableChannels.includes(planContext.channelCode)) ||
          (planContext.channelId && mechanic.applicableChannels.includes(planContext.channelId));

        if (!matchesChannel) {
          return false;
        }
      }

      // Check category applicability
      if (mechanic.applicableCategories && mechanic.applicableCategories.length > 0) {
        const hasAll = mechanic.applicableCategories.includes('ALL');
        const matchesCategory =
          hasAll ||
          (planContext.categoryCode && mechanic.applicableCategories.includes(planContext.categoryCode)) ||
          (planContext.categoryId && mechanic.applicableCategories.includes(planContext.categoryId));

        if (!matchesCategory) {
          return false;
        }
      }

      // Check CPL applicability
      if (mechanic.applicableCpls && mechanic.applicableCpls.length > 0) {
        if (planContext.cplId && !mechanic.applicableCpls.includes(planContext.cplId)) {
          return false;
        }
      }

      // Check exclusion rules
      if (mechanic.exclusionRules) {
        // Implement exclusion logic based on rules
        // This is a placeholder - implement based on actual exclusion rule structure
      }

      return true;
    });
  }

  async checkCombinationValidity(
    tenantId: string,
    mechanicCodes: string[],
  ): Promise<CombinationCheckResult> {
    if (mechanicCodes.length === 0) {
      return { isValid: true };
    }

    const mechanics = await Promise.all(
      mechanicCodes.map((code) => this.mechanicRepository.findByCode(tenantId, code)),
    );

    const notFound = mechanics.findIndex((m) => !m);
    if (notFound !== -1) {
      return {
        isValid: false,
        errorMessage: `Mechanic with code '${mechanicCodes[notFound]}' not found`,
      };
    }

    const validMechanics = mechanics.filter((m) => m !== null) as Mechanic[];

    // Check mutually exclusive
    const conflicts: string[] = [];
    for (let i = 0; i < validMechanics.length; i++) {
      const mechanic = validMechanics[i];
      if (mechanic.mutuallyExclusiveWith) {
        for (let j = i + 1; j < validMechanics.length; j++) {
          const other = validMechanics[j];
          if (
            mechanic.mutuallyExclusiveWith.includes(other.code) ||
            other.mutuallyExclusiveWith?.includes(mechanic.code)
          ) {
            conflicts.push(`${mechanic.code} <-> ${other.code}`);
          }
        }
      }
    }

    if (conflicts.length > 0) {
      return {
        isValid: false,
        errorMessage: 'Mutually exclusive mechanics cannot be used together',
        conflictingMechanics: conflicts,
      };
    }

    // Check max combined discount
    const discountMechanics = validMechanics.filter(
      (m) => m.category === 'on_invoice_discount' || m.category === 'off_invoice_discount',
    );
    if (discountMechanics.length > 0) {
      const maxCombined = Math.max(
        ...discountMechanics.map((m) => m.maxCombinedDiscountPercentage || 100),
      );
      // Calculate total discount (simplified - in production, calculate from actual values)
      // This is a placeholder
      const warnings: string[] = [];
      if (maxCombined < 100) {
        warnings.push(`Total discount should not exceed ${maxCombined}%`);
      }

      return {
        isValid: true,
        warnings: warnings.length > 0 ? warnings : undefined,
        totalDiscountPercentage: maxCombined,
      };
    }

    return { isValid: true };
  }

  async cloneMechanic(
    tenantId: string,
    id: string,
    overrides: Partial<CreateMechanicDto>,
    adminId?: string,
    adminEmail?: string,
    ipAddress?: string,
  ): Promise<Mechanic> {
    const original = await this.findOne(tenantId, id);

    const newCode = overrides.code || `${original.code}_COPY`;
    const existing = await this.mechanicRepository.findByCode(tenantId, newCode);
    if (existing) {
      throw new DuplicateMechanicCodeException(newCode);
    }

    const cloneData: CreateMechanicDto = {
      code: newCode,
      name: overrides.name || `${original.name} (Copy)`,
      description: overrides.description || original.description,
      tacticId: overrides.tacticId || original.tacticId,
      mechanicType: overrides.mechanicType || original.mechanicType,
      category: overrides.category || original.category,
      spendingType: overrides.spendingType || original.spendingType,
      calculationFormula: overrides.calculationFormula || original.calculationFormula,
      ...overrides,
    };

    return this.create(tenantId, cloneData, adminId, adminEmail, ipAddress);
  }

  private validateApplicabilityRules(dto: CreateMechanicDto | UpdateMechanicDto): void {
    if (dto.applicableChannels && dto.applicableChannels.length === 0) {
      throw new InvalidApplicabilityRulesException('At least one channel must be specified or use ["ALL"]');
    }

    if (dto.applicableChannels && !dto.applicableChannels.includes('ALL') && dto.applicableChannels.length === 0) {
      throw new InvalidApplicabilityRulesException('applicableChannels cannot be empty');
    }
  }

  private async checkCircularDependency(
    tenantId: string,
    mechanicCode: string,
    mutuallyExclusiveWith: string[],
  ): Promise<void> {
    for (const otherCode of mutuallyExclusiveWith) {
      const other = await this.mechanicRepository.findByCode(tenantId, otherCode);
      if (other && other.mutuallyExclusiveWith?.includes(mechanicCode)) {
        throw new CircularDependencyException([mechanicCode, otherCode]);
      }
    }
  }
}

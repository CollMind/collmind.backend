import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MechanicRepository } from './mechanic.repository';
import { CreateMechanicDto } from './dto/create-mechanic.dto';
import { UpdateMechanicDto } from './dto/update-mechanic.dto';
import {
  Mechanic,
  FormulaValidationStatus,
} from '../../../database/entities/mechanic.entity';
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

/**
 * A mechanic bound as a comparable number, or `null` for "no bound" — T-084.
 *
 * TWO TRAPS LIVE HERE, AND THE GUARD THAT USED THESE VALUES FELL INTO BOTH.
 *
 * 1. `null` is not `undefined`. `min_value`/`max_value` are nullable, and a row
 *    read from Postgres carries `null`, never `undefined`. A guard written as
 *    `value !== undefined` therefore treats "no bound" as a real bound, and JS
 *    then coerces it: `0 >= null` is `0 >= 0`, i.e. `true`. Every mechanic with
 *    an open UPPER bound became un-editable — measured live at 3 of 6. (An open
 *    LOWER bound was never rejected: `null >= "100.0000"` is `0 >= 100`, false.
 *    The asymmetry is itself a symptom.)
 *
 * 2. These are `decimal` columns with no transformer, so TypeORM hands back
 *    STRINGS. `"50.0000" >= "100.0000"` is a lexicographic comparison and is
 *    `true`, so a perfectly ordinary range (min 50, max 100) was rejected too.
 *    The seeded 0/100 mechanics only passed by accident: `"0" < "1"`.
 *
 * Both traps are invisible to TypeScript, which types these as `number`.
 *
 * ⚠️ THE SIBLING COMPARISONS ARE **ALSO** BROKEN — see T-085.
 *
 * An earlier revision of this comment claimed they were safe, reasoning that
 * `spend-validation.service.ts:150` compares "a real number" against these
 * values and that `number < string` coerces numerically. **That was wrong, and
 * it was wrong because it was asserted instead of measured.** `enteredValue`
 * there comes from `readEnteredRaw`, i.e. straight off `plan_mechanic_values`,
 * whose `entered_*` columns were (AT THE TIME) ALSO `decimal` with no
 * transformer, on both sides — the same lexicographic comparison, on a
 * production route (`GET /spend-calculation/validate-inputs/:planFuId`), where
 * it silently missed real min violations and reported max violations that did
 * not exist.
 *
 * ⚠️ "BOTH SIDES ARE STRINGS" IS ITSELF NOW STALE (review, T-197/T-221,
 * 2026-08-15). `entered_unit_amount` carries `UnitPriceTransformer` and
 * `entered_total_amount` carries `MoneyTransformer` as of this turn — only
 * `entered_rate_pct` remains transformer-less (deliberately: Alan B/oran,
 * ADR 0007 Karar 1). So `enteredValue` is a `string` for a PERCENT mechanic and
 * a `number` for AMOUNT_PER_UNIT/AMOUNT — it depends on `mechanic.mechanicType`,
 * not a repo-wide fact. `numericTextToNumber` (called at
 * `spend-validation.service.ts:188`, `const entered =
 * numericTextToNumber(enteredValue);` — line re-verified this turn, review
 * measured `:176` as stale, that line is a comment) already handles both:
 * `typeof value === 'number' ? value : …parse…`, so the comparison itself was already correct for
 * either shape before this turn — it is the PREMISE of this paragraph, not the
 * fix, that needed correcting.
 *
 * The wrong claim is left visible rather than quietly deleted: it had been
 * written into the code as a normative "must not be fixed to match", which
 * would have protected a live defect from repair. T-085 carries the fix.
 *
 * The rule this file follows: a decimal column reaches JS as a string unless a
 * transformer says otherwise — and whether one does is a PER-COLUMN question,
 * not a per-repo one, nor (per the correction above) a per-entity one. The repo
 * DOES have `DecimalTransformer` (`src/database/transformers/decimal.transformer.ts`),
 * applied to the budget and sales-actual entities, and its `MoneyTransformer`/
 * `UnitPriceTransformer` siblings, applied to most (not all — see above)
 * `plan_mechanic_values.entered_*` columns. It is simply not declared on
 * `mechanics.min_value` / `max_value` (this file's entity — `@Column({ name:
 * 'min_value', ... })` at `:121`, `@Column({ name: 'max_value', ... })` at
 * `:130`; line re-verified this turn, review measured `lines 88-105` as
 * stale, that range is `mechanic_type`/`calculation_rules`) or on
 * `plan_mechanic_values.entered_rate_pct`. So: check the column, then normalise.
 *
 * (An earlier revision of this paragraph said "this repo has no transformers".
 * That was measured on the two entities in front of me and generalised to the
 * repo — the exact failure CLAUDE.md §7.1 was written about, committed in the
 * same change that added the rule. Left visible.)
 *
 * ⚠️ THIS FUNCTION IS A KNOWN DUPLICATE, AND THAT IS A DECISION — see T-087.
 *
 * (ADVISORY, not guard-enforced — CLAUDE.md §4.2. The guard that would enforce
 * it is exactly what T-086 builds; until then this comment is the only defence,
 * and a weak one.)
 *
 * `toNullableNumber` in `plan.service.ts` is semantically identical. Normally
 * §7 would require extracting one shared version into `src/common/numeric/`.
 * That is deliberately NOT done yet, because the obvious move would be
 * dishonest twice over:
 *
 *   - `plan.service.ts:119` (`Number(raw)`) is one of that file's 36 ratchet
 *     findings. Moving the function out drops it to 35 — but nothing was fixed.
 *   - `src/common/numeric/` is where the money-float detector does not fire
 *     (ADR 0007 E15). The finding would not reappear at the destination. The
 *     ratchet would record a repayment that never happened, and the pattern
 *     would generalise: anyone under ratchet pressure could relocate into that
 *     directory. Measured: the exempt directory is filtered out of the scan
 *     entirely, so the ratchet's own "NEW Domain A file" check never even fires
 *     on it — the move exits 0 and looks like an improvement.
 *
 * A visible duplicate is a debt you can see. Laundered ratchet debt is one you
 * cannot. So the duplicate stays until T-086 makes the E15 exemption per-FILE
 * instead of per-directory; after that a move is honest, because a relocated
 * file is not on the exempt list and its findings are counted at the
 * destination. T-087 then does the extraction.
 *
 * Do not "clean this up" before T-086 lands.
 */
function boundOf(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

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
    const existing = await this.mechanicRepository.findByCode(
      tenantId,
      createMechanicDto.code,
    );
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

    // Validate min < max. T-084: both sides through `boundOf`, so an absent
    // bound is a non-bound rather than a zero. `>=` is preserved deliberately —
    // min == max has always been rejected, and whether an equal pair should be
    // legal is a product question nobody has answered (CLAUDE.md §2.4).
    const createMin = boundOf(createMechanicDto.minValue);
    const createMax = boundOf(createMechanicDto.maxValue);
    if (createMin !== null && createMax !== null && createMin >= createMax) {
      throw new BadRequestException('minValue must be less than maxValue');
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
        throw new InvalidFormulaException(
          validationResult.errorMessage || 'Invalid formula',
          validationResult.details,
        );
      }
    }

    // Check circular dependencies in mutually exclusive
    if (createMechanicDto.mutuallyExclusiveWith?.length) {
      await this.checkCircularDependency(
        tenantId,
        createMechanicDto.code,
        createMechanicDto.mutuallyExclusiveWith,
      );
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

  async findAll(
    tenantId: string,
    activeOnly = false,
    tacticId?: string,
  ): Promise<Mechanic[]> {
    return this.mechanicRepository.findAllByTenant(
      tenantId,
      activeOnly,
      tacticId,
    );
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
      const existing = await this.mechanicRepository.findByCode(
        tenantId,
        updateMechanicDto.code,
      );
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

    // Validate min < max. T-084: the incoming DTO value wins, otherwise the
    // stored one — and BOTH go through `boundOf`, which is what makes this
    // correct for the two traps `boundOf` documents. The stored value is a string
    // from a `decimal` column and may be `null`; the DTO value is a real number.
    //
    // ⚠️ A THIRD gap is still open here and `boundOf` does not close it — T-088.
    // `??` treats an EXPLICIT `null` in the body as "not supplied", so
    // `PATCH {minValue: null}` is validated against the STORED min while
    // `Object.assign` below persists the null. The state validated is not the
    // state written, and a legitimate "drop the floor, set the ceiling to 10"
    // is rejected. Pre-existing, not introduced here.
    const minValue = boundOf(updateMechanicDto.minValue ?? mechanic.minValue);
    const maxValue = boundOf(updateMechanicDto.maxValue ?? mechanic.maxValue);
    if (minValue !== null && maxValue !== null && minValue >= maxValue) {
      throw new BadRequestException('minValue must be less than maxValue');
    }

    // Validate applicability rules if changed
    if (
      updateMechanicDto.applicableChannels ||
      updateMechanicDto.applicableCategories
    ) {
      this.validateApplicabilityRules(updateMechanicDto);
    }

    // Validate formula if changed
    if (updateMechanicDto.calculationFormula) {
      const validationResult = await this.validateFormula(
        updateMechanicDto.calculationFormula,
        updateMechanicDto.testData || mechanic.testData || {},
      );
      if (!validationResult.isValid) {
        throw new InvalidFormulaException(
          validationResult.errorMessage || 'Invalid formula',
          validationResult.details,
        );
      }
      updateMechanicDto.formulaValidationStatus = FormulaValidationStatus.VALID;
    }

    // Check circular dependencies
    const mutuallyExclusive =
      updateMechanicDto.mutuallyExclusiveWith ?? mechanic.mutuallyExclusiveWith;
    if (mutuallyExclusive?.length) {
      await this.checkCircularDependency(
        tenantId,
        mechanic.code,
        mutuallyExclusive,
      );
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

  async validateFormula(
    formula: string,
    testContext: Record<string, any> = {},
  ): Promise<ValidationResult> {
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
        const formulaWithContext = formula.replace(
          /\b([A-Z_][A-Z0-9_]*)\b/g,
          (match) => {
            return safeContext[match] !== undefined
              ? String(safeContext[match])
              : match;
          },
        );

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

  private evaluateFormula(
    formula: string,
    context: Record<string, any>,
  ): number {
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

  async getApplicableMechanics(
    tenantId: string,
    planContext: PlanContextDto,
  ): Promise<Mechanic[]> {
    const allMechanics = await this.mechanicRepository.findAllByTenant(
      tenantId,
      true,
    );

    return allMechanics.filter((mechanic) => {
      // Check channel applicability
      if (
        mechanic.applicableChannels &&
        mechanic.applicableChannels.length > 0
      ) {
        const hasAll = mechanic.applicableChannels.includes('ALL');
        const matchesChannel =
          hasAll ||
          (planContext.channelCode &&
            mechanic.applicableChannels.includes(planContext.channelCode)) ||
          (planContext.channelId &&
            mechanic.applicableChannels.includes(planContext.channelId));

        if (!matchesChannel) {
          return false;
        }
      }

      // Check category applicability
      if (
        mechanic.applicableCategories &&
        mechanic.applicableCategories.length > 0
      ) {
        const hasAll = mechanic.applicableCategories.includes('ALL');
        const matchesCategory =
          hasAll ||
          (planContext.categoryCode &&
            mechanic.applicableCategories.includes(planContext.categoryCode)) ||
          (planContext.categoryId &&
            mechanic.applicableCategories.includes(planContext.categoryId));

        if (!matchesCategory) {
          return false;
        }
      }

      // Check CPL applicability
      if (mechanic.applicableCpls && mechanic.applicableCpls.length > 0) {
        if (
          planContext.cplId &&
          !mechanic.applicableCpls.includes(planContext.cplId)
        ) {
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
      mechanicCodes.map((code) =>
        this.mechanicRepository.findByCode(tenantId, code),
      ),
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
      (m) =>
        m.category === 'on_invoice_discount' ||
        m.category === 'off_invoice_discount',
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
    const existing = await this.mechanicRepository.findByCode(
      tenantId,
      newCode,
    );
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
      calculationFormula:
        overrides.calculationFormula || original.calculationFormula,
      ...overrides,
    };

    return this.create(tenantId, cloneData, adminId, adminEmail, ipAddress);
  }

  private validateApplicabilityRules(
    dto: CreateMechanicDto | UpdateMechanicDto,
  ): void {
    if (dto.applicableChannels && dto.applicableChannels.length === 0) {
      throw new InvalidApplicabilityRulesException(
        'At least one channel must be specified or use ["ALL"]',
      );
    }

    if (
      dto.applicableChannels &&
      !dto.applicableChannels.includes('ALL') &&
      dto.applicableChannels.length === 0
    ) {
      throw new InvalidApplicabilityRulesException(
        'applicableChannels cannot be empty',
      );
    }
  }

  private async checkCircularDependency(
    tenantId: string,
    mechanicCode: string,
    mutuallyExclusiveWith: string[],
  ): Promise<void> {
    for (const otherCode of mutuallyExclusiveWith) {
      const other = await this.mechanicRepository.findByCode(
        tenantId,
        otherCode,
      );
      if (other && other.mutuallyExclusiveWith?.includes(mechanicCode)) {
        throw new CircularDependencyException([mechanicCode, otherCode]);
      }
    }
  }
}

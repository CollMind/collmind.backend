import { Injectable, Logger } from '@nestjs/common';

export interface ParsedFormula {
  type: 'expression' | 'conditional' | 'user_input' | 'external' | 'javascript';
  dependencies: string[];
  execute: (context: Record<string, any>) => any;
  raw: string;
}

export interface FormulaValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

@Injectable()
export class FormulaParserService {
  private readonly logger = new Logger(FormulaParserService.name);

  // Known function names to exclude from variable extraction
  private readonly FUNCTION_NAMES = new Set([
    'IF',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'ABS',
    'ROUND',
    'FLOOR',
    'CEIL',
    'AND',
    'OR',
    'NOT',
    'TRUE',
    'FALSE',
    'NULL',
  ]);

  /**
   * Parse a formula string and return an executable ParsedFormula
   */
  parseFormula(formulaText: string, formulaType: string): ParsedFormula {
    const dependencies = this.extractDependencies(formulaText);

    switch (formulaType) {
      case 'expression':
        return this.parseExpression(formulaText, dependencies);
      case 'conditional':
        return this.parseConditional(formulaText, dependencies);
      case 'user_input':
      case 'external':
        return {
          type: formulaType as any,
          dependencies: [],
          execute: (context) => context[formulaText] ?? null,
          raw: formulaText,
        };
      default:
        return this.parseExpression(formulaText, dependencies);
    }
  }

  /**
   * Extract variable names (KPI codes) from a formula
   */
  extractDependencies(formula: string): string[] {
    const variablePattern = /\b([A-Z][A-Z0-9_]+)\b/g;
    const matches = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = variablePattern.exec(formula)) !== null) {
      const varName = match[1];
      if (!this.FUNCTION_NAMES.has(varName)) {
        matches.add(varName);
      }
    }

    return Array.from(matches);
  }

  /**
   * Validate a formula string
   */
  validateFormula(
    formula: string,
    formulaType: string,
  ): FormulaValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!formula || formula.trim().length === 0) {
      errors.push('Formül boş olamaz');
      return { isValid: false, errors, warnings };
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      'eval',
      'require',
      'import',
      'process',
      'global',
      'window',
      'document',
      'fetch',
      'XMLHttpRequest',
    ];
    for (const pattern of dangerousPatterns) {
      if (formula.toLowerCase().includes(pattern)) {
        errors.push(`Güvenlik: "${pattern}" kullanılamaz`);
      }
    }

    // Check balanced parentheses
    let parenCount = 0;
    for (const char of formula) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (parenCount < 0) {
        errors.push('Parantezler dengeli değil');
        break;
      }
    }
    if (parenCount !== 0) {
      errors.push('Parantezler dengeli değil');
    }

    // Type-specific validation
    if (formulaType === 'conditional') {
      if (!formula.includes('IF(') && !formula.includes('if(')) {
        warnings.push('Conditional formül IF() içermeli');
      }
    }

    const dependencies = this.extractDependencies(formula);
    if (dependencies.length === 0 && formulaType === 'expression') {
      warnings.push('Formülde hiç KPI referansı bulunamadı');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Parse a mathematical expression formula
   */
  private parseExpression(
    formula: string,
    dependencies: string[],
  ): ParsedFormula {
    return {
      type: 'expression',
      dependencies,
      execute: (context: Record<string, any>) => {
        try {
          // Check all dependencies are available
          for (const dep of dependencies) {
            if (context[dep] === undefined || context[dep] === null) {
              return null;
            }
          }

          // Replace variable names with values
          let expression = formula;
          for (const dep of dependencies) {
            const value = Number(context[dep]);
            if (isNaN(value)) return null;
            // ⛔ [[T-334]] review `B1`/`B1b` — YERİNE KOYMA **PARANTEZLİDİR**.
            // Değer NEGATİF olduğunda çıplak yerine koyma `A-B` formülünü
            // `-1200--1500`'e çeviriyor; JS bunu **postfix `--`** diye
            // ayrıştırıp `SyntaxError` fırlatıyor ⇒ `catch` ⇒ **sessizce
            // `null`** (ölçüldü: `INCR_GP` + `GP_ROI_PCT` + RAG birlikte
            // kayboluyordu). Parantez üç şeyi birden kapatır:
            //   (a) BOŞLUKTAN BAĞIMSIZ — `A-B` de `A - B` de düzelir
            //       (ilk düzeltme yalnız boşukluyu kurtarıyordu),
            //   (b) operatör bitişikliğinden doğan HİÇBİR yeni token
            //       üretmez (`//` yorum ayrışması dahil),
            //   (c) beyaz listenin denetlediği dizge ile değerlendirilen
            //       dizge AYNI kalır (`§2.7`: ölçülen ≠ değerlendirilen
            //       ayrışması) — ilk düzeltme tam bunu bozmuştu.
            expression = expression.replace(
              new RegExp(`\\b${dep}\\b`, 'g'),
              `(${value})`,
            );
          }

          return this.safeEval(expression);
        } catch (error) {
          this.logger.warn(
            `Expression evaluation error for "${formula}": ${error}`,
          );
          return null;
        }
      },
      raw: formula,
    };
  }

  /**
   * Parse a conditional (IF) formula
   */
  private parseConditional(
    formula: string,
    dependencies: string[],
  ): ParsedFormula {
    return {
      type: 'conditional',
      dependencies,
      execute: (context: Record<string, any>) => {
        try {
          // Check all dependencies are available
          for (const dep of dependencies) {
            if (context[dep] === undefined || context[dep] === null) {
              return null;
            }
          }

          // Replace variable names with values
          let expression = formula;
          for (const dep of dependencies) {
            const value = Number(context[dep]);
            if (isNaN(value)) return null;
            // ⛔ [[T-334]] review `B1`/`B1b` — YERİNE KOYMA **PARANTEZLİDİR**.
            // Değer NEGATİF olduğunda çıplak yerine koyma `A-B` formülünü
            // `-1200--1500`'e çeviriyor; JS bunu **postfix `--`** diye
            // ayrıştırıp `SyntaxError` fırlatıyor ⇒ `catch` ⇒ **sessizce
            // `null`** (ölçüldü: `INCR_GP` + `GP_ROI_PCT` + RAG birlikte
            // kayboluyordu). Parantez üç şeyi birden kapatır:
            //   (a) BOŞLUKTAN BAĞIMSIZ — `A-B` de `A - B` de düzelir
            //       (ilk düzeltme yalnız boşukluyu kurtarıyordu),
            //   (b) operatör bitişikliğinden doğan HİÇBİR yeni token
            //       üretmez (`//` yorum ayrışması dahil),
            //   (c) beyaz listenin denetlediği dizge ile değerlendirilen
            //       dizge AYNI kalır (`§2.7`: ölçülen ≠ değerlendirilen
            //       ayrışması) — ilk düzeltme tam bunu bozmuştu.
            expression = expression.replace(
              new RegExp(`\\b${dep}\\b`, 'g'),
              `(${value})`,
            );
          }

          return this.evaluateConditional(expression);
        } catch (error) {
          this.logger.warn(
            `Conditional evaluation error for "${formula}": ${error}`,
          );
          return null;
        }
      },
      raw: formula,
    };
  }

  /**
   * Safely evaluate a mathematical expression
   * Uses Function constructor with whitelist for safe execution
   */
  private safeEval(expression: string): number | null {
    try {
      // Only allow: numbers, operators, parentheses, decimal points, whitespace
      const sanitized = expression.replace(/\s/g, '');
      if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
        this.logger.warn(`Unsafe expression blocked: ${expression}`);
        return null;
      }

      // ⛔ [[T-334]] review `B1` — DEĞERLENDİRİLEN DİZGE, BEYAZ LİSTENİN
      // DENETLEDİĞİ DİZGENİN TA KENDİSİDİR (`sanitized`).
      //
      // Bir ara sürümde burada `const evaluable = expression` (boşluklu
      // hâl) vardı ve **ölçülen ile değerlendirilen AYRIŞMIŞTI**. Sonuç
      // bir güvenlik açığı değil, bir **DOĞRULUK** açığıydı — ölçüldü:
      //   girdi `"1 // 2\n+ 5"` → beyaz liste `"1//2+5"` görür, GEÇER;
      //   boşluklu hâl değerlendirilince `//` bir **YORUM** olur ve
      //   ifadenin yarısı düşer ⇒ `null` yerine **`6`** (kısmi sayı).
      // Negatif operand sorunu artık yerine koymanın kendisinde
      // (parantezle) çözüldüğü için bu ayrışmaya hiç gerek yok.

      // Division by zero check
      if (
        /\/\s*0(?:\.\s*0*)?(?:[^0-9.]|$)/.test(sanitized) ||
        /\/0$/.test(sanitized)
      ) {
        return null;
      }

      const fn = new Function(`"use strict"; return (${sanitized});`);
      const result = fn();

      if (typeof result !== 'number' || !isFinite(result)) {
        return null;
      }

      return result;
    } catch {
      return null;
    }
  }

  /**
   * Evaluate a conditional expression like IF(condition, trueVal, falseVal)
   */
  private evaluateConditional(expression: string): any {
    // Handle nested IF statements
    const ifPattern =
      /IF\s*\(([^,]+),\s*([^,)]+(?:\([^)]*\))?),\s*([^)]+(?:\([^)]*\))?)\)/i;

    let result = expression;
    let maxIterations = 10;

    while (ifPattern.test(result) && maxIterations > 0) {
      result = result.replace(ifPattern, (_, condition, trueVal, falseVal) => {
        const condResult = this.evaluateCondition(condition.trim());
        const selectedVal = condResult ? trueVal.trim() : falseVal.trim();
        return selectedVal;
      });
      maxIterations--;
    }

    // Clean up string quotes
    result = result.replace(/^'|'$/g, '').replace(/^"|"$/g, '');

    // Try to convert to number if possible
    const numResult = Number(result);
    return isNaN(numResult) ? result : numResult;
  }

  /**
   * Evaluate a boolean condition (e.g., "25 >= 20")
   */
  private evaluateCondition(condition: string): boolean {
    // Match comparison operators
    const compPattern = /^(.+?)\s*(>=|<=|>|<|==|!=)\s*(.+)$/;
    const match = condition.match(compPattern);

    if (!match) {
      // Try to evaluate as a number (truthy check)
      return !!this.safeEval(condition);
    }

    const left = this.safeEval(match[1].trim());
    const right = this.safeEval(match[3].trim());

    if (left === null || right === null) return false;

    switch (match[2]) {
      case '>=':
        return left >= right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '<':
        return left < right;
      case '==':
        return left === right;
      case '!=':
        return left !== right;
      default:
        return false;
    }
  }
}

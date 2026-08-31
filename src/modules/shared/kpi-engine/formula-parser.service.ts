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
          //
          // ⚠️ Bu dal BRD'nin **KURAL-`null`**'ıdır (*"eksik veri → null"*,
          // `CLAUDE.md §2.3`), bir hata değil. Hata dalıyla ayırt edilmesi
          // [[T-102]]'nin konusu — bkz. `substituteDependencies` başlığı.
          for (const dep of dependencies) {
            if (context[dep] === undefined || context[dep] === null) {
              return null;
            }
          }

          const expression = this.substituteDependencies(
            formula,
            dependencies,
            context,
          );
          if (expression === null) return null;
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
          //
          // ⚠️ Bu dal BRD'nin **KURAL-`null`**'ıdır (*"eksik veri → null"*,
          // `CLAUDE.md §2.3`), bir hata değil. Hata dalıyla ayırt edilmesi
          // [[T-102]]'nin konusu — bkz. `substituteDependencies` başlığı.
          for (const dep of dependencies) {
            if (context[dep] === undefined || context[dep] === null) {
              return null;
            }
          }

          const expression = this.substituteDependencies(
            formula,
            dependencies,
            context,
          );
          if (expression === null) return null;
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
   * Bağımlılıkları formül metnine yerine koyar. **`parseExpression` ve
   * `parseConditional`'ın TEK ORTAK yolu** — daha önce blok iki kez
   * yazılıydı ve [[T-334]]'ün parantez düzeltmesi iki ayrı kopyaya elle
   * uygulanmıştı (`CLAUDE.md §7`: aynı yetenek bir kez yazılır; ikinci
   * kopya bir sonraki düzeltmede unutulur).
   *
   * Dönüş `null` ⇒ **yerine koyma yapılamadı** (bağımlılık sayıya
   * çevrilemedi ya da sonlu değil). Bu bir **HATA-`null`**'dır; çağıranın
   * yukarısındaki eksik-bağımlılık dalı ise BRD'nin **KURAL-`null`**'ı
   * ([[T-102]] — ikisi bugün aynı `null` olarak dışarı çıkıyor).
   *
   * ⛔ **YERİNE KOYMA PARANTEZLİDİR** ([[T-334]] review `B1`/`B1b`).
   * Değer NEGATİF olduğunda çıplak yerine koyma `A-B` formülünü
   * `-1200--1500`'e çeviriyor; JS bunu **postfix `--`** diye ayrıştırıp
   * `SyntaxError` fırlatıyor ⇒ `catch` ⇒ **sessizce `null`** (ölçüldü:
   * `INCR_GP` + `GP_ROI_PCT` + RAG birlikte kayboluyordu). Parantez üç
   * şeyi birden kapatır:
   *   (a) BOŞLUKTAN BAĞIMSIZ — `A-B` de `A - B` de düzelir,
   *   (b) operatör bitişikliğinden doğan HİÇBİR yeni token üretmez
   *       (`//` yorum ayrışması dahil),
   *   (c) beyaz listenin denetlediği dizge ile değerlendirilen dizge AYNI
   *       kalır (`§2.7`).
   *
   * ⛔ **VE SONLULUK GİRDİDE DENETLENİR** ([[T-099]] nokta 5). Eskiden
   * `isNaN(value)` vardı ve `Number.isNaN(Infinity) === false` olduğu için
   * `Infinity` buradan **geçiyordu**; `null` dönmesini sağlayan şey
   * `safeEval`'in beyaz listesiydi — yani doğru sonuç **tesadüfen**, ikinci
   * bir kapıdan geliyordu. Girdi tarafı artık çıktı tarafındaki `isFinite`
   * ile **simetrik**: T-099'un raporladığı asimetri budur ve kapandı.
   * Davranış (dönüş `null`) değişmedi — ölçüldü, spec'te pinli.
   */
  private substituteDependencies(
    formula: string,
    dependencies: string[],
    context: Record<string, unknown>,
  ): string | null {
    let expression = formula;
    for (const dep of dependencies) {
      const value = Number(context[dep]);
      if (!Number.isFinite(value)) {
        this.logger.warn(
          `Dependency "${dep}" is not a finite number in "${formula}"`,
        );
        return null;
      }
      expression = expression.replace(
        new RegExp(`\\b${dep}\\b`, 'g'),
        `(${this.toFixedNotation(value)})`,
      );
    }
    return expression;
  }

  /**
   * `String(value)`'nun **SABİT GÖSTERİM** hâli — [[T-341]].
   *
   * ```
   * String(1e-7)  === '1e-7'      beyaz liste /^[0-9+\-*\/().]+$/ 'e' KABUL ETMEZ
   * ⇒ hesaplanabilir bir ara değer KPI'ı SESSİZCE null yapıyordu (§2.5)
   * ayırt edici: 0.000001 çalışıyor · 0.0000001 null   (|v| < 1e-6 · |v| >= 1e21)
   * ```
   *
   * ⛔ **BEYAZ LİSTE GENİŞLETİLMEDİ** — `T-341`'in `(a)` adayı (`e`'yi
   * beyaz listeye almak) ÖLÇÜLDÜ ve **REDDEDİLDİ**: `1e-400` beyaz listeden
   * geçer ve **sessizce `0`** olur (sıfıra-bölme deseni de onu görmez), yani
   * dürüst bir `null`'ın yerine YANLIŞ BİR SAYI koyardı — `T-334`'ün ilk
   * düzeltmesinin battığı sınıf.
   *
   * ⛔ **`toFixed` DE ÖLÇÜLDÜ ve REDDEDİLDİ** (görev metnindeki `(b)`
   * varyantı): `(5e-324).toFixed(20) === '0.00000000000000000000'` ⇒ **sessiz
   * sıfır**, ve `(1e21).toFixed(2) === '1e+21'` ⇒ BÜYÜK tarafı hiç
   * düzeltmiyor. İkisi de `§2.5` ihlali olurdu.
   *
   * Yürürlükteki şekil: `String(v)`'nun **METİNSEL** açılımı. `String(v)`
   * zaten *round-trip garantili en kısa gösterimdir*; ondalık noktayı
   * kaydırmak basamakları DEĞİŞTİRMEZ ⇒ **kayıp sıfır**. Ölçüldü:
   * `1e-320`..`1e+320` aralığında 3.000.000 rastgele örnekte
   * `Number(expand(v)) === v` **3.000.000/3.000.000**, beyaz liste ihlali 0.
   *
   * Sonlu-olmayan girdi buraya HİÇ ulaşmaz (`substituteDependencies`
   * `Number.isFinite` ile eler) — `'Infinity'`/`'NaN'` metinleri bu
   * fonksiyondan çıkamaz.
   */
  private toFixedNotation(value: number): string {
    const text = String(value);
    const parts = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
    if (parts === null) return text;

    const sign = parts[1];
    const intDigits = parts[2];
    const fracDigits = parts[3] ?? '';
    const exponent = Number(parts[4]);

    const digits = intDigits + fracDigits;
    const pointAt = intDigits.length + exponent;

    if (pointAt <= 0) {
      return `${sign}0.${'0'.repeat(-pointAt)}${digits}`;
    }
    if (pointAt >= digits.length) {
      return `${sign}${digits}${'0'.repeat(pointAt - digits.length)}`;
    }
    return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
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
    let notEvaluable = false;

    while (ifPattern.test(result) && maxIterations > 0) {
      result = result.replace(ifPattern, (_, condition, trueVal, falseVal) => {
        const condResult = this.evaluateCondition(condition.trim());
        // ⛔ [[T-334]] adlandırdı, bu tur KAPATTI — `null` DAL SEÇMEZ.
        // Eskiden `condResult` `false`'a düşüyordu ve **yanlış dal**
        // sessizce seçiliyordu. Ölçülmüş üç vaka (bkz. spec):
        //   IF(ABS(A) > 0, 1, 2)   A=5   → 2   (ABS beyaz listede yok)
        //   IF(ABS(A), 1, 2)       A=5   → 2   (karşılaştırmasız dal)
        //   IF(A / 0 > 0, 1, 2)    A=5   → 2   ← EN AĞIRI: sıfıra bölme
        //                                        BRD'nin KURAL-`null`'ıdır,
        //                                        kesin bir dal kararına
        //                                        dönüşüyordu (`§2.5`).
        if (condResult === null) {
          notEvaluable = true;
          return '';
        }
        return condResult ? trueVal.trim() : falseVal.trim();
      });
      if (notEvaluable) return null;
      maxIterations--;
    }

    // Yineleme bütçesi bittiği hâlde hâlâ çözülmemiş `IF(` varsa ifade
    // çözülmemiştir. Eskiden bu durumda ham metin dönüyordu ve
    // `CalculationResult.value` (`number | null`) alanına bir DİZGE
    // sızıyordu — `null`'dan daha sessiz bir yanlış. Artık `null`.
    if (ifPattern.test(result)) return null;

    // Clean up string quotes
    result = result.replace(/^'|'$/g, '').replace(/^"|"$/g, '');

    // Try to convert to number if possible
    const numResult = Number(result);
    return isNaN(numResult) ? result : numResult;
  }

  /**
   * Evaluate a boolean condition (e.g., "25 >= 20").
   *
   * `null` ⇒ **koşul değerlendirilemedi** (`true`/`false` DEĞİL). Çağıran
   * bunu bir dal seçimine çevirmez; tüm `IF` `null` olur.
   */
  private evaluateCondition(condition: string): boolean | null {
    // Match comparison operators
    const compPattern = /^(.+?)\s*(>=|<=|>|<|==|!=)\s*(.+)$/;
    const match = condition.match(compPattern);

    if (!match) {
      // Try to evaluate as a number (truthy check). `safeEval` `null`'ı
      // "değerlendirilemedi" demektir ve `!!null === false` onu bir KARARA
      // çevirirdi — `§2.5`. `null` yukarı yayılır.
      const value = this.safeEval(condition);
      return value === null ? null : !!value;
    }

    const left = this.safeEval(match[1].trim());
    const right = this.safeEval(match[3].trim());

    // İki taraftan biri değerlendirilemiyorsa koşulun DOĞRULUK DEĞERİ YOKTUR.
    // `false` dönmek onu "koşul sağlanmadı"ya çevirir ve `IF`'in else dalını
    // KESİN bir sonuç gibi üretir.
    if (left === null || right === null) return null;

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
        // `compPattern` bu dalı bugün üretemez; üretebilseydi `false`
        // "koşul sağlanmadı" diye okunurdu — bilinmeyen operatör bir
        // karar değil, bir değerlendirilememezliktir.
        return null;
    }
  }
}

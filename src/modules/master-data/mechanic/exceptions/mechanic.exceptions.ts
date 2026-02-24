import { BadRequestException, ConflictException } from '@nestjs/common';

export class DuplicateMechanicCodeException extends ConflictException {
  constructor(code: string) {
    super(`Mechanic with code '${code}' already exists`);
  }
}

export class InvalidFormulaException extends BadRequestException {
  constructor(message: string, details?: any) {
    super({
      message: `Invalid formula: ${message}`,
      details,
    });
  }
}

export class CircularDependencyException extends BadRequestException {
  constructor(mechanicCodes: string[]) {
    super({
      message: 'Circular dependency detected in mutually exclusive mechanics',
      details: { mechanicCodes },
    });
  }
}

export class InvalidApplicabilityRulesException extends BadRequestException {
  constructor(message: string) {
    super(`Invalid applicability rules: ${message}`);
  }
}

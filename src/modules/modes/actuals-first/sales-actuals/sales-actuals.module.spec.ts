/**
 * sales-actuals.module.spec.ts — Modül sınır bekçisi (T-020 koşul 3/4).
 *
 * Actuals ingestion + saklama + okuma dışına ASLA çıkmamalı: Ledger/Budget/
 * KpiEngine/SpendCalculation/Approval/Plan/Agreement/Settlement modülleri
 * import edilemez. Bu test, birisi ileride "KPI'ya da yazalım" diye bu
 * modülü genişletmeye kalkarsa derleme zamanında değil ama CI'da kırılır.
 */
import { SalesActualsModule } from './sales-actuals.module';

const FORBIDDEN_MODULE_NAMES = [
  'LedgerModule',
  'BudgetModule',
  'KpiEngineModule',
  'SpendCalculationModule',
  'ApprovalModule',
  'PlanModule',
  'AgreementModule',
  'AgreementTransactionModule',
  'SettlementModule',
];

describe('SalesActualsModule — module boundary', () => {
  it("imports metadata'sında yasaklı hiçbir modül YOKTUR", () => {
    const imports: any[] =
      Reflect.getMetadata('imports', SalesActualsModule) ?? [];

    const importedNames = imports.map((imp) => {
      // forwardRef(() => X) -> { forwardRef: () => X }
      if (typeof imp === 'object' && typeof imp.forwardRef === 'function') {
        return imp.forwardRef().name;
      }
      return imp?.name ?? String(imp);
    });

    for (const forbidden of FORBIDDEN_MODULE_NAMES) {
      expect(importedNames).not.toContain(forbidden);
    }
  });

  it('sadece izinli modülleri import eder (TypeOrmModule dinamik + MasterDataModule + CommonModule)', () => {
    const imports: any[] =
      Reflect.getMetadata('imports', SalesActualsModule) ?? [];
    const staticImportNames = imports
      .filter((imp) => typeof imp === 'function')
      .map((imp) => imp.name);

    expect(staticImportNames.sort()).toEqual(
      ['MasterDataModule', 'CommonModule'].sort(),
    );
  });

  it('providers listesi yalnızca ingestion/saklama/okuma servislerini içerir', () => {
    const providers: any[] =
      Reflect.getMetadata('providers', SalesActualsModule) ?? [];
    const providerNames = providers.map((p) => p.name);

    expect(providerNames.sort()).toEqual(
      [
        'SalesActualsService',
        'SalesActualsRepository',
        'SalesActualsLookupService',
        'SalesActualsValidationService',
      ].sort(),
    );
  });
});

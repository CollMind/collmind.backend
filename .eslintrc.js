const fs = require('fs');
const path = require('path');

/**
 * NEW MODULES — read from the SINGLE declaration (ADR 0007 Karar 8.2, E11).
 *
 * The same file is read by scripts/guards/money-float.sh, which uses it to
 * decide which paths run in `block` instead of report-only. Two consumers, one
 * declaration: if membership were listed twice it would drift, and this repo
 * has seven recorded cases of exactly that failure.
 */
function newModuleGlobs() {
  const decl = path.join(__dirname, 'scripts/guards/new-modules.txt');
  if (!fs.existsSync(decl)) return [];
  return fs
    .readFileSync(decl, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((dir) => `${dir}/**/*.ts`);
}

/**
 * Identifiers that legitimately carry a plain `number` in any module: counts,
 * indices, pagination, versions. Everything else in a new module's entity /
 * DTO / repository surface must be a branded scale (ADR 0007 errata E1: the
 * brand is a SLOT gate, so a `number` slot silently reopens it).
 */
const NON_MONEY_IDENTIFIERS =
  '^(count|index|idx|page|pageSize|limit|offset|version|order|sequence|' +
  'length|size|total(Count|Rows|Items)|retries|attempts|priority|decimalPlaces)$';

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
  overrides: [
    {
      // T-028a rol konsolidasyonu — bkz. docs/analysis/0004-rbac-brd-alignment.md
      // §2. UserRole.MANAGER/FINANCE/APPROVER deprecated alias'lardır (enum'dan
      // PostgreSQL kısıtı nedeniyle silinemezler, bkz. user.entity.ts JSDoc) —
      // canonical CATEGORY_MANAGER/FINANCE_MANAGER kullanılmalı. Bu kural asıl
      // regresyon kalkanıdır: bir controller/servis bu alias'lardan birini
      // kullanırsa lint hata verir.
      files: ['src/modules/**/*.ts'],
      excludedFiles: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "MemberExpression[object.name='UserRole'][property.name='MANAGER']",
            message:
              "UserRole.MANAGER deprecated'tır — canonical: UserRole.CATEGORY_MANAGER kullanın (bkz. docs/analysis/0004-rbac-brd-alignment.md).",
          },
          {
            selector:
              "MemberExpression[object.name='UserRole'][property.name='FINANCE']",
            message:
              "UserRole.FINANCE deprecated'tır — canonical: UserRole.FINANCE_MANAGER kullanın (bkz. docs/analysis/0004-rbac-brd-alignment.md).",
          },
          {
            selector:
              "MemberExpression[object.name='UserRole'][property.name='APPROVER']",
            message:
              "UserRole.APPROVER deprecated'tır — canonical: UserRole.CATEGORY_MANAGER kullanın (bkz. docs/analysis/0004-rbac-brd-alignment.md).",
          },
        ],
      },
    },
    {
      // ADR 0007 Karar 3a + errata E1 — branded values come from the factory only.
      // tsc cannot catch `n as unknown as MoneyMinor` (measured, 0013 §3.1 row 10),
      // so the cast ban is a lint rule. src/common/numeric is the factory itself
      // and is therefore exempt.
      files: ['src/**/*.ts'],
      excludedFiles: ['src/common/numeric/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'TSAsExpression > TSTypeReference[typeName.name=/^(MoneyMinor|RateMicro)$/]',
            message:
              'Branded numeric types are produced by src/common/numeric factories only; ' +
              '`as` casts are forbidden (ADR 0007 Karar 3a, errata E1).',
          },
          {
            selector:
              'TSTypeAssertion > TSTypeReference[typeName.name=/^(MoneyMinor|RateMicro)$/]',
            message:
              'Same rule for angle-bracket casts (ADR 0007 Karar 3a, errata E1).',
          },
        ],
      },
    },
    // The number-slot override is spread in CONDITIONALLY.
    //
    // ESLint 8 rejects `files: []` outright ("should NOT have fewer than 1
    // items") and refuses to start — so an empty NEW_MODULES declaration would
    // not merely disable the rule, it would break `npm run lint` for the whole
    // repo. That is the state the declaration is in today, by design, which is
    // exactly why this is a spread and not a plain object.
    ...(newModuleGlobs().length === 0
      ? []
      : [
    {
      // ADR 0007 errata E1 / K3 — THE NUMBER-SLOT RULE.
      //
      // The brand only gates assignment, so a plain `number` field bypasses it
      // entirely. In new modules no money/rate slot may be typed `number`.
      // Scope comes from the single NEW_MODULES declaration; today that list is
      // deliberately empty (claims / recognition_variance do not exist yet), so
      // this override is inert on the real tree and is proven against fixtures.
      files: newModuleGlobs(),
      excludedFiles: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: `PropertyDefinition[key.name!=/${NON_MONEY_IDENTIFIERS}/] > TSTypeAnnotation > TSNumberKeyword`,
            message:
              'New-module class property may not be typed `number` — use MoneyMinor / RateMicro ' +
              '(ADR 0007 errata E1: the brand is a slot gate; a `number` slot reopens it).',
          },
          {
            selector: `TSPropertySignature[key.name!=/${NON_MONEY_IDENTIFIERS}/] > TSTypeAnnotation > TSNumberKeyword`,
            message:
              'New-module DTO/interface field may not be typed `number` — use MoneyMinor / RateMicro ' +
              '(ADR 0007 errata E1).',
          },
          {
            selector: `TSMethodSignature > TSTypeAnnotation > TSNumberKeyword, MethodDefinition > FunctionExpression > TSTypeAnnotation > TSNumberKeyword`,
            message:
              'New-module method may not return a bare `number` on a money path — use MoneyMinor / RateMicro ' +
              '(ADR 0007 errata E1).',
          },
        ],
      },
    },
        ]),
  ],
};



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
  ],
};



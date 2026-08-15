// Fixture for lint-ratchet-self-test.sh — deliberately violates ESLint rules.
//
// Deliberately NOT `.ts.fixture`: this repo's `.eslintrc.js` sets
// `parserOptions.project` (type-aware parsing), and pointing eslint at a
// `.fixture`-extension file throws a fatal "non-standard extension" parse
// error instead of running the rules under test (measured, T-113). Plain
// `.ts` is safe here because this directory sits outside the real
// `{src,apps,libs,test}` target glob, so `npm run lint:check` never sees it
// regardless of extension.
//
// Expected (measured directly, `npx eslint <this file> --format json`):
//   @typescript-eslint/no-unused-vars  x2  (severity 2 / error)
//   @typescript-eslint/no-explicit-any x1  (severity 1 / warning)
export function fixtureError(a: any): number {
  const unusedOne = 1;
  const unusedTwo = 2;
  return a;
}

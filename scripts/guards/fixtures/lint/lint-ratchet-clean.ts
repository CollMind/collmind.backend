// Fixture for lint-ratchet-self-test.sh — deliberately lint-clean.
// Must report ZERO problems under the repo's real .eslintrc.js.
export function fixtureClean(a: number): number {
  return a + 1;
}

-- app-runtime-grants self-test fixture — TAM (üç "missing" pin dahil) —
-- "temiz ağaç" kontrolü: guard sıfır bulgu vermeli.
\set ON_ERROR_STOP on
BEGIN;
GRANT SELECT ON :"schema".fixture_granted TO app_runtime;
GRANT SELECT ON :"schema".fixture_indexed TO app_runtime;
GRANT SELECT ON :"schema".fixture_injected TO app_runtime;
GRANT SELECT ON :"schema".fixture_injected_missing TO app_runtime;
GRANT SELECT ON :"schema".fixture_direct_granted TO app_runtime;
GRANT SELECT ON :"schema".fixture_direct_missing TO app_runtime;
GRANT SELECT ON :"schema".fixture_missing TO app_runtime;
COMMIT;

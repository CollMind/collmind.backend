-- app-runtime-grants self-test fixture — kaynak B (kısmi: fixture_missing /
-- fixture_injected_missing / fixture_direct_missing BİLEREK GRANT'siz
-- bırakıldı — her kanalın kendi "detector alive" pini buna dayanır).
\set ON_ERROR_STOP on
BEGIN;
GRANT SELECT ON :"schema".fixture_granted TO app_runtime;
GRANT SELECT ON :"schema".fixture_indexed TO app_runtime;
GRANT SELECT ON :"schema".fixture_injected TO app_runtime;
GRANT SELECT ON :"schema".fixture_direct_granted TO app_runtime;
COMMIT;

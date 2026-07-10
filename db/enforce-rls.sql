-- Run once, connected as the RDS master user (postgres), against the
-- projectpulse database. Creates a non-superuser application role that
-- cannot bypass Row-Level Security, and grants it exactly the privileges
-- the app needs. After this, the app must connect as app_user (not
-- postgres) for RLS to actually take effect — see PG_USER/PG_PASSWORD.

-- Replace REPLACE_WITH_STRONG_PASSWORD below before running (e.g. output of
-- `openssl rand -base64 24`). Do not commit the real password to this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
  END IF;
END
$$;

-- Superusers and table owners always bypass RLS, with or without BYPASSRLS.
-- app_user must be neither. It's created without SUPERUSER/BYPASSRLS above;
-- this just makes the "not the owner" requirement explicit and checkable.
ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS;

GRANT CONNECT ON DATABASE postgres TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

-- Cover tables/sequences/functions created after this point too (migrations
-- run as postgres won't silently fall outside app_user's grants).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_user;

-- Verify: app_user must show rolsuper=f and rolbypassrls=f.
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';

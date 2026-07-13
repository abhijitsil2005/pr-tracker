-- Run once, connected as the RDS master user (postgres), against the
-- projectpulse database. Creates a non-superuser application role that
-- cannot bypass Row-Level Security, and grants it privileges tailored to
-- what this app's routes actually do per table (verified by grepping every
-- INSERT/UPDATE/DELETE/ON CONFLICT in routes/*.js) — not a blanket
-- "ALL TABLES" grant. After this, the app must connect as app_user (not
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
-- app_user must be neither — CREATE ROLE without SUPERUSER/BYPASSRLS already
-- defaults to NOSUPERUSER/NOBYPASSRLS, so no further ALTER ROLE is needed
-- (and on RDS, the master user isn't allowed to run one anyway — it's not a
-- true Postgres superuser, just a member of rds_superuser).

GRANT CONNECT ON DATABASE projectpulse TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- No sequences exist in this schema (every PK defaults to gen_random_uuid()),
-- so no sequence grants are needed. Trigger functions (set_updated_at,
-- current_project_id, current_company_id) keep Postgres's default EXECUTE-
-- to-PUBLIC privilege, which nothing in this schema revokes.

-- ── Full CRUD ───────────────────────────────────────────────────────────
-- Tables the app inserts, updates (including ON CONFLICT ... DO UPDATE
-- upserts, which need UPDATE privilege too), and deletes from.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  projects, users, project_members,
  modules, pages,
  prs, pr_statuses,
  releases, release_modules, release_pages,
  status_assignments, team_members, sprints
TO app_user;

-- ── Insert + delete, no update ─────────────────────────────────────────
-- Pure many-to-many link tables — the app only ever adds/removes rows via
-- INSERT ... ON CONFLICT DO NOTHING or DELETE, never UPDATEs a row in place.
GRANT SELECT, INSERT, DELETE ON
  pr_pages, pr_dependencies, out_of_scope_pages, status_assignment_prs
TO app_user;

-- ── Insert-only, no update/delete ──────────────────────────────────────
-- Append-only activity log.
GRANT SELECT, INSERT ON activity_logs TO app_user;

-- ── Read + update only, no insert/delete ───────────────────────────────
-- companyRoutes.js only ever SELECTs a company and UPDATEs its name — the
-- app has no route to create or delete a company (that's an out-of-band
-- operator action today).
GRANT SELECT, UPDATE ON companies TO app_user;

-- ── No access ───────────────────────────────────────────────────────────
-- release_timeline is fully orphaned: only ever written by the one-off
-- scripts/migrate-dynamo-to-pg.js migration script, and no live route reads
-- or writes it anymore (superseded by `releases` — see comments in
-- routes/lookupRoutes.js and routes/releaseRoutes.js). Deliberately no grant
-- here; run that migration script (if ever needed again) as the postgres
-- superuser, not as app_user.

-- Cover tables created after this point too, so a future migration run as
-- postgres doesn't silently fall outside app_user's grants. Defaults to full
-- CRUD (the common case above); any future append-only/read-only/link table
-- needs its own narrower GRANT afterward, same as the tables listed above.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

-- Verify: app_user must show rolsuper=f and rolbypassrls=f.
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';

-- Verify: exact per-table privileges granted.
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE grantee = 'app_user' AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;

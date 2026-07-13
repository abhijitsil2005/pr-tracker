-- ═══════════════════════════════════════════════════════════════════════════
-- PR Tracker — PostgreSQL Schema
-- Target: Aurora PostgreSQL Serverless v2 (compatible with PostgreSQL 16+)
-- Multi-tenant: Company → Project hierarchy with Row-Level Security
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram indexes for search

-- ── Shared trigger: auto-update updated_at ────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- TENANT HIERARCHY
-- ═══════════════════════════════════════════════════════════════════════════

-- ── companies ─────────────────────────────────────────────────────────────
CREATE TABLE companies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── projects ──────────────────────────────────────────────────────────────
CREATE TABLE projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

-- ── users ─────────────────────────────────────────────────────────────────
-- company_role governs cross-project access within a company.
-- Per-project access is in project_members.
CREATE TABLE users (
  email           TEXT        PRIMARY KEY,
  password_hash   TEXT        NOT NULL,
  name            TEXT,
  company_id      UUID        REFERENCES companies(id) ON DELETE SET NULL,
  company_role    TEXT        CHECK (company_role IN ('CompanyAdmin', 'CompanyReadOnly')),
  active          BOOLEAN     NOT NULL DEFAULT true,
  -- Bumped whenever active/company_role/password changes; embedded in every JWT
  -- and checked on every request so revocation (deactivation, role change,
  -- password change) takes effect immediately instead of waiting for token expiry.
  token_version   INT         NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── project_members ───────────────────────────────────────────────────────
CREATE TABLE project_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_email  TEXT        NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('Admin', 'ReadWrite', 'ReadOnly')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_email)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- MODULE PAGES
-- Modules group pages. Pages track deployment status and feature flags.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── modules ───────────────────────────────────────────────────────────────
CREATE TABLE modules (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 TEXT        NOT NULL,
  target_release_date  DATE,
  actual_release_date  DATE,
  is_oos               BOOLEAN     NOT NULL DEFAULT false,  -- module itself is out-of-scope
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- ── pages ─────────────────────────────────────────────────────────────────
CREATE TABLE pages (
  id                           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id                    UUID        NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  page_name                    TEXT        NOT NULL,
  feature_flag                 TEXT,
  feature_flag_status          TEXT        NOT NULL DEFAULT 'N/A',
  production_deployment_status TEXT,
  release_date                 DATE,
  sort_order                   INT         NOT NULL DEFAULT 0,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module_id, page_name)
);

-- ── out_of_scope_pages ────────────────────────────────────────────────────
-- Pages explicitly marked out-of-scope for a module (not the same as the
-- module itself being OOS).
CREATE TABLE out_of_scope_pages (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id   UUID  NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  page_name   TEXT  NOT NULL,
  UNIQUE (module_id, page_name)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- TEAM
-- Free-text developer/reviewer names scoped to a project.
-- Not necessarily linked to the users table (devs may not have accounts).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE team_members (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role        TEXT  NOT NULL,   -- 'Developer' | 'PR Reviewer'
  name        TEXT  NOT NULL,
  UNIQUE (project_id, role, name)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SPRINTS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE sprints (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprint_name TEXT  NOT NULL,
  start_date  DATE  NOT NULL,
  end_date    DATE  NOT NULL,
  UNIQUE (project_id, sprint_name)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- RELEASE TIMELINE
-- Master calendar of release numbers → dates. Used for sprint auto-fill
-- and release sync. Separate from prod_releases (which holds actual content).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE release_timeline (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  release_number    TEXT  NOT NULL,
  release_date      DATE,
  code_freeze_date  DATE,
  regression_start  DATE,
  UNIQUE (project_id, release_number)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- PR STATUSES
-- Admin-configurable, per-project list of valid PR status values (Project
-- Setup > PR Status). Single source of truth for every PR-status dropdown in
-- the app and for sort/"counts as deployed" semantics — replaces the several
-- hardcoded, drifted-apart status lists that used to live in the frontend.
-- prs.status itself stays a free TEXT column (no FK) so existing/imported
-- data is never blocked by this list.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pr_statuses (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  sort_order  INT     NOT NULL DEFAULT 0,
  is_deployed BOOLEAN NOT NULL DEFAULT false,  -- counts toward "Approved/Deployed" in reports
  UNIQUE (project_id, name)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- PULL REQUESTS
-- A PR record = one PR number + one module. The same PR number can cover
-- multiple modules, so multiple rows can share pr_number within a project.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── prs ───────────────────────────────────────────────────────────────────
CREATE TABLE prs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pr_number             INT         NOT NULL,
  module_id             UUID        REFERENCES modules(id) ON DELETE SET NULL,
  title                 TEXT,
  description           TEXT,
  additional_details    TEXT,
  developer             TEXT,
  reviewer              TEXT,
  type                  TEXT        NOT NULL DEFAULT 'Development',
  status                TEXT,
  user_story            TEXT,
  raised_date           DATE,
  first_response_date   TEXT,       -- stored as free-form text (may include time or be partial)
  approved_date         DATE,
  merged_date           DATE,
  dev_sprint            TEXT,
  testing_sprint        TEXT,
  target_release        TEXT,       -- release date string, FK-less (releases may not exist yet)
  task                  TEXT,
  release_date          DATE,       -- actual prod deployment date
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER prs_updated_at
  BEFORE UPDATE ON prs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── pr_pages ──────────────────────────────────────────────────────────────
-- Pages covered by a PR (many-to-many: a PR can cover multiple pages).
CREATE TABLE pr_pages (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pr_id       UUID  NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  page_name   TEXT  NOT NULL,
  UNIQUE (pr_id, page_name)
);

-- ── pr_dependencies ───────────────────────────────────────────────────────
-- PRs that must be deployed before this PR (stored as pr_number, not id,
-- because the dependent PR may not exist in this project's records).
CREATE TABLE pr_dependencies (
  pr_id               UUID  NOT NULL REFERENCES prs(id) ON DELETE CASCADE,
  project_id          UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dependent_pr_number INT   NOT NULL,
  PRIMARY KEY (pr_id, dependent_pr_number)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- PROD RELEASES
-- Holds the live content of each release: which modules/pages are included,
-- their feature flags, and which PR delivered them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── releases ──────────────────────────────────────────────────────────────
CREATE TABLE releases (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  release_number   TEXT        NOT NULL,
  release_date     DATE,
  code_freeze      DATE,
  regression_start DATE,
  completed        BOOLEAN     NOT NULL DEFAULT false,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, release_number)
);

-- ── release_modules ───────────────────────────────────────────────────────
CREATE TABLE release_modules (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  release_id  UUID  NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  module_name TEXT  NOT NULL,   -- denormalized; release content can outlive module records
  user_story  TEXT,
  UNIQUE (release_id, module_name)
);

-- ── release_pages ─────────────────────────────────────────────────────────
CREATE TABLE release_pages (
  id                   UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  release_module_id    UUID  NOT NULL REFERENCES release_modules(id) ON DELETE CASCADE,
  page_name            TEXT  NOT NULL,
  feature_flag         TEXT,
  feature_flag_status  TEXT  NOT NULL DEFAULT 'N/A',
  pr_number            INT,
  task                 TEXT,
  UNIQUE (release_module_id, page_name)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- STATUS TRACKER
-- Week-by-week developer → module → page assignments with activity log.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── status_assignments ────────────────────────────────────────────────────
CREATE TABLE status_assignments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  developer        TEXT        NOT NULL,
  module_id        UUID        REFERENCES modules(id) ON DELETE SET NULL,
  page_name        TEXT,
  week_start       DATE        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'Pending',
  type             TEXT        NOT NULL DEFAULT 'Development'
                               CHECK (type IN ('Development','Iteration Bug','TCR Bug','Prod Bug')),
  task             TEXT,
  sprint           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER status_assignments_updated_at
  BEFORE UPDATE ON status_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── status_assignment_prs ─────────────────────────────────────────────────
-- Many-to-many: a status assignment can link multiple PRs (chips UI in the
-- Assign/Edit and Activity modals). `position` preserves the order PRs were
-- added in — the highest position is treated as "most recently linked" for
-- Task/Sprint auto-fill. Replaces the old scalar linked_pr_number column,
-- which silently dropped every PR but the first when the tracker.json
-- importer parsed multiple PR numbers from a single row.
CREATE TABLE status_assignment_prs (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assignment_id UUID  NOT NULL REFERENCES status_assignments(id) ON DELETE CASCADE,
  pr_number     INT   NOT NULL,
  position      INT   NOT NULL DEFAULT 0,
  UNIQUE (assignment_id, pr_number)
);

CREATE INDEX idx_assignment_prs_assignment ON status_assignment_prs(assignment_id);
CREATE INDEX idx_assignment_prs_pr_number  ON status_assignment_prs(project_id, pr_number);

-- ── activity_logs ─────────────────────────────────────────────────────────
CREATE TABLE activity_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assignment_id UUID        NOT NULL REFERENCES status_assignments(id) ON DELETE CASCADE,
  note          TEXT        NOT NULL,
  type          TEXT        NOT NULL DEFAULT 'update',  -- 'created'|'update'|'status_change'|'pr_linked'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

-- Tenant hierarchy
CREATE INDEX idx_projects_company_id         ON projects(company_id);
CREATE INDEX idx_users_company_id            ON users(company_id);
CREATE INDEX idx_project_members_project_id  ON project_members(project_id);
CREATE INDEX idx_project_members_user_email  ON project_members(user_email);

-- Modules & pages
CREATE INDEX idx_modules_project_id          ON modules(project_id);
CREATE INDEX idx_pages_project_id            ON pages(project_id);
CREATE INDEX idx_pages_module_id             ON pages(module_id);
CREATE INDEX idx_oos_project_id              ON out_of_scope_pages(project_id);
CREATE INDEX idx_oos_module_id               ON out_of_scope_pages(module_id);
CREATE INDEX idx_team_members_project_id     ON team_members(project_id);
CREATE INDEX idx_pr_statuses_project_id      ON pr_statuses(project_id);

-- Sprint & timeline
CREATE INDEX idx_sprints_project_id          ON sprints(project_id);
CREATE INDEX idx_sprints_dates               ON sprints(project_id, start_date, end_date);
CREATE INDEX idx_release_timeline_project_id ON release_timeline(project_id);

-- PRs
CREATE INDEX idx_prs_project_id              ON prs(project_id);
CREATE INDEX idx_prs_pr_number               ON prs(project_id, pr_number);
CREATE INDEX idx_prs_module_id               ON prs(module_id);
CREATE INDEX idx_prs_developer               ON prs(project_id, developer);
CREATE INDEX idx_prs_status                  ON prs(project_id, status);
CREATE INDEX idx_prs_dev_sprint              ON prs(project_id, dev_sprint);
CREATE INDEX idx_prs_target_release          ON prs(project_id, target_release);
CREATE INDEX idx_pr_pages_project_id         ON pr_pages(project_id);
CREATE INDEX idx_pr_pages_pr_id              ON pr_pages(pr_id);
CREATE INDEX idx_pr_deps_pr_id               ON pr_dependencies(pr_id);

-- Releases
CREATE INDEX idx_releases_project_id         ON releases(project_id);
CREATE INDEX idx_release_modules_project_id  ON release_modules(project_id);
CREATE INDEX idx_release_modules_release_id  ON release_modules(release_id);
CREATE INDEX idx_release_pages_project_id    ON release_pages(project_id);
CREATE INDEX idx_release_pages_rm_id         ON release_pages(release_module_id);

-- Status tracker
CREATE INDEX idx_assignments_project_id      ON status_assignments(project_id);
CREATE INDEX idx_assignments_developer       ON status_assignments(project_id, developer);
CREATE INDEX idx_assignments_week            ON status_assignments(project_id, week_start);
CREATE INDEX idx_assignments_module          ON status_assignments(module_id);
CREATE INDEX idx_activity_logs_project_id    ON activity_logs(project_id);
CREATE INDEX idx_activity_logs_assignment_id ON activity_logs(assignment_id);

-- Trigram indexes for search
CREATE INDEX idx_prs_developer_trgm   ON prs   USING gin(developer   gin_trgm_ops);
CREATE INDEX idx_pages_name_trgm      ON pages  USING gin(page_name   gin_trgm_ops);
CREATE INDEX idx_modules_name_trgm    ON modules USING gin(name        gin_trgm_ops);


-- ═══════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- The application sets these session variables at the start of each request:
--   SET LOCAL app.project_id = '<uuid>';
--   SET LOCAL app.company_id = '<uuid>';
-- CompanyAdmin users bypass project_id filtering for cross-project access.
-- ═══════════════════════════════════════════════════════════════════════════

-- Create the non-superuser application role and its per-table grants:
-- see db/enforce-rls.sql (run once as the RDS master user during setup;
-- the app then connects as app_user, not the superuser).

-- projects/project_members are deliberately NOT RLS-enabled: they're the
-- tenant-hierarchy root, queried cross-project (e.g. listing every project
-- in a company before any single one is "current" — during login, or in
-- projectRoutes.js/userRoutes.js's company-wide management screens), so
-- there's no single current_project_id() to scope them by. Every route
-- touching them already does its own explicit company_id/project_id
-- ownership check (requireCompanyAdmin + WHERE company_id = ...) — the same
-- app-layer control these have always relied on.
ALTER TABLE modules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE out_of_scope_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_statuses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprints            ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_timeline   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_pages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pr_dependencies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE releases           ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_modules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_pages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_assignment_prs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs        ENABLE ROW LEVEL SECURITY;

-- Helper: read the current project/company from the session
CREATE OR REPLACE FUNCTION current_project_id() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.project_id', true), '')::uuid;
$$;
CREATE OR REPLACE FUNCTION current_company_id() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.company_id', true), '')::uuid;
$$;

-- All project-scoped tables share the same pattern
CREATE POLICY rls_modules            ON modules            USING (project_id = current_project_id());
CREATE POLICY rls_pages              ON pages              USING (project_id = current_project_id());
CREATE POLICY rls_oos                ON out_of_scope_pages USING (project_id = current_project_id());
CREATE POLICY rls_team_members       ON team_members       USING (project_id = current_project_id());
CREATE POLICY rls_pr_statuses        ON pr_statuses        USING (project_id = current_project_id());
CREATE POLICY rls_sprints            ON sprints            USING (project_id = current_project_id());
CREATE POLICY rls_release_timeline   ON release_timeline   USING (project_id = current_project_id());
CREATE POLICY rls_prs                ON prs                USING (project_id = current_project_id());
CREATE POLICY rls_pr_pages           ON pr_pages           USING (project_id = current_project_id());
CREATE POLICY rls_pr_dependencies    ON pr_dependencies    USING (project_id = current_project_id());
CREATE POLICY rls_releases           ON releases           USING (project_id = current_project_id());
CREATE POLICY rls_release_modules    ON release_modules    USING (project_id = current_project_id());
CREATE POLICY rls_release_pages      ON release_pages      USING (project_id = current_project_id());
CREATE POLICY rls_status_assignments ON status_assignments USING (project_id = current_project_id());
CREATE POLICY rls_assignment_prs     ON status_assignment_prs USING (project_id = current_project_id());
CREATE POLICY rls_activity_logs      ON activity_logs      USING (project_id = current_project_id());


-- ═══════════════════════════════════════════════════════════════════════════
-- USEFUL VIEWS
-- ═══════════════════════════════════════════════════════════════════════════

-- PR summary with module name and page count (replaces DynamoDB scan + join in app)
CREATE VIEW v_prs AS
SELECT
  p.id,
  p.project_id,
  p.pr_number,
  p.title,
  p.description,
  p.additional_details,
  m.name            AS module,
  p.developer,
  p.reviewer,
  p.type,
  p.status,
  p.user_story,
  p.raised_date,
  p.first_response_date,
  p.approved_date,
  p.merged_date,
  p.dev_sprint,
  p.testing_sprint,
  p.target_release,
  p.task,
  p.release_date,
  p.created_at,
  p.updated_at,
  COALESCE(pp.pages, ARRAY[]::text[]) AS pages
FROM prs p
LEFT JOIN modules m ON m.id = p.module_id
LEFT JOIN LATERAL (
  SELECT ARRAY_AGG(pp.page_name ORDER BY pp.page_name) AS pages
  FROM pr_pages pp WHERE pp.pr_id = p.id
) pp ON true;

-- Status tracker with last activity (replaces ActivityLog array in DynamoDB)
CREATE VIEW v_status_assignments AS
SELECT
  sa.id,
  sa.project_id,
  sa.developer,
  m.name            AS module,
  sa.page_name,
  sa.week_start,
  (SELECT array_agg(pr_number ORDER BY position) FROM status_assignment_prs WHERE assignment_id = sa.id) AS pr_numbers,
  sa.status,
  sa.type,
  sa.task,
  sa.sprint,
  sa.created_at,
  sa.updated_at,
  last_act.note     AS last_activity_note,
  last_act.created_at AS last_activity_at,
  last_act.type     AS last_activity_type
FROM status_assignments sa
LEFT JOIN modules m ON m.id = sa.module_id
LEFT JOIN LATERAL (
  SELECT note, created_at, type
  FROM activity_logs al
  WHERE al.assignment_id = sa.id
  ORDER BY al.created_at DESC
  LIMIT 1
) last_act ON true;

-- Module completion summary (powers the dashboard table)
CREATE VIEW v_module_summary AS
SELECT
  m.project_id,
  m.id            AS module_id,
  m.name          AS module,
  COUNT(p.id)                                                             AS total_pages,
  COUNT(p.id) FILTER (WHERE p.production_deployment_status = 'Deployed') AS prod_deployed,
  COUNT(p.id) FILTER (WHERE p.production_deployment_status IS NULL
                        OR  p.production_deployment_status = '')         AS pending,
  COUNT(p.id) FILTER (WHERE p.feature_flag_status = 'Disabled')         AS ff_disabled
FROM modules m
LEFT JOIN pages p ON p.module_id = m.id
WHERE m.is_oos = false
GROUP BY m.project_id, m.id, m.name;

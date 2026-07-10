-- Adds the pr_statuses table (Project Setup > PR Status) and backfills every
-- existing project so nothing breaks: seeds the 8 default status values in
-- their current workflow order, then adds any additional distinct
-- prs.status values already in use per project (e.g. legacy/imported data)
-- so no PR's existing status silently disappears from the dropdown.
-- Safe to re-run — every step is idempotent.

CREATE TABLE IF NOT EXISTS pr_statuses (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  sort_order  INT     NOT NULL DEFAULT 0,
  is_deployed BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pr_statuses_project_id ON pr_statuses(project_id);

ALTER TABLE pr_statuses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pr_statuses' AND policyname = 'rls_pr_statuses') THEN
    CREATE POLICY rls_pr_statuses ON pr_statuses USING (project_id = current_project_id());
  END IF;
END
$$;

-- Seed the current hardcoded default list (in its existing workflow order)
-- for every project that doesn't already have PR statuses configured.
INSERT INTO pr_statuses (project_id, name, sort_order, is_deployed)
SELECT p.id, d.name, d.sort_order, d.is_deployed
FROM projects p
CROSS JOIN (VALUES
  ('Development Inprogress',    1, false),
  ('Dev PR in Review',          2, false),
  ('TCR Testing In Progress',   3, false),
  ('Ready for Prod Deploy',     4, true),
  ('Prod Deployed FF OFF',      5, true),
  ('Prod Deployed',             6, true),
  ('Reverted',                  7, false),
  ('Closed',                    8, false)
) AS d(name, sort_order, is_deployed)
ON CONFLICT (project_id, name) DO NOTHING;

-- Backfill any additional distinct prs.status values already in use per
-- project (e.g. from older imports) that aren't in the default list above,
-- appended after it so existing PRs keep a matching dropdown option.
INSERT INTO pr_statuses (project_id, name, sort_order, is_deployed)
SELECT DISTINCT
  pr.project_id,
  pr.status,
  100 + row_number() OVER (PARTITION BY pr.project_id ORDER BY pr.status),
  false
FROM prs pr
WHERE pr.status IS NOT NULL AND pr.status <> ''
  AND NOT EXISTS (
    SELECT 1 FROM pr_statuses ps
    WHERE ps.project_id = pr.project_id AND ps.name = pr.status
  )
ON CONFLICT (project_id, name) DO NOTHING;

-- Verify: every project should now have at least the 8 default statuses.
SELECT p.name AS project, count(ps.id) AS status_count
FROM projects p LEFT JOIN pr_statuses ps ON ps.project_id = p.id
GROUP BY p.name ORDER BY p.name;

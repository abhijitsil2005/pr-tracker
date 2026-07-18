-- Adds the releases.sprint column. The Edit/Add Release form has always had a
-- Sprint field and the frontend has always sent it, but the column was dropped
-- during the Dynamo -> Postgres migration, so it was silently discarded on
-- every save. Safe to re-run.

ALTER TABLE releases ADD COLUMN IF NOT EXISTS sprint TEXT;

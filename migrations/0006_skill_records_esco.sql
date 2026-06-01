-- PDS-native skills (#8 PR 2). The `skills` table becomes an INDEX of records
-- in each builder's atproto repo (collection org.buildguild.skill): track the
-- source record's AT-URI + CID, and the ESCO concept the builder confirmed for
-- it. Cache the chosen ESCO ref on the shared catalog so others see it too.
-- Non-destructive (additive columns only).

ALTER TABLE skills ADD COLUMN at_uri     TEXT NOT NULL DEFAULT '';
ALTER TABLE skills ADD COLUMN cid        TEXT NOT NULL DEFAULT '';
ALTER TABLE skills ADD COLUMN esco_uri   TEXT NOT NULL DEFAULT '';
ALTER TABLE skills ADD COLUMN esco_label TEXT NOT NULL DEFAULT '';

ALTER TABLE skill_catalog ADD COLUMN esco_uri   TEXT NOT NULL DEFAULT '';
ALTER TABLE skill_catalog ADD COLUMN esco_label TEXT NOT NULL DEFAULT '';

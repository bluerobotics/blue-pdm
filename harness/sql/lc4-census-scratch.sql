-- LC4 - something for the uuid census to migrate, so that "the census does not
-- migrate" is a measurement rather than an assertion.
--
-- The harness installs no extensions - BluePLM uses the built-in
-- gen_random_uuid() - so there is nothing for migrate_uuid_defaults() to move
-- on a fresh container and a control built on the existing state would pass
-- against a census that migrated everything in sight. This creates the one
-- thing the migration is about: a column default that calls uuid_generate_v4().
--
-- uuid-ossp ships with the official postgres image's contrib set. If CREATE
-- EXTENSION fails, tooling-controls.ps1 reports LC4 as not applicable rather
-- than as a failure - a control that cannot be set up has not found anything.
--
-- Removed by lc4-drop.sql, extension included.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;

DROP TABLE IF EXISTS lc_census_scratch;

CREATE TABLE lc_census_scratch (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note TEXT
);

ALTER TABLE lc_census_scratch ENABLE ROW LEVEL SECURITY;

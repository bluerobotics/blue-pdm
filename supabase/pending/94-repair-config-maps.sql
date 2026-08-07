-- ===========================================
-- STAGED FOR SCHEMA 94 - WRITTEN, PROVEN, NOT YET INSTALLED
-- ===========================================
--
-- repair_config_maps(uuid, jsonb) - fill the per-configuration entries the pre-fix
-- checkin_file erased from files.custom_properties._config_tabs and ._config_descriptions.
--
-- WHY THIS FILE IS NOT IN modules/10-source-files.sql YET
--
-- Schema 93 was uncommitted and in flight in supabase/core.sql when this was written, with its
-- harness containers running. Appending to a file another change is mid-edit produces a conflict
-- that neither author can see, and a half-applied version bump is exactly the failure the schema
-- gate exists to catch. So this waits. To land it:
--
--   1. Append everything below the LANDING LINE to supabase/modules/10-source-files.sql,
--      after checkin_file.
--   2. supabase/core.sql: bump schema_release_version() to 94, and add to
--      schema_release_manifest():
--        ('10-source-files', NULL, 'function',
--         'repair_config_maps(uuid,jsonb)', 'require_org_member && is_org_admin'),
--   3. src/lib/schemaVersion.ts: EXPECTED_SCHEMA_VERSION = 94 and a VERSION_DESCRIPTIONS entry.
--   4. Run supabase/tools/verify-schema.sql, which is the only thing that stamps the version.
--
-- Until then the application detects the function's absence (SQLSTATE 42883) and says the repair
-- is not installed. Production is on schema 85, so that is the state it is in today regardless.
--
-- ===========================================
-- WHERE THE SAFETY PROPERTY LIVES
-- ===========================================
--
-- The offline script this replaces could claim "this module cannot write, provable by reading its
-- imports". A button cannot claim that - the whole point of a button is that it writes. Rather
-- than drop the guarantee, it moves here, where it is stronger: the script's property held for one
-- caller, and this one holds for every caller there will ever be.
--
-- Three things are structural rather than conventional. None depends on the argument.
--
-- 1. **The merge order is written here, not passed in.** Every write is
--
--        jsonb_set(custom_properties, ARRAY[key], <computed> || COALESCE(custom_properties -> key, '{}'))
--
--    `a || b` keeps b on every shared key and yields the union of the key sets. The row is on the
--    right. So an entry the row already holds survives untouched however loudly the argument
--    disagrees with it, and no key of the row's map can be absent from the result. Adding a key
--    the row lacks is the only effect this statement can have. There is no argument that turns it
--    into an overwrite and none that turns it into a deletion: no DELETE, no `jsonb - key`, and no
--    path that reads a value out of the row and writes it back.
--
-- 2. **The caller cannot name the key it writes.** The loop is over c_reserved_maps, a constant in
--    this body, and not over the keys of the argument. A request naming `part_number` or `_secret`
--    is not refused so much as unseen: nothing reads it. Every other key under custom_properties is
--    carried through by jsonb_set untouched, and no other column appears in any SET list.
--
-- 3. **A map that does not already exist is not created.** The WHERE requires the row to carry the
--    key as a JSON object. A row that never described its configurations never lost anything from
--    the map, so filling one would invent database state rather than restore it - the `unattributed`
--    verdict the divergence scanner exists to keep out of a repair. That judgement is enforced
--    here, so a client that gets it wrong still cannot perform it.
--
-- Keys naming configurations that no longer exist are carried through untouched by property 1.
-- They are never repaired, because removing one is a deletion and a deletion is unrepresentable.
--
-- The live row is read inside the UPDATE, so it is the value at apply time and not the client's
-- snapshot of it that wins. A request built against a row that has since gained entries degrades
-- to a smaller repair. It cannot degrade to an overwrite, and the receipt reports what actually
-- landed rather than what was asked for, so the degradation is visible instead of silent.
--
-- Proven by execution, not by argument: 94-repair-config-maps-proof.sql beside this file plants
-- row values that disagree with the request, plants keys for configurations that no longer exist,
-- and requires both to survive. It carries a sentinel that fails if the merge is ever written the
-- other way round, so the suite discriminates rather than passing over a function that does
-- nothing. 23 of 23 cases pass on PostgreSQL 17.6 with core.sql, every module and
-- harness/sql/seed.sql installed.
--
-- ===========================================
-- LANDING LINE - everything below goes into modules/10-source-files.sql
-- ===========================================

-- Fill gaps in the reserved per-configuration maps, and only gaps.
--
-- p_repairs is an array, one element per file:
--
--   [{ "file_id": "<uuid>",
--      "maps": { "_config_tabs":         { "<configuration>": "<value>", ... },
--                "_config_descriptions": { "<configuration>": "<value>", ... } } }]
--
-- Both maps are optional; an absent or empty one is "no opinion about this map". Values must be
-- JSON strings - the maps hold strings, and admitting a nested object would put a shape in there
-- that nothing else in the application can read. A malformed request raises rather than applying
-- the part of itself that happened to parse: a request this function does not understand is a
-- client bug, and half of one is worse than none.
--
-- Returns a receipt. Per file and per map: the entries the row held before, the entries asked for,
-- and how many keys the row actually gained. Those three disagree exactly when the row already had
-- something the request did not know about, which is the case worth seeing.
DO $$ BEGIN PERFORM drop_function_overloads('repair_config_maps'); END $$;
CREATE OR REPLACE FUNCTION repair_config_maps(p_org_id UUID, p_repairs JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- The only keys this function will ever write. Matches merge_custom_properties, which is the
  -- authority for what counts as a reserved per-configuration map.
  c_reserved_maps CONSTANT TEXT[] := ARRAY['_config_tabs', '_config_descriptions'];

  v_actor          UUID;
  v_actor_email    TEXT;
  v_request        JSONB;
  v_file_id        UUID;
  v_file           RECORD;
  v_key            TEXT;
  v_computed       JSONB;
  v_before         INTEGER;
  v_after          INTEGER;
  v_requested      INTEGER;
  v_updated        BOOLEAN;
  v_file_report    JSONB;
  v_map_reports    JSONB;
  v_reports        JSONB := '[]'::jsonb;
  v_files_updated  INTEGER := 0;
  v_entries_added  INTEGER := 0;
  v_entries_asked  INTEGER := 0;
BEGIN
  -- Membership first, in its own right rather than leaning on the admin test beside it: see
  -- upsert_item_designation for why those two are kept independent.
  PERFORM require_org_member(p_org_id);

  IF NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only organization admins can repair configuration maps'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_repairs IS NULL OR jsonb_typeof(p_repairs) <> 'array' THEN
    RAISE EXCEPTION 'p_repairs must be a JSON array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_actor := current_actor_id();
  SELECT email INTO v_actor_email FROM users WHERE id = v_actor;

  -- Validate the whole request before writing any of it. A request carrying one bad value is
  -- rejected entirely, so there is no state in which half a repair has been applied and the caller
  -- has been told it failed.
  FOR v_request IN SELECT * FROM jsonb_array_elements(p_repairs) LOOP
    IF jsonb_typeof(v_request -> 'maps') <> 'object' THEN
      RAISE EXCEPTION 'Each repair needs a maps object'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    FOREACH v_key IN ARRAY c_reserved_maps LOOP
      v_computed := v_request -> 'maps' -> v_key;
      CONTINUE WHEN v_computed IS NULL;

      IF jsonb_typeof(v_computed) <> 'object' THEN
        RAISE EXCEPTION 'maps.% must be a JSON object', v_key
          USING ERRCODE = 'invalid_parameter_value';
      END IF;

      IF EXISTS (
        SELECT 1 FROM jsonb_each(v_computed) AS entry(name, value)
        WHERE jsonb_typeof(entry.value) <> 'string'
      ) THEN
        RAISE EXCEPTION 'maps.% may only hold string values', v_key
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END LOOP;
  END LOOP;

  FOR v_request IN SELECT * FROM jsonb_array_elements(p_repairs) LOOP
    v_file_id := NULLIF(v_request ->> 'file_id', '')::uuid;
    v_map_reports := '{}'::jsonb;
    v_updated := FALSE;

    -- The organization comes from the gated argument and the row must match it, so a file id
    -- belonging to another tenant resolves to no row at all rather than to a refusal that
    -- confirms the id exists.
    SELECT id, file_path, org_id
      INTO v_file
      FROM files
     WHERE id = v_file_id
       AND org_id = p_org_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      v_reports := v_reports || jsonb_build_object(
        'file_id', v_file_id,
        'file_path', NULL,
        'updated', FALSE,
        'refused', 'row-not-found',
        'maps', v_map_reports
      );
      CONTINUE;
    END IF;

    FOREACH v_key IN ARRAY c_reserved_maps LOOP
      v_computed := v_request -> 'maps' -> v_key;
      CONTINUE WHEN v_computed IS NULL OR v_computed = '{}'::jsonb;

      SELECT count(*)::int INTO v_requested FROM jsonb_object_keys(v_computed);
      v_entries_asked := v_entries_asked + v_requested;

      SELECT CASE
               WHEN jsonb_typeof(f.custom_properties -> v_key) = 'object'
               THEN (SELECT count(*)::int FROM jsonb_object_keys(f.custom_properties -> v_key))
             END
        INTO v_before
        FROM files f
       WHERE f.id = v_file.id;

      IF v_before IS NULL THEN
        -- The row carries no such map, or carries something that is not a map. Either way it never
        -- described this file's configurations and there is nothing here to restore.
        v_map_reports := v_map_reports || jsonb_build_object(v_key, jsonb_build_object(
          'refused', 'map-absent',
          'requested', v_requested
        ));
        CONTINUE;
      END IF;

      -- THE MERGE. `<computed> || existing` - the row is on the right, so it wins every shared key
      -- and the key set can only grow. custom_properties inside the expression is the row's
      -- pre-update value, which is what makes the live row and not the caller's snapshot the side
      -- that survives. The WHERE re-states the guards as refusals rather than as reach.
      UPDATE files f
         SET custom_properties = jsonb_set(
               COALESCE(f.custom_properties, '{}'::jsonb),
               ARRAY[v_key],
               v_computed || COALESCE(f.custom_properties -> v_key, '{}'::jsonb)
             )
       WHERE f.id = v_file.id
         AND f.org_id = p_org_id
         AND f.deleted_at IS NULL
         AND f.custom_properties ? v_key
         AND jsonb_typeof(f.custom_properties -> v_key) = 'object';

      SELECT (SELECT count(*)::int FROM jsonb_object_keys(f.custom_properties -> v_key))
        INTO v_after
        FROM files f
       WHERE f.id = v_file.id;

      v_map_reports := v_map_reports || jsonb_build_object(v_key, jsonb_build_object(
        'before', v_before,
        'requested', v_requested,
        'added', v_after - v_before,
        'after', v_after
      ));

      IF v_after > v_before THEN
        v_updated := TRUE;
        v_entries_added := v_entries_added + (v_after - v_before);
      END IF;
    END LOOP;

    IF v_updated THEN
      v_files_updated := v_files_updated + 1;

      -- An admin write to production data leaves a record. `update` rather than a new enum value:
      -- adding one is schema surface this does not need, and details.operation is what makes the
      -- row findable. The files UPDATE trigger changes nothing here - none of its branches match a
      -- custom_properties-only change, so this is the only row written.
      INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
      VALUES (
        p_org_id,
        v_file.id,
        v_actor,
        COALESCE(v_actor_email, 'unknown'),
        'update',
        jsonb_build_object('operation', 'config_map_repair', 'maps', v_map_reports)
      );
    END IF;

    v_file_report := jsonb_build_object(
      'file_id', v_file.id,
      'file_path', v_file.file_path,
      'updated', v_updated,
      'refused', NULL,
      'maps', v_map_reports
    );
    v_reports := v_reports || v_file_report;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'files_requested', jsonb_array_length(p_repairs),
    'files_updated', v_files_updated,
    'entries_requested', v_entries_asked,
    'entries_added', v_entries_added,
    'files', v_reports
  );
END;
$$;

-- Born unreachable by anon, as every RPC in this schema is, then handed to signed-in users - who
-- still have to pass require_org_member and is_org_admin inside.
REVOKE ALL ON FUNCTION repair_config_maps(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION repair_config_maps(UUID, JSONB) TO authenticated;

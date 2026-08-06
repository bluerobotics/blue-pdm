-- Read-only. SELECT only. Run in the Supabase SQL editor.
--
-- Input for `npm run repair:config-maps`. It reports, for every row that carries at least one of
-- the reserved per-configuration maps, the shape of each map and the configuration *names* the map
-- holds keys for. Names rather than counts, because a 26-entry map on a 15-configuration file reads
-- as intact against a count and as eleven stale keys plus nothing missing against the names.
--
-- This is `blueplm-wipe-audit/config-map-shapes.sql` query 1, with two changes: `f.id` is selected,
-- and the result is a single JSON document. The id is what the repair targets - a `file_path` is
-- not unique across vaults, and the repair refuses to emit a statement for a row it cannot identify
-- exactly. The JSON is so that the array columns arrive as arrays rather than as Postgres array
-- literals, whose quoting rules a configuration name containing a comma or a brace would break.
--
-- LIVES HERE BECAUSE ANOTHER AGENT IS WORKING UNDER `supabase/`. It defines no function and changes
-- no object, so it needs no schema version bump; when the tree is quiet it should be folded in
-- beside `supabase/tools/`, which is where the other read-only diagnostic queries live.
--
-- HOW TO RUN
--   1. Paste this file into the Supabase SQL editor and run it.
--   2. The result is one row, one column, holding a JSON array.
--   3. Copy that cell into a file, say `config-map-shapes.json`.
--   4. npm run repair:config-maps -- --shapes=config-map-shapes.json --census=vault-out.jsonl
--
-- `?` is the jsonb key-existence operator, and it is the only thing here that distinguishes a map
-- that is absent from one that exists and is empty. Everything else counts entries, which both
-- shapes report as zero, and the difference between them is the difference between "the database
-- never described this file" and "the database's description of this file was erased".

SELECT jsonb_pretty(COALESCE(jsonb_agg(shape ORDER BY shape ->> 'file_path'), '[]'::jsonb))
         AS config_map_shapes
FROM (
  SELECT jsonb_build_object(
    'id',        f.id,
    'file_path', f.file_path,
    'file_name', f.file_name,

    'tab_map_shape', CASE
      WHEN NOT (f.custom_properties ? '_config_tabs')                      THEN 'absent'
      WHEN jsonb_typeof(f.custom_properties -> '_config_tabs') <> 'object' THEN 'not-an-object'
      WHEN f.custom_properties -> '_config_tabs' = '{}'::jsonb             THEN 'present-EMPTY'
      ELSE 'present'
    END,
    'tab_configurations', CASE
      WHEN jsonb_typeof(f.custom_properties -> '_config_tabs') = 'object'
      THEN (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
              FROM jsonb_object_keys(f.custom_properties -> '_config_tabs') AS k)
    END,

    'description_map_shape', CASE
      WHEN NOT (f.custom_properties ? '_config_descriptions')                      THEN 'absent'
      WHEN jsonb_typeof(f.custom_properties -> '_config_descriptions') <> 'object' THEN 'not-an-object'
      WHEN f.custom_properties -> '_config_descriptions' = '{}'::jsonb             THEN 'present-EMPTY'
      ELSE 'present'
    END,
    'description_configurations', CASE
      WHEN jsonb_typeof(f.custom_properties -> '_config_descriptions') = 'object'
      THEN (SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
              FROM jsonb_object_keys(f.custom_properties -> '_config_descriptions') AS k)
    END,

    'updated_at', f.updated_at
  ) AS shape
  FROM files f
  WHERE f.deleted_at IS NULL
    AND (f.custom_properties ? '_config_tabs' OR f.custom_properties ? '_config_descriptions')
) shapes;
